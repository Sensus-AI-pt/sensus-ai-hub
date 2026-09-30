import type { ExhibitionFile } from "./types";

const NOMES_SENSORES: Record<string, string> = {
  rppg: "rPPG",
  gaze: "Olhar",
  blink: "Piscadelas",
  symmetry: "Simetria",
  flow: "Fluxo ótico",
  presence: "Presença",
  gesture: "Gestos",
};

export interface EnvironmentSummary {
  motor: string;
  sensores: string;
  musica: string;
}

export function environmentSummary(e: ExhibitionFile): EnvironmentSummary {
  const motores: string[] = [];
  if (e.engine?.streamdiffusion?.enabled) motores.push("StreamDiffusion");
  if (e.engine?.depthMap?.enabled) motores.push("Mapa de profundidade");
  if (e.engine?.airPainting?.enabled) motores.push("Deteção de mãos");

  const ativos = Object.entries(e.defaults?.activeSensors ?? {})
    .filter(([, on]) => on)
    .map(([k]) => NOMES_SENSORES[k] ?? k);

  const volumes = Object.values(e.defaults?.music?.layers ?? {});
  const temMusica = volumes.some((v) => v > 0);

  return {
    motor: motores.length ? motores.join(" + ") : "—",
    sensores: ativos.length ? ativos.join(", ") : "Nenhum",
    musica: temMusica ? "Sim" : "Não",
  };
}
