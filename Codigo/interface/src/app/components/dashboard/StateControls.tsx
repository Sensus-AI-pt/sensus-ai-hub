import { Eye, Radar, Wand2, Layers } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Switch } from "../ui/switch";
import { useSettings } from "../../../context/SettingsContext";

declare global {
  interface Window {
    electronAPI?: any;
  }
}

// Só entra aqui o que o motor sabe responder. Os interruptores antigos de
// "StreamDiffusion IA" e "Sintetizador DDSP" nasciam ligados por omissão e não
// mandavam comando nenhum: mexer neles mudava a cor do cartão e mais nada. O
// StreamDiffusion não tem liga/desliga em execução (é a exposição carregada que
// o decide), por isso passa a mostrar o estado que o motor reporta. O
// sintetizador e a análise de voz comandam-se no Ambiente Virtual, onde vive o
// resto do áudio, e não se duplicam aqui.
export function StateControls({ latestData }: { latestData?: any }) {
  const { activeSensors, setActiveSensors } = useSettings();

  // O rastreio está ligado se algum sensor estiver ativo. Desligar tudo é o
  // equivalente honesto do interruptor antigo, e o comando sai pelo contexto.
  const sensores = Object.values(activeSensors ?? {});
  const rastreioAtivo = sensores.some(Boolean);
  const alternarRastreio = () => {
    const ligar = !rastreioAtivo;
    setActiveSensors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next) as (keyof typeof next)[]) next[k] = ligar;
      return next;
    });
  };

  const estadoMotor = (estado?: string) =>
    estado === "ready"
      ? { texto: "Pronto", ok: true }
      : estado === "erro"
      ? { texto: "Indisponível", ok: false }
      : estado
      ? { texto: "A carregar", ok: false }
      : { texto: "—", ok: false };

  const geracao = estadoMotor(latestData?.sd_status);
  const profundidade = estadoMotor(latestData?.depth_status);

  return (
    <Card className="border-border bg-card panel-shadow">
      <CardHeader>
        <CardTitle className="text-foreground">Estado do Motor</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        {/* Rastreio biométrico — o único comutável a partir daqui */}
        <div
          className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${
            rastreioAtivo ? "border-primary/40 bg-primary/10 glow-primary" : "border-border bg-secondary/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <div
              className={`flex size-9 items-center justify-center rounded-lg ${
                rastreioAtivo ? "bg-primary/25 text-primary glow-text-primary" : "bg-secondary text-muted-foreground"
              }`}
            >
              <Radar className="size-4" />
            </div>
            <Switch checked={rastreioAtivo} onCheckedChange={alternarRastreio} />
          </div>
          <span className="text-sm text-foreground">Rastreio Biométrico</span>
        </div>

        {/* Calibração — é uma ação, não um estado: era um interruptor que nunca
            se desligava sozinho depois de calibrar. */}
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-secondary/40 p-4">
          <div className="flex items-center justify-between">
            <div className="flex size-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
              <Eye className="size-4" />
            </div>
            <button
              type="button"
              onClick={() => window.electronAPI?.sendRPPGCommand?.("CALIBRATE")}
              disabled={!latestData}
              className="rounded-lg border border-border px-2.5 py-1 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
            >
              Calibrar
            </button>
          </div>
          <span className="text-sm text-foreground">Calibrar Rosto</span>
        </div>

        {[
          { label: "Motor de Geração", icon: Wand2, estado: geracao },
          { label: "Mapa de Profundidade", icon: Layers, estado: profundidade },
        ].map(({ label, icon: Icon, estado }) => (
          <div
            key={label}
            className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${
              estado.ok ? "border-primary/40 bg-primary/10" : "border-border bg-secondary/40"
            }`}
            style={{
              transitionDuration: "var(--mov-normal)",
              transitionTimingFunction: "var(--mov-resposta)",
            }}
          >
            <div className="flex items-center justify-between">
              <div
                className={`flex size-9 items-center justify-center rounded-lg transition-colors ${
                  estado.ok ? "bg-primary/25 text-primary" : "bg-secondary text-muted-foreground"
                }`}
                style={{
                  transitionDuration: "var(--mov-normal)",
                  transitionTimingFunction: "var(--mov-resposta)",
                }}
              >
                <Icon className="size-4" />
              </div>
              <span className="text-[11px] text-muted-foreground">{estado.texto}</span>
            </div>
            <span className="text-sm text-foreground">{label}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
