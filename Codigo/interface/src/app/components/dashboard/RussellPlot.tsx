import { useEffect, useRef, useState } from "react";

const TAMANHO = 150;
const MAX_RASTO = 40;

/** Quadrantes desenhados no plano. As fronteiras são as do motor: val=0, aro=0.5. */
const QUADRANTES = [
  { chave: "ativado_negativo", x: 0, y: 0 },
  { chave: "ativado_positivo", x: TAMANHO / 2, y: 0 },
  { chave: "calmo_negativo", x: 0, y: TAMANHO / 2 },
  { chave: "calmo_positivo", x: TAMANHO / 2, y: TAMANHO / 2 },
] as const;

/**
 * Plano valência × arousal — modelo circumplexo do afeto (Russell, 1980).
 *
 * Atenção: o *plano* é o modelo publicado; os *valores* que o alimentam vêm de
 * heurísticas internas do engine, com ganhos arbitrários e sem validação publicada
 * (auditoria de sensores de 2026-07-24). Não descrever estes valores como validados.
 *
 * Duas variantes: `flutuante` (a de sempre, sobreposta ao feed da câmara, para os
 * ambientes cujo painel não tem onde a arrumar) e `painel`, que se integra na
 * secção de parâmetros e cresce com a coluna que a contém.
 */
