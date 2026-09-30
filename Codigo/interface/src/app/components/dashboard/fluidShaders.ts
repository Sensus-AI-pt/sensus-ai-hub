/**
 * Shaders GLSL ES 3.0 da simulação de fluidos incompressíveis em WebGL2.
 *
 * Método: projeção de Chorin sobre as equações de Navier-Stokes, na formulação
 * estável de Stam (1999, "Stable Fluids", SIGGRAPH '99) e com a organização em
 * passagens de Harris (GPU Gems, cap. 38). Cada passagem é um fragment shader
 * sobre um quad de ecrã inteiro, com os campos guardados em texturas RGBA16F.
 *
 * A ordem por frame é: advecção → forças externas → confinamento de vorticidade
 * → divergência → pressão (Jacobi) → subtração do gradiente. A subtração no fim
 * é o que devolve um campo de velocidade sem divergência, ou seja, incompressível.
 */

/** Quad de ecrã inteiro. Passa também as coordenadas dos 4 vizinhos, para as
 *  passagens em estêncil não as recalcularem por fragmento. */
export const vertexShader = `#version 300 es
precision highp float;

in vec2 aPosition;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
uniform vec2 uTexelSize;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(uTexelSize.x, 0.0);
  vR = vUv + vec2(uTexelSize.x, 0.0);
  vT = vUv + vec2(0.0, uTexelSize.y);
  vB = vUv - vec2(0.0, uTexelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * Advecção semi-lagrangiana: cada célula vai buscar o valor à posição de onde
 * o fluido veio, recuando no tempo pelo campo de velocidade. É incondicionalmente
 * estável — daí o nome do método de Stam — ao contrário do avanço explícito.
 * A amostragem é bilinear (GL_LINEAR), que é o que suaviza o transporte.
 */
export const advectShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexelSize;
uniform float uDt;
uniform float uDissipation;

void main() {
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * uTexelSize;
  vec4 resultado = texture(uSource, coord);
  // Dissipação por frame: 1.0 conserva, valores abaixo desvanecem o campo.
  fragColor = uDissipation * resultado;
}
`;

/** Divergência do campo de velocidade: quanto é que cada célula está a ganhar
 *  ou a perder massa. É o termo do lado direito da equação de Poisson. */
export const divergenceShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;

uniform sampler2D uVelocity;

void main() {
  float esq = texture(uVelocity, vL).x;
  float dir = texture(uVelocity, vR).x;
  float cima = texture(uVelocity, vT).y;
  float baixo = texture(uVelocity, vB).y;

  // Condição de fronteira: velocidade normal nula nas paredes (reflexão).
  vec2 centro = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) { esq = -centro.x; }
  if (vR.x > 1.0) { dir = -centro.x; }
  if (vB.y < 0.0) { baixo = -centro.y; }
  if (vT.y > 1.0) { cima = -centro.y; }

  fragColor = vec4(0.5 * (dir - esq + cima - baixo), 0.0, 0.0, 1.0);
}
`;

/**
 * Um passo de Jacobi na equação de Poisson da pressão. Converge devagar, por
 * isso corre-se em várias iterações com ping-pong entre dois FBOs; 20-30 passos
 * chegam para o olho, muito abaixo da convergência numérica.
 */
export const jacobiShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;

uniform sampler2D uPressure;
uniform sampler2D uDivergence;

void main() {
  float esq = texture(uPressure, vL).x;
  float dir = texture(uPressure, vR).x;
  float cima = texture(uPressure, vT).x;
  float baixo = texture(uPressure, vB).x;
  float divergencia = texture(uDivergence, vUv).x;
  fragColor = vec4((esq + dir + baixo + cima - divergencia) * 0.25, 0.0, 0.0, 1.0);
}
`;

/** Subtrai o gradiente da pressão à velocidade. É este passo que torna o campo
 *  livre de divergência — o fluido deixa de comprimir. */
export const gradientSubtractShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;

uniform sampler2D uPressure;
uniform sampler2D uVelocity;

void main() {
  float esq = texture(uPressure, vL).x;
  float dir = texture(uPressure, vR).x;
  float cima = texture(uPressure, vT).x;
  float baixo = texture(uPressure, vB).x;
  vec2 velocidade = texture(uVelocity, vUv).xy;
  velocidade -= vec2(dir - esq, cima - baixo);
  fragColor = vec4(velocidade, 0.0, 1.0);
}
`;

/** Rotacional (curl) do campo 2D — escalar. Alimenta o confinamento de vorticidade. */
export const curlShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;

uniform sampler2D uVelocity;

void main() {
  float esq = texture(uVelocity, vL).y;
  float dir = texture(uVelocity, vR).y;
  float cima = texture(uVelocity, vT).x;
  float baixo = texture(uVelocity, vB).x;
  fragColor = vec4(0.5 * ((dir - esq) - (cima - baixo)), 0.0, 0.0, 1.0);
}
`;

/**
 * Confinamento de vorticidade (Fedkiw et al., 2001, SIGGRAPH). A advecção numa
 * grelha discreta dissipa os vórtices pequenos; este termo devolve energia
 * rotacional onde o rotacional já é forte, o que faz aparecer os redemoinhos e
 * os filamentos finos que dão o aspeto de fumo ou tinta.
 */
export const vorticityShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;

uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uCurlStrength;
uniform float uDt;

