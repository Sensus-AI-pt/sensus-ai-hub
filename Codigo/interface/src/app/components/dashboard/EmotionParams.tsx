import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";

// Leituras da telemetria, não controlos: os parâmetros que mexem no motor de
// geração (denoising, steps, CFG, seed, prompts) vivem no Ambiente Virtual e
// são enviados por stdin. Aqui os sliders não enviavam nada — em modo manual
// arrastavam-se sem efeito — e os rótulos estavam trocados face aos valores:
// "Excitação" mostrava simetria e "Foco Ocular" mostrava ativação. Rótulo e
// leitura passam a ser definidos no mesmo sítio para não voltarem a divergir.
const LEITURAS = [
  {
    id: "valencia",
    label: "Valência",
    ler: (d: any) => (typeof d?.val === "number" ? Math.round((d.val + 1) / 2 * 100) : null),
  },
  {
    id: "ativacao",
    label: "Ativação (Arousal)",
    ler: (d: any) => (typeof d?.aro === "number" ? Math.round(d.aro * 100) : null),
  },
  {
    id: "simetria",
    label: "Simetria Facial",
    ler: (d: any) => (typeof d?.sym === "number" ? Math.round(d.sym * 100) : null),
  },
  {
    id: "estabilidade",
    label: "Estabilidade da Pose",
    ler: (d: any) =>
      typeof d?.pose?.p === "number"
        ? Math.min(100, Math.max(0, Math.round((1 - Math.abs(d.pose.p) / 45) * 100)))
        : null,
  },
];

export function EmotionParams({ latestData }: { latestData?: any }) {
  return (
    <Card className="border-border bg-card panel-shadow">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-foreground">Leituras do Estado</CardTitle>
        <span className="text-[11px] text-muted-foreground">
          {latestData ? "Em tempo real" : "Sem sinal"}
        </span>
      </CardHeader>
      <CardContent className="space-y-5">
        {LEITURAS.map((p) => {
          const v = p.ler(latestData);
          return (
            <div key={p.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{p.label}</span>
                <span className="text-sm text-cyan glow-text-cyan">
                  {v === null ? "—" : `${v}%`}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="mov-leitura h-full rounded-full"
                  style={{
                    width: `${v ?? 0}%`,
                    background: "var(--primary)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
