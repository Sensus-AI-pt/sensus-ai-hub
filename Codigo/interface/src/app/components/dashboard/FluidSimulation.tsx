import { Component, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { FluidEngine } from "./fluidEngine";
import type { FluidPhysics } from "./fluidPresets";

/**
 * Simulação de fluidos em WebGL2, desenhada num canvas de ecrã inteiro.
 *
 * Quando `enviarParaIA` está ligado, o canvas é amostrado a cadência fixa e
 * enviado ao motor Python como entrada do StreamDiffusion. A cadência é baixa
 * de propósito: o img2img corre a ~10 Hz e enviar mais depressa só encheria o
 * stdin do motor com frames que ele nunca chega a consumir.
 */

const CADENCIA_IA_MS = 110;   // ~9 Hz, alinhado com o ritmo do img2img
const LADO_IA = 512;          // o StreamDiffusion trabalha a 512×512

interface Props {
  physics: FluidPhysics;
  /** Quando verdadeiro, envia frames ao motor como entrada do StreamDiffusion. */
  enviarParaIA?: boolean;
  /** Incrementar este número limpa a tela. */
  limparSinal?: number;
  /**
   * Campo de movimento da câmara (`flow_field` na telemetria), como data URL.
   * É esta a entrada do ambiente: o fluido é agitado por quem está à frente da
   * câmara, não pelo rato.
   */
  flowFieldUrl?: string;
  /** Multiplicador da força do preset, em percentagem (100 = como o preset). */
  forcaCamara?: number;
  /** Multiplicador da corrente do preset, em percentagem. 0 desliga. */
  correnteFundo?: number;
}

function FluidSimulationInner({
  physics,
  enviarParaIA = false,
  limparSinal = 0,
  flowFieldUrl,
  forcaCamara = 100,
  correnteFundo = 100,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<FluidEngine | null>(null);
  const physicsRef = useRef(physics);
  const enviarRef = useRef(enviarParaIA);
  const erroRef = useRef<HTMLDivElement | null>(null);

  // Mantém os valores correntes acessíveis ao ciclo de animação sem o reiniciar
  // a cada mudança de preset — recriar o motor apagaria a tela do utilizador.
  physicsRef.current = physics;
  enviarRef.current = enviarParaIA;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let engine: FluidEngine;
    try {
      engine = new FluidEngine(canvas, physicsRef.current);
    } catch (ex: any) {
      if (erroRef.current) erroRef.current.textContent = `Simulação indisponível: ${ex?.message ?? ex}`;
      return;
    }
    engineRef.current = engine;
    if (!engine.suportado && erroRef.current) {
      erroRef.current.textContent = `Simulação indisponível: ${engine.erro}`;
    }

    const redimensionar = () => {
      // DPR fixo a 1: a passagem final desenha o ecrã inteiro, e num monitor
      // de alta densidade isso eram 3,4 milhões de píxeis por frame. A tinta é
      // suave e vem de uma grelha de 1024², por isso o detalhe extra não existe
      // — pagava-se resolução sem ganhar imagem.
      canvas.width = Math.floor(canvas.clientWidth);
      canvas.height = Math.floor(canvas.clientHeight);
    };
    redimensionar();
    window.addEventListener("resize", redimensionar);

    // A interação é a câmara: o campo de movimento chega por `flowFieldUrl` e é
    // injetado no campo de velocidade dentro do motor. Não há rato — numa
    // instalação não há quem o segure, e o corpo à frente da câmara é a entrada.

    // ── Ciclo de render ──
    let raf = 0;
    let ultimoEnvio = 0;
    // Canvas auxiliar reutilizado: criar um por envio faria o GC trabalhar 9×/s.
    const auxiliar = document.createElement("canvas");
    auxiliar.width = LADO_IA;
    auxiliar.height = LADO_IA;
    const ctxAux = auxiliar.getContext("2d");

    const tick = (agora: number) => {
      engine.physics = physicsRef.current;
      engine.passo(agora);

      if (enviarRef.current && ctxAux && agora - ultimoEnvio >= CADENCIA_IA_MS) {
        ultimoEnvio = agora;
        try {
          // Recorte central quadrado, para o redimensionamento não distorcer.
          const lado = Math.min(canvas.width, canvas.height);
          const sx = (canvas.width - lado) / 2;
          const sy = (canvas.height - lado) / 2;
          ctxAux.drawImage(canvas, sx, sy, lado, lado, 0, 0, LADO_IA, LADO_IA);
          const b64 = auxiliar.toDataURL("image/jpeg", 0.7).split(",")[1];
          window.electronAPI?.sendRPPGCommand?.(`SET_SD_INPUT_IMAGE ${b64}`);
        } catch {
          // Um frame perdido não justifica parar a simulação.
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", redimensionar);
      engine.destruir();
      engineRef.current = null;
    };
  }, []);

  // Campo de movimento novo → textura. A imagem é descodificada fora do ciclo
  // de render, e só depois entregue ao motor, para não travar um frame.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !flowFieldUrl) return;
    let cancelado = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelado) engineRef.current?.atualizarFluxo(img);
    };
    img.src = flowFieldUrl;
    return () => {
      cancelado = true;
    };
  }, [flowFieldUrl]);

  // Os controlos do painel são multiplicadores sobre o preset, não valores
  // absolutos: 100% significa "como o preset manda".
  useEffect(() => {
    if (engineRef.current) engineRef.current.fatorForca = forcaCamara / 100;
  }, [forcaCamara]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.fatorCorrente = correnteFundo / 100;
  }, [correnteFundo]);

  useEffect(() => {
    if (limparSinal > 0) engineRef.current?.limpar();
  }, [limparSinal]);

  return (
    <div className="relative h-full w-full bg-black">
      <canvas ref={canvasRef} className="h-full w-full touch-none" />
      <div
        ref={erroRef}
        className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-[11px] text-rose-400"
      />
    </div>
  );
}

/** Uma falha de WebGL não pode levar a janela inteira — mostra a razão. */
class FluidErrorBoundary extends Component<{ children: ReactNode }, { erro: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(error: any) {
    return { erro: String(error?.message ?? error) };
  }

  componentDidCatch(error: any) {
    console.error("[FluidSimulation] falhou:", error);
  }

  render() {
    if (this.state.erro) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black px-8 text-center">
          <span className="text-[11px] uppercase tracking-widest text-white/40">Falha na simulação de fluidos</span>
          <span className="text-[11px] text-white/25">{this.state.erro}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

export function FluidSimulation(props: Props) {
  return (
    <FluidErrorBoundary>
      <FluidSimulationInner {...props} />
    </FluidErrorBoundary>
  );
}