void main() {
  float esq = texture(uCurl, vL).x;
  float dir = texture(uCurl, vR).x;
  float cima = texture(uCurl, vT).x;
  float baixo = texture(uCurl, vB).x;
  float centro = texture(uCurl, vUv).x;

  // Gradiente do módulo do rotacional, normalizado: aponta para o centro do vórtice.
  vec2 forca = 0.5 * vec2(abs(cima) - abs(baixo), abs(dir) - abs(esq));
  forca /= length(forca) + 0.0001;
  forca *= uCurlStrength * centro;
  forca.y *= -1.0;

  vec2 velocidade = texture(uVelocity, vUv).xy + forca * uDt;
  velocidade = clamp(velocidade, -1000.0, 1000.0);
  fragColor = vec4(velocidade, 0.0, 1.0);
}
`;

/** Empuxo térmico: empurra a tinta segundo a sua luminância. Usado no preset
 *  de visão térmica, onde o "calor" tem de subir. */
export const buoyancyShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uVelocity;
uniform sampler2D uDensity;
uniform float uBuoyancy;
uniform float uDt;

void main() {
  vec3 tinta = texture(uDensity, vUv).rgb;
  float calor = dot(tinta, vec3(0.299, 0.587, 0.114));
  vec2 velocidade = texture(uVelocity, vUv).xy;
  velocidade.y += uBuoyancy * calor * uDt;
  fragColor = vec4(velocidade, 0.0, 1.0);
}
`;

/**
 * Injeta o movimento filmado pela câmara no campo de velocidade, e deixa tinta
 * onde esse movimento é forte.
 *
 * O campo chega numa textura em que R e G codificam as componentes x e y do
 * fluxo ótico, com 0.5 a significar parado. É invertido em x para o resultado
 * ser um espelho: quem está à frente da câmara vê o fluido responder do lado
 * onde mexeu, e não do lado oposto.
 */
export const flowInjectShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
layout(location = 0) out vec4 fragVelocity;

uniform sampler2D uVelocity;
uniform sampler2D uFlow;
uniform float uForce;
uniform float uDeadZone;
uniform float uDt;
uniform float uTime;
uniform float uAmbient;
uniform float uEspelho;   // 1.0 = espelho horizontal, 0.0 = câmara como filma

void main() {
  vec2 amostra = vec2(mix(vUv.x, 1.0 - vUv.x, uEspelho), vUv.y);
  vec2 fluxo = texture(uFlow, amostra).rg * 2.0 - 1.0;
  fluxo.x = mix(fluxo.x, -fluxo.x, uEspelho);  // o espelho também inverte a direção
  // O sensor tem ruído mesmo com a sala parada; sem zona morta o fluido ficava
  // com uma agitação de fundo aleatória, que se lê como avaria e não como vida.
  float intensidade = length(fluxo);
  if (intensidade < uDeadZone) { fluxo = vec2(0.0); }

  // Corrente de fundo: um campo lento, sem divergência (é o rotacional de uma
  // função escalar, logo não comprime), que mantém a peça viva quando a sala
  // está parada. É isto, e não o ruído do sensor, que dá o movimento contínuo.
  vec2 q = vUv * 3.0;
  float t = uTime * 0.15;
  float psi = sin(q.x + t) * cos(q.y * 1.3 - t * 0.7)
            + 0.5 * sin(q.y * 2.1 + t * 1.3) * cos(q.x * 1.7 + t * 0.5);
  vec2 corrente = vec2(
     cos(q.y * 1.3 - t * 0.7) * cos(q.x + t) * 1.3
       + 1.05 * cos(q.y * 2.1 + t * 1.3) * cos(q.x * 1.7 + t * 0.5),
    -sin(q.x + t) * sin(q.y * 1.3 - t * 0.7)
       + 0.85 * sin(q.y * 2.1 + t * 1.3) * sin(q.x * 1.7 + t * 0.5)
  );
  corrente *= uAmbient * (0.4 + 0.6 * psi * psi);

  vec2 velocidade = texture(uVelocity, vUv).xy + (fluxo * uForce + corrente) * uDt;
  fragVelocity = vec4(velocidade, 0.0, 1.0);
}
`;

/** Deposita tinta onde o movimento filmado é forte, para o gesto deixar rasto. */
export const flowDyeShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uDye;
uniform sampler2D uFlow;
uniform vec3 uColor;
uniform vec3 uAmbientColor;
uniform float uAmount;
uniform float uDeadZone;
uniform float uAmbient;
uniform float uTime;
uniform float uEspelho;   // igual ao flowInject: os dois têm de amostrar o mesmo lado

void main() {
  vec2 amostra = vec2(mix(vUv.x, 1.0 - vUv.x, uEspelho), vUv.y);
  vec2 fluxo = texture(uFlow, amostra).rg * 2.0 - 1.0;
  float intensidade = max(0.0, length(fluxo) - uDeadZone);
  vec3 base = texture(uDye, vUv).rgb;

  // Tinta de fundo: sem ela a corrente de fundo move um campo vazio e não se vê
  // nada. Semeada em manchas largas e lentas, para o transporte as esticar em
  // filamentos em vez de encher o ecrã de forma uniforme.
  // Frequência alta e potência elevada: a semente sai em bolsas pequenas e
  // separadas, que a corrente estica em filamentos. Uma mancha larga e suave
  // enchia o ecrã de forma uniforme antes de haver transporte que a moldasse.
  vec2 q = vUv * 7.0;
  float t = uTime * 0.11;
  float mancha = sin(q.x * 1.7 + t) * sin(q.y * 2.3 - t * 1.1) * cos(q.x * 0.9 - q.y * 1.4 + t * 0.6);
  float semente = pow(max(0.0, mancha), 3.0) * uAmbient;

  fragColor = vec4(base + uColor * intensidade * uAmount + uAmbientColor * semente, 1.0);
}
`;

/** Passagem final para o ecrã, com um pequeno realce de contraste. */
export const displayShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTexture;

void main() {
  vec3 cor = texture(uTexture, vUv).rgb;
  fragColor = vec4(cor, 1.0);
}
`;
