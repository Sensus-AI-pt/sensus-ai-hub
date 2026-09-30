/**
 * Motor de simulação de fluidos 2D em WebGL2.
 *
 * A física corre numa grelha pequena (por omissão 256×256) e o resultado é
 * ampliado para o canvas em resolução nativa: o custo de um solucionador de
 * pressão é dominado pelo número de células, não pelo tamanho do ecrã, e a
 * tinta é suave o suficiente para a ampliação não se notar.
 *
 * Ver `fluidShaders.ts` para o método e as referências.
 */

import {
  advectShader,
  buoyancyShader,
  curlShader,
  displayShader,
  divergenceShader,
  flowDyeShader,
  flowInjectShader,
  gradientSubtractShader,
  jacobiShader,
  vertexShader,
  vorticityShader,
} from "./fluidShaders";
import type { FluidPhysics } from "./fluidPresets";

interface FBO {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  attach(id: number): number;
}

interface DoubleFBO {
  read: FBO;
  write: FBO;
  swap(): void;
}

function compilar(gl: WebGL2RenderingContext, tipo: number, fonte: string): WebGLShader {
  const shader = gl.createShader(tipo);
  if (!shader) throw new Error("Não foi possível criar o shader");
  gl.shaderSource(shader, fonte);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Falha a compilar o shader: ${log}`);
  }
  return shader;
}

class Programa {
  readonly program: WebGLProgram;
  private readonly uniforms = new Map<string, WebGLUniformLocation>();

  constructor(private readonly gl: WebGL2RenderingContext, vs: WebGLShader, fragmentSource: string) {
    const fs = compilar(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error("Não foi possível criar o programa");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    // Tem de ser antes do link: depois já não tem efeito e o atributo podia
    // ficar noutro índice que não o 0 do VAO.
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Falha a ligar o programa: ${gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(fs);
    this.program = program;
    const total = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < total; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const loc = gl.getUniformLocation(program, info.name);
      if (loc) this.uniforms.set(info.name, loc);
    }
  }

  usar() {
    this.gl.useProgram(this.program);
  }

  u(nome: string): WebGLUniformLocation | null {
    return this.uniforms.get(nome) ?? null;
  }
}

export interface FluidOptions {
  /** Lado da grelha de simulação. 256 é o compromisso usado por omissão. */
  simResolution?: number;
  /** Lado da grelha da tinta. Maior = traço mais fino, mais custo de memória. */
  dyeResolution?: number;
}

export class FluidEngine {
  private readonly gl: WebGL2RenderingContext;
  private readonly programas: Record<string, Programa>;
  private readonly quad: WebGLVertexArrayObject;
  private velocity!: DoubleFBO;
  private dye!: DoubleFBO;
  private pressure!: DoubleFBO;
  private divergence!: FBO;
  private curl!: FBO;
  private simRes: number;
  private dyeRes: number;
  private ultimoInstante = 0;
  /** Textura com o campo de movimento da câmara (R/G = componentes do fluxo). */
  private fluxoTex: WebGLTexture | null = null;
  private temFluxo = false;
  /** Força com que o movimento filmado empurra o fluido. */
  forcaCamara = 900;
  /** Corrente de fundo: mantém a peça viva com a sala parada. 0 desliga. */
  correnteFundo = 160;
  /**
   * Cor da tinta de fundo, por segundo (é multiplicada pelo dt).
   *
   * O nível de equilíbrio é `taxa / (1 - dissipação)`: com a dissipação da tinta
   * a 0.99, semear 0.26/s dava um brilho médio de 10 em 765 — presente nos
   * números, invisível no ecrã. Este valor põe o equilíbrio numa zona que se lê.
   */
  corFundo: [number, number, number] = [1.60, 1.15, 3.60];
  private tempo = 0;
  /**
   * O preset define a força e a corrente; os sliders do painel multiplicam-nas.
   * Assim mudar de preset muda mesmo o comportamento, e o ajuste fino do
   * utilizador continua a valer por cima — antes o slider sobrepunha-se ao
   * preset e os seis ficavam todos com a mesma resposta.
   */
  fatorForca = 1.0;
  fatorCorrente = 1.0;

  forcaEfetiva() {
    return (this.physics.forcaCamara ?? this.forcaCamara) * this.fatorForca;
  }

  correnteEfetiva() {
    return (this.physics.correnteFundo ?? this.correnteFundo) * this.fatorCorrente;
  }

  /**
   * 1.0 espelha o campo de movimento, 0.0 usa-o como a câmara o filma. Espelhado
   * por omissão: quem está à frente vê o fluido responder do lado onde mexeu.
   * Deixa de ser o certo quando a câmara filma o público de frente numa
   * instalação, e por isso passou a ser uma opção do painel.
   */
  espelhoCamara() {
    return (this.physics.espelharCamara ?? true) ? 1.0 : 0.0;
  }
  /** Abaixo disto o movimento é considerado ruído do sensor e ignorado. */
  zonaMorta = 0.06;
  /**
   * Cor da tinta deixada pelo movimento filmado — roxo da marca (#7c67ff).
   * A tinta é aditiva e acumula-se enquanto houver movimento, por isso o valor
   * por frame é baixo: verificado, 0.22 saturava em branco puro num par de
   * segundos de gesto contínuo e a paleta desaparecia.
   */
  corCamara: [number, number, number] = [0.20, 0.16, 0.40];
  /** Falso quando o contexto não suporta render para float — sem isso não há simulação. */
  readonly suportado: boolean;
  readonly erro: string | null = null;

  physics: FluidPhysics;

  constructor(canvas: HTMLCanvasElement, physics: FluidPhysics, opts: FluidOptions = {}) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      // Falso de propósito: `preserveDrawingBuffer` obriga o browser a manter o
      // buffer entre frames e desliga otimizações de composição. A leitura para
      // o motor de IA é feita dentro do mesmo requestAnimationFrame do render,
      // que é quando o buffer ainda é válido — não precisa desta flag.
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 indisponível nesta máquina");
    this.gl = gl;
    this.physics = physics;
    this.simRes = opts.simResolution ?? 256;
    // A tinta corre a 768 e a física a 256. A 1024 a advecção da tinta era o
    // segundo maior custo por frame e o detalhe extra perdia-se na ampliação
    // para o ecrã; 768 mantém os filamentos legíveis por metade do trabalho.
    this.dyeRes = opts.dyeResolution ?? 768;

    // Sem esta extensão não se pode fazer render para texturas de vírgula
    // flutuante, e os campos de velocidade/pressão precisam do intervalo.
    const linearFloat = gl.getExtension("EXT_color_buffer_float");
    this.suportado = !!linearFloat;
    if (!this.suportado) {
      this.erro = "A GPU não suporta render para texturas de vírgula flutuante (EXT_color_buffer_float)";
      // Deixa os campos por inicializar; `passo()` sai de imediato.
      this.programas = {} as Record<string, Programa>;
      this.quad = null as unknown as WebGLVertexArrayObject;
      return;
    }
    gl.getExtension("OES_texture_float_linear");

    const vs = compilar(gl, gl.VERTEX_SHADER, vertexShader);
    this.programas = {
      advect: new Programa(gl, vs, advectShader),
      divergence: new Programa(gl, vs, divergenceShader),
      jacobi: new Programa(gl, vs, jacobiShader),
      gradient: new Programa(gl, vs, gradientSubtractShader),
      curl: new Programa(gl, vs, curlShader),
      vorticity: new Programa(gl, vs, vorticityShader),
      buoyancy: new Programa(gl, vs, buoyancyShader),
      flowInject: new Programa(gl, vs, flowInjectShader),
      flowDye: new Programa(gl, vs, flowDyeShader),
      display: new Programa(gl, vs, displayShader),
    };

    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Não foi possível criar o VAO");
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.quad = vao;

    this.criarBuffers();
  }

  private criarFBO(w: number, h: number, internalFormat: number, format: number): FBO {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, gl.HALF_FLOAT, null);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      texture,
      fbo,
      width: w,
      height: h,
      attach: (id: number) => {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  }

  private criarDuplo(w: number, h: number, internalFormat: number, format: number): DoubleFBO {
    const a = this.criarFBO(w, h, internalFormat, format);
    const b = this.criarFBO(w, h, internalFormat, format);
    return {
      read: a,
      write: b,
      swap() {
        const t = this.read;
        this.read = this.write;
        this.write = t;
      },
    };
  }

  private criarBuffers() {
    const gl = this.gl;
    const s = this.simRes;
    const d = this.dyeRes;
    this.velocity = this.criarDuplo(s, s, gl.RG16F, gl.RG);
    this.dye = this.criarDuplo(d, d, gl.RGBA16F, gl.RGBA);
    this.pressure = this.criarDuplo(s, s, gl.R16F, gl.RED);
    this.divergence = this.criarFBO(s, s, gl.R16F, gl.RED);
    this.curl = this.criarFBO(s, s, gl.R16F, gl.RED);
  }

  private desenhar(alvo: FBO | null) {
    const gl = this.gl;
    if (alvo) {
      gl.viewport(0, 0, alvo.width, alvo.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, alvo.fbo);
    } else {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Atualiza a textura do campo de movimento vindo da câmara.
   * Chamada quando chega um `flow_field` novo na telemetria (~15×/s).
   */
  atualizarFluxo(imagem: HTMLImageElement) {
    if (!this.suportado) return;
    const gl = this.gl;
    if (!this.fluxoTex) {
      this.fluxoTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.fluxoTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.fluxoTex);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imagem);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    this.temFluxo = true;
  }

  /** Um passo de simulação e o render para o canvas. */
  passo(agora: number) {
    if (!this.suportado) return;
    const gl = this.gl;
    // dt limitado: um separador em segundo plano devolve saltos enormes, que
    // fariam a advecção saltar a grelha toda e rebentar a simulação.
    const dt = this.ultimoInstante ? Math.min((agora - this.ultimoInstante) / 1000, 0.033) : 0.016;
    this.ultimoInstante = agora;
    const texel: [number, number] = [1.0 / this.simRes, 1.0 / this.simRes];

    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.quad);

    // 0. Movimento filmado pela câmara → velocidade e tinta. É esta a entrada
    //    do ambiente: quem está à frente da câmara agita o fluido com o corpo.
    // Corre sempre, mesmo sem campo da câmara: é a corrente de fundo que mantém
    // a peça viva quando a sala está parada.
    this.tempo += dt;
    {
      const semFluxo = !(this.temFluxo && this.fluxoTex);
      const pf = this.programas.flowInject;
      pf.usar();
      gl.uniform2f(pf.u("uTexelSize"), texel[0], texel[1]);
      gl.uniform1i(pf.u("uVelocity"), this.velocity.read.attach(0));
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.fluxoTex ?? this.velocity.read.texture);
      gl.uniform1i(pf.u("uFlow"), 1);
      // Sem campo real, a força vai a zero para a textura de substituição não
      // ser lida como movimento — fica só a corrente de fundo.
      gl.uniform1f(pf.u("uForce"), semFluxo ? 0 : this.forcaEfetiva());
      gl.uniform1f(pf.u("uDeadZone"), this.zonaMorta);
      gl.uniform1f(pf.u("uDt"), dt);
      gl.uniform1f(pf.u("uTime"), this.tempo);
      gl.uniform1f(pf.u("uAmbient"), this.correnteEfetiva());
      gl.uniform1f(pf.u("uEspelho"), this.espelhoCamara());
      this.desenhar(this.velocity.write);
      this.velocity.swap();

      const pfd = this.programas.flowDye;
      pfd.usar();
      gl.uniform2f(pfd.u("uTexelSize"), texel[0], texel[1]);
      gl.uniform1i(pfd.u("uDye"), this.dye.read.attach(0));
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.fluxoTex ?? this.dye.read.texture);
      gl.uniform1i(pfd.u("uFlow"), 1);
      const cm = this.physics.corMovimento ?? this.corCamara;
      const cf = this.physics.corFundo ?? this.corFundo;
      gl.uniform3f(pfd.u("uColor"), cm[0] * 0.2, cm[1] * 0.2, cm[2] * 0.2);
      gl.uniform3f(pfd.u("uAmbientColor"), cf[0] * dt, cf[1] * dt, cf[2] * dt);
      gl.uniform1f(pfd.u("uAmount"), semFluxo ? 0 : 1.0);
      gl.uniform1f(pfd.u("uDeadZone"), this.zonaMorta);
      gl.uniform1f(pfd.u("uAmbient"), this.correnteEfetiva() > 0 ? 1.0 : 0.0);
      gl.uniform1f(pfd.u("uTime"), this.tempo);
      gl.uniform1f(pfd.u("uEspelho"), this.espelhoCamara());
      this.desenhar(this.dye.write);
      this.dye.swap();
    }

    // 1. Rotacional e confinamento de vorticidade
    if (this.physics.curl > 0) {
      const pc = this.programas.curl;
      pc.usar();
      gl.uniform2f(pc.u("uTexelSize"), texel[0], texel[1]);
      gl.uniform1i(pc.u("uVelocity"), this.velocity.read.attach(0));
      this.desenhar(this.curl);

      const pv = this.programas.vorticity;
      pv.usar();
      gl.uniform2f(pv.u("uTexelSize"), texel[0], texel[1]);
      gl.uniform1i(pv.u("uVelocity"), this.velocity.read.attach(0));
      gl.uniform1i(pv.u("uCurl"), this.curl.attach(1));
      gl.uniform1f(pv.u("uCurlStrength"), this.physics.curl);
      gl.uniform1f(pv.u("uDt"), dt);
      this.desenhar(this.velocity.write);
      this.velocity.swap();
    }

    // 2. Empuxo térmico
    if (this.physics.buoyancy !== 0) {
      const pb = this.programas.buoyancy;
      pb.usar();
      gl.uniform2f(pb.u("uTexelSize"), texel[0], texel[1]);
      gl.uniform1i(pb.u("uVelocity"), this.velocity.read.attach(0));
      gl.uniform1i(pb.u("uDensity"), this.dye.read.attach(1));
      gl.uniform1f(pb.u("uBuoyancy"), this.physics.buoyancy);
      gl.uniform1f(pb.u("uDt"), dt);
      this.desenhar(this.velocity.write);
      this.velocity.swap();
    }

    // 3. Divergência
    const pd = this.programas.divergence;
    pd.usar();
    gl.uniform2f(pd.u("uTexelSize"), texel[0], texel[1]);
    gl.uniform1i(pd.u("uVelocity"), this.velocity.read.attach(0));
    this.desenhar(this.divergence);

    // 4. Pressão por iteração de Jacobi, em ping-pong
    const pj = this.programas.jacobi;
    pj.usar();
    gl.uniform2f(pj.u("uTexelSize"), texel[0], texel[1]);
    gl.uniform1i(pj.u("uDivergence"), this.divergence.attach(0));
    for (let i = 0; i < this.physics.pressureIterations; i++) {
      gl.uniform1i(pj.u("uPressure"), this.pressure.read.attach(1));
      this.desenhar(this.pressure.write);
      this.pressure.swap();
    }

    // 5. Subtração do gradiente — devolve o campo sem divergência
    const pg = this.programas.gradient;
    pg.usar();
    gl.uniform2f(pg.u("uTexelSize"), texel[0], texel[1]);
    gl.uniform1i(pg.u("uPressure"), this.pressure.read.attach(0));
    gl.uniform1i(pg.u("uVelocity"), this.velocity.read.attach(1));
    this.desenhar(this.velocity.write);
    this.velocity.swap();

    // 6. Advecção da velocidade e depois da tinta
    const pa = this.programas.advect;
    pa.usar();
    gl.uniform2f(pa.u("uTexelSize"), texel[0], texel[1]);
    gl.uniform1f(pa.u("uDt"), dt);
    gl.uniform1i(pa.u("uVelocity"), this.velocity.read.attach(0));
    gl.uniform1i(pa.u("uSource"), this.velocity.read.attach(0));
    gl.uniform1f(pa.u("uDissipation"), this.physics.velocityDissipation);
    this.desenhar(this.velocity.write);
    this.velocity.swap();

    gl.uniform1i(pa.u("uVelocity"), this.velocity.read.attach(0));
    gl.uniform1i(pa.u("uSource"), this.dye.read.attach(1));
    gl.uniform1f(pa.u("uDissipation"), this.physics.densityDissipation);
    this.desenhar(this.dye.write);
    this.dye.swap();

    // 7. Ecrã
    const pdisp = this.programas.display;
    pdisp.usar();
    gl.uniform1i(pdisp.u("uTexture"), this.dye.read.attach(0));
    this.desenhar(null);
  }

  /** Esvazia a tinta e o movimento. */
  limpar() {
    if (!this.suportado) return;
    const gl = this.gl;
    for (const alvo of [this.dye.read, this.dye.write, this.velocity.read, this.velocity.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, alvo.fbo);
      gl.viewport(0, 0, alvo.width, alvo.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  destruir() {
    if (!this.suportado) return;
    const gl = this.gl;
    const perder = gl.getExtension("WEBGL_lose_context");
    perder?.loseContext();
  }
}