export function RussellPlot({
  val,
  aro,
  variante = "flutuante",
  quadranteAtivo,
  componentes,
}: {
  val?: number;
  aro?: number;
  variante?: "flutuante" | "painel";
  /** Quadrante em foco, para casar o realce com as prompts ao lado. */
  quadranteAtivo?: string;
  /**
   * De onde vem a ativação, 0..1 por componente (`aro_comp` na telemetria).
   * `null` = esse sinal ainda não tem história ou está parado demais para
   * contar. Mostrado porque um eixo que não mexe é indistinguível de um eixo
   * avariado — foi assim que a ativação passou meses presa em zero.
   */
  componentes?: {
    cardiaco: number | null;
    movimento: number | null;
    rosto: number | null;
    piscar?: number | null;
  };
}) {
  const rasto = useRef<Array<[number, number]>>([]);
  const [, forcarRender] = useState(0);

  const vNum = typeof val === "number" && Number.isFinite(val) ? val : 0;
  // Sem telemetria, o ponto fica no cruzamento dos eixos (val 0, aro 0,5) — o
  // mesmo neutro que o motor usa para decidir o quadrante. Com o recurso a 0 o
  // ponto caía no fundo do plano enquanto o quadrante realçado dizia "ativado",
  // uma contradição que só se via agora que os dois estão lado a lado.
  const aNum = typeof aro === "number" && Number.isFinite(aro) ? aro : 0.5;

  // x: valência -1..1 -> 0..1 · y: arousal 0..1, invertido (SVG cresce para baixo)
  const x = Math.min(1, Math.max(0, (vNum + 1) / 2));
  const y = 1 - Math.min(1, Math.max(0, aNum));

  useEffect(() => {
    rasto.current.push([x, y]);
    if (rasto.current.length > MAX_RASTO) rasto.current.shift();
    forcarRender((n) => (n + 1) % 1000);
  }, [x, y]);

  const px = (n: number) => n * TAMANHO;
  const noPainel = variante === "painel";

  const plano = (
    <svg
      viewBox={`0 0 ${TAMANHO} ${TAMANHO}`}
      width={noPainel ? "100%" : TAMANHO}
      height={noPainel ? undefined : TAMANHO}
      className={noPainel ? "block h-auto w-full" : undefined}
      role="img"
      aria-label="Modelo circumplexo de Russell"
    >
      <rect width={TAMANHO} height={TAMANHO} fill="transparent" />

      {/* O quadrante ativo pintado por baixo da grelha: no painel, é ele que liga
          o ponto medido à prompt que está a ser usada. */}
      {noPainel &&
        QUADRANTES.map(({ chave, x: qx, y: qy }) => (
          <rect
            key={chave}
            x={qx}
            y={qy}
            width={TAMANHO / 2}
            height={TAMANHO / 2}
            fill="var(--brand-primary)"
            opacity={chave === quadranteAtivo ? 0.14 : 0}
          />
        ))}

      <line
        x1={TAMANHO / 2}
        y1={0}
        x2={TAMANHO / 2}
        y2={TAMANHO}
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={1}
      />
      <line
        x1={0}
        y1={TAMANHO / 2}
        x2={TAMANHO}
        y2={TAMANHO / 2}
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={1}
      />

      <text x={TAMANHO / 2 + 4} y={9} fontSize={7} fill="var(--brand-text-muted)" opacity={0.55}>
        ativado
      </text>
      <text
        x={TAMANHO / 2 + 4}
        y={TAMANHO - 3}
        fontSize={7}
        fill="var(--brand-text-muted)"
        opacity={0.55}
      >
        não ativado
      </text>
      <text x={2} y={TAMANHO / 2 - 4} fontSize={7} fill="var(--brand-text-muted)" opacity={0.55}>
        negativo
      </text>
      <text
        x={TAMANHO - 32}
        y={TAMANHO / 2 - 4}
        fontSize={7}
        fill="var(--brand-text-muted)"
        opacity={0.55}
      >
        positivo
      </text>

      {rasto.current.map(([rx, ry], i) => (
        <circle
          key={i}
          cx={px(rx)}
          cy={px(ry)}
          r={1.5}
          fill="var(--brand-secondary)"
          opacity={(i / Math.max(1, rasto.current.length)) * 0.4}
        />
      ))}

      <circle
        cx={px(x)}
        cy={px(y)}
        r={4}
        fill="var(--brand-primary)"
        style={{
          transition: "cx var(--mov-normal) var(--mov-resposta), cy var(--mov-normal) var(--mov-resposta)",
        }}
      />
    </svg>
  );

  if (!noPainel) {
    return (
      <div
        className="pointer-events-none absolute bottom-3 left-3 rounded-sm p-2 backdrop-blur-sm"
        style={{
          background: "rgba(8,11,22,0.55)",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {plano}
        <span
          className="mt-1 block text-center text-[8px]"
          style={{ color: "var(--brand-text-muted)", opacity: 0.5 }}
        >
          Russell (1980)
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-xl p-3"
      style={{ background: "rgba(0,0,0,0.22)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <span
        className="text-[10px] font-medium uppercase tracking-[0.12em]"
        style={{ color: "rgba(255,255,255,0.38)" }}
      >
        Estado medido
      </span>
      {plano}
      <div className="grid grid-cols-2 gap-1.5">
        {(
          [
            ["Valência", vNum.toFixed(2)],
            ["Ativação", aNum.toFixed(2)],
          ] as const
        ).map(([rotulo, valor]) => (
          <div
            key={rotulo}
            className="flex flex-col rounded-lg px-2 py-1.5"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <span className="text-[9px]" style={{ color: "var(--brand-text-muted)" }}>
              {rotulo}
            </span>
            <span className="text-[12px] tabular-nums" style={{ color: "var(--brand-text)" }}>
              {valor}
            </span>
          </div>
        ))}
      </div>
      {componentes && (
        <div className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <span
            className="text-[9px] font-medium uppercase tracking-[0.1em]"
            style={{ color: "rgba(255,255,255,0.32)" }}
          >
            Ativação vem de
          </span>
          {(
            [
              ["cardiaco", "Cardíaco", componentes.cardiaco],
              ["movimento", "Movimento", componentes.movimento],
              ["piscar", "Pestanejo", componentes.piscar ?? null],
              ["rosto", "Rosto", componentes.rosto],
            ] as const
          ).map(([chave, rotulo, valor]) => (
            <div key={chave} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-[9px]" style={{ color: "var(--brand-text-muted)" }}>
                {rotulo}
              </span>
              <span
                className="h-1 flex-1 overflow-hidden rounded-full"
                style={{ background: "rgba(255,255,255,0.08)" }}
              >
                <span
                  className="mov-leitura block h-full rounded-full"
                  style={{
                    width: `${Math.round((valor ?? 0) * 100)}%`,
                    background:
                      "linear-gradient(90deg, var(--brand-primary) 0%, var(--brand-secondary) 100%)",
                  }}
                />
              </span>
              <span
                className="w-8 shrink-0 text-right text-[9px] tabular-nums"
                style={{ color: valor === null ? "rgba(255,255,255,0.25)" : "var(--brand-text)" }}
                title={valor === null ? "Sinal ainda sem história suficiente, ou parado demais para contar" : undefined}
              >
                {valor === null ? "—" : valor.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
      <span className="text-[9px]" style={{ color: "var(--brand-text-muted)", opacity: 0.55 }}>
        Plano de Russell (1980). A ativação combina frequência cardíaca acima do repouso da própria
        pessoa, movimento e expressão facial — com pesos heurísticos, sem validação publicada.
      </span>
    </div>
  );
}
