// Resumo persistido da última sessão, para as Estatísticas (quadrante Russell +
// evolução de valência) mostrarem dados mesmo quando não há sessão ativa —
// o buffer ao vivo (`history` em App.tsx) é limitado a 20 frames e não serve
// para representar a sessão inteira.

const SUMMARIES_KEY = "sensus-session-summaries";
const MAX_SUMMARIES = 30;
const MAX_SERIES_POINTS = 60;

/**
 * Métricas específicas de cada ambiente. Só existem as que fazem sentido para o
 * que o ambiente mede: falar de valência num ambiente sem biometria facial, ou
 * de traços pintados num que não tem pincel, seria inventar número.
 */
export type MetricasAmbiente = {
  /** Regulação Sensorial */
  quadrantPct?: { posAct: number; posCalm: number; negAct: number; negCalm: number };
  avgBpm?: number;
  avgValence?: number;
  avgArousal?: number;
  /** Depth Map Tools */
  distanciaMediaCm?: number;
  distanciaMinCm?: number;
  distanciaMaxCm?: number;
  /** Air Painting */
  pctTempoAPintar?: number;
  tracos?: number;
  pctDuasMaos?: number;
  /** Fluid AI */
  energiaMedia?: number;
  pctComGeracao?: number;
};

export type SessionSummary = {
  id: number;
  startedAt: string;
  endedAt: string;
  /** Ambiente em que a sessão decorreu. Ausente nas sessões anteriores a esta versão. */
  ambienteId?: string;
  ambienteNome?: string;
  quadrantPct: { posAct: number; posCalm: number; negAct: number; negCalm: number };
  valenceSeries: { t: number; v: number }[];
  avgBpm: number;
  avgValence: number;
  metricas?: MetricasAmbiente;
};

/** Amostra por frame acumulada durante a sessão. */
export type AmostraSessao = {
  a: number;            // valência 0-100
  b: number;            // BPM
  c: number;            // ativação 0-100
  dist?: number;        // distância câmara-rosto, cm
  aPintar?: boolean;
  maos?: number;
  energia?: number;     // energia de movimento na sala, 0-1
  comGeracao?: boolean;
};

function media(vals: number[]): number {
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
}

/** Calcula só as métricas que o ambiente em causa consegue medir. */
function metricasDoAmbiente(amostras: AmostraSessao[], ambienteId?: string): MetricasAmbiente {
  const n = amostras.length || 1;
  if (ambienteId === "exp1-depth-explorer") {
    const d = amostras.map((x) => x.dist ?? 0).filter((v) => v > 0);
    return d.length
      ? {
          distanciaMediaCm: Math.round(media(d)),
          distanciaMinCm: Math.round(Math.min(...d)),
          distanciaMaxCm: Math.round(Math.max(...d)),
        }
      : {};
  }
  if (ambienteId === "air-painting") {
    let tracos = 0;
    for (let i = 1; i < amostras.length; i++) {
      if (amostras[i].aPintar && !amostras[i - 1].aPintar) tracos++;
    }
    return {
      pctTempoAPintar: Math.round((amostras.filter((x) => x.aPintar).length / n) * 100),
      tracos,
      pctDuasMaos: Math.round((amostras.filter((x) => (x.maos ?? 0) >= 2).length / n) * 100),
    };
  }
  if (ambienteId === "fluid-ai") {
    return {
      energiaMedia: Math.round(media(amostras.map((x) => x.energia ?? 0)) * 100),
      pctComGeracao: Math.round((amostras.filter((x) => x.comGeracao).length / n) * 100),
    };
  }
  // Regulação Sensorial e qualquer ambiente com biometria facial.
  return {
    avgArousal: Math.round(media(amostras.map((x) => x.c))),
  };
}

/** Amostra as entradas de `sessionHistory` (formato { a, b, c }) para no máximo `MAX_SERIES_POINTS`. */
function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

/** Grava um resumo da sessão que terminou (chamado a partir de `sessionHistory` acumulado em App.tsx). */
export function saveSessionSummary(
  sessionHistory: AmostraSessao[],
  startedAt: string,
  ambiente?: { id: string; nome: string },
): void {
  if (!sessionHistory.length) return;

  let posAct = 0, posCalm = 0, negAct = 0, negCalm = 0;
  let sumBpm = 0, sumVal = 0, bpmCount = 0;
  for (const h of sessionHistory) {
    const positive = h.a >= 50;
    const active = h.c >= 50;
    if (positive && active) posAct++;
    else if (positive && !active) posCalm++;
    else if (!positive && active) negAct++;
    else negCalm++;
    if (h.b > 0) { sumBpm += h.b; bpmCount++; }
    sumVal += h.a;
  }
  const total = sessionHistory.length;

  const summary: SessionSummary = {
    id: Date.now(),
    startedAt,
    endedAt: new Date().toISOString(),
    ambienteId: ambiente?.id,
    ambienteNome: ambiente?.nome,
    quadrantPct: {
      posAct: Math.round((posAct / total) * 100),
      posCalm: Math.round((posCalm / total) * 100),
      negAct: Math.round((negAct / total) * 100),
      negCalm: Math.round((negCalm / total) * 100),
    },
    valenceSeries: downsample(sessionHistory, MAX_SERIES_POINTS).map((h, i) => ({ t: i, v: h.a })),
    avgBpm: bpmCount ? Math.round(sumBpm / bpmCount) : 0,
    avgValence: Math.round(sumVal / total),
    metricas: metricasDoAmbiente(sessionHistory, ambiente?.id),
  };

  try {
    const raw = localStorage.getItem(SUMMARIES_KEY) || "[]";
    const list: SessionSummary[] = JSON.parse(raw);
    list.unshift(summary);
    localStorage.setItem(SUMMARIES_KEY, JSON.stringify(list.slice(0, MAX_SUMMARIES)));
  } catch (e) {}
}

/** Todos os resumos guardados, do mais recente para o mais antigo. */
export function getSessionSummaries(): SessionSummary[] {
  try {
    return JSON.parse(localStorage.getItem(SUMMARIES_KEY) || "[]") as SessionSummary[];
  } catch (e) {
    return [];
  }
}

export function getLatestSessionSummary(): SessionSummary | null {
  try {
    const raw = localStorage.getItem(SUMMARIES_KEY) || "[]";
    const list: SessionSummary[] = JSON.parse(raw);
    return list[0] || null;
  } catch (e) {
    return null;
  }
}
