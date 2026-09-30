import { useMemo } from "react";
import { loadExhibitions } from "../../../exhibitions/loadExhibitions";
import type { SessionSummary } from "./sessionHistory";

/**
 * Menu para escolher de que ambiente virtual são as estatísticas mostradas.
 *
 * Só aparecem ambientes que têm sessões gravadas, mais a opção "Todos". Listar
 * ambientes sem uma única sessão daria escolhas que levam a ecrãs vazios.
 */
export function SeletorAmbiente({
  valor,
  onChange,
  sessoes,
}: {
  valor: string;
  onChange: (v: string) => void;
  sessoes: SessionSummary[];
}) {
  const opcoes = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const s of sessoes) {
      if (s.ambienteId) nomes.set(s.ambienteId, s.ambienteNome || s.ambienteId);
    }
    // Ordena pela ordem de apresentação dos ambientes, não pela de gravação.
    const ordem = loadExhibitions().map((e) => e.id);
    const lista = Array.from(nomes.entries()).sort(
      (a, b) => ordem.indexOf(a[0]) - ordem.indexOf(b[0]),
    );
    const contagem = (id: string) => sessoes.filter((s) => s.ambienteId === id).length;
    return [
      { id: "todos", rotulo: `Todos os ambientes (${sessoes.length})` },
      ...lista.map(([id, nome]) => ({ id, rotulo: `${nome} (${contagem(id)})` })),
    ];
  }, [sessoes]);

  if (opcoes.length <= 1) return null;

  return (
    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
      Ambiente
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Cartões de métricas próprias do ambiente escolhido.
 *
 * Cada ambiente mostra o que mede mesmo. Um ambiente sem biometria facial não
 * tem valência para mostrar, e um sem pincel não tem traços — inventar esses
 * números seria pior do que não os ter.
 */
export function MetricasDoAmbiente({
  ambienteId,
  sessoes,
}: {
  ambienteId: string;
  sessoes: SessionSummary[];
}) {
  const cartoes = useMemo(() => {
    const rel = ambienteId === "todos" ? sessoes : sessoes.filter((s) => s.ambienteId === ambienteId);
    if (!rel.length) return [];
    const med = (f: (s: SessionSummary) => number | undefined) => {
      const v = rel.map(f).filter((x): x is number => typeof x === "number");
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
    };
    const soma = (f: (s: SessionSummary) => number | undefined) => {
      const v = rel.map(f).filter((x): x is number => typeof x === "number");
      return v.length ? v.reduce((a, b) => a + b, 0) : null;
    };

    if (ambienteId === "exp1-depth-explorer") {
      return [
        ["Distância média", med((s) => s.metricas?.distanciaMediaCm), "cm"],
        ["Mais perto", med((s) => s.metricas?.distanciaMinCm), "cm"],
        ["Mais longe", med((s) => s.metricas?.distanciaMaxCm), "cm"],
        ["Sessões", rel.length, ""],
      ] as const;
    }
    if (ambienteId === "air-painting") {
      return [
        ["Tempo a pintar", med((s) => s.metricas?.pctTempoAPintar), "%"],
        ["Traços por sessão", med((s) => s.metricas?.tracos), ""],
        ["Traços no total", soma((s) => s.metricas?.tracos), ""],
        ["Com as duas mãos", med((s) => s.metricas?.pctDuasMaos), "%"],
      ] as const;
    }
    if (ambienteId === "fluid-ai") {
      return [
        ["Movimento na sala", med((s) => s.metricas?.energiaMedia), "%"],
        ["Com geração ligada", med((s) => s.metricas?.pctComGeracao), "%"],
        ["Sessões", rel.length, ""],
      ] as const;
    }
    return [
      ["Valência média", med((s) => s.avgValence), "%"],
      ["Ativação média", med((s) => s.metricas?.avgArousal), "%"],
      ["BPM médio", med((s) => s.avgBpm), ""],
      ["Sessões", rel.length, ""],
    ] as const;
  }, [ambienteId, sessoes]);

  if (!cartoes.length) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cartoes.map(([rotulo, valor, unidade]) => (
        <div
          key={rotulo}
          className="rounded-xl p-3.5"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{rotulo}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {valor === null || valor === undefined ? "—" : valor}
            {valor !== null && valor !== undefined && unidade ? (
              <span className="ml-1 text-xs font-normal text-muted-foreground">{unidade}</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
