import { useEffect, useRef, useState } from "react";
import { Bell, AlertTriangle, CheckCircle2, Eye, HeartPulse, Music2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";

type FeedEvent = {
  id: number;
  titulo: string;
  descricao: string;
  tempo: string; // hh:mm:ss real
  icon: "face" | "bpm" | "blink" | "russell" | "note" | "alert";
};

const ICONS = {
  face: CheckCircle2,
  bpm: HeartPulse,
  blink: Eye,
  russell: Bell,
  note: Music2,
  alert: AlertTriangle,
};

const DOM_LABELS: Record<string, string> = {
  positivo: "Positivo",
  negativo: "Negativo",
  ativado: "Ativado",
  nao_ativado: "Não Ativado",
};

let eventId = 0;

// Feed de eventos em tempo real: cada mudança relevante na telemetria
// (rosto, BPM, piscadelas, quadrante de Russell, nota musical) gera uma
// entrada datada — em vez de 4 linhas estáticas que nunca mudavam.
export function RecentActivity({ latestData }: { latestData?: any }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const prev = useRef<{ face?: boolean; bpmZone?: number; blinks?: number; dom?: string; noteId?: number }>({});

  useEffect(() => {
    if (!latestData) {
      prev.current = {};
      return;
    }
    const now = new Date().toLocaleTimeString("pt-PT");
    const add: FeedEvent[] = [];
    const p = prev.current;

    const face = !!latestData.face;
    if (p.face === undefined || face !== p.face) {
      add.push({
        id: ++eventId,
        titulo: face ? "Rosto detetado" : "Rosto perdido",
        descricao: face ? "Landmarks faciais ativos — análise em curso" : "Sem sinal facial; telemetria neutra",
        tempo: now,
        icon: face ? "face" : "alert",
      });
    }

    // BPM: regista quando muda de faixa de 5 BPM (evita spam por flutuação)
    const bpm = typeof latestData.bpm === "number" ? Math.round(latestData.bpm) : 0;
    const bpmZone = bpm > 0 ? Math.round(bpm / 5) : 0;
    if (bpm > 0 && bpmZone !== p.bpmZone) {
      add.push({
        id: ++eventId,
        titulo: p.bpmZone === undefined || p.bpmZone === 0 ? "Sinal cardíaco (rPPG)" : "Ritmo cardíaco atualizado",
        descricao: `${bpm} BPM estimados por rPPG`,
        tempo: now,
        icon: "bpm",
      });
    }

    const blinks = typeof latestData.blinks === "number" ? latestData.blinks : 0;
    if (p.blinks !== undefined && blinks > p.blinks) {
      add.push({
        id: ++eventId,
        titulo: "Piscadela registada",
        descricao: `${blinks} piscadelas desde o início da sessão`,
        tempo: now,
        icon: "blink",
      });
    }

    const dom = typeof latestData.dom === "string" ? latestData.dom : "";
    if (dom && dom !== "—" && dom !== p.dom) {
      add.push({
        id: ++eventId,
        titulo: "Estado dimensional (Russell)",
        descricao: `Quadrante dominante: ${DOM_LABELS[dom] || dom} · Val ${(latestData.val ?? 0).toFixed(2)} · Aro ${(latestData.aro ?? 0).toFixed(2)}`,
        tempo: now,
        icon: "russell",
      });
    }

    const noteId = typeof latestData.note_id === "number" ? latestData.note_id : undefined;
    if (noteId !== undefined && noteId !== p.noteId && latestData.note && p.noteId !== undefined) {
      add.push({
        id: ++eventId,
        titulo: "Nota musical gerada",
        descricao: `Melodia bio-reativa: ${latestData.note}`,
        tempo: now,
        icon: "note",
      });
    }

    prev.current = { face, bpmZone, blinks, dom: dom || p.dom, noteId };
    if (add.length > 0) {
      setEvents((cur) => [...add.reverse(), ...cur].slice(0, 8));
    }
  }, [latestData]);

  return (
    <Card className="border-border bg-card panel-shadow">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-foreground">Atividade Recente</CardTitle>
        {latestData && (
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-positive">
            <span className="mov-respira inline-flex size-2 rounded-full bg-positive" />
            Live
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-1">
        {events.length === 0 && (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-secondary/10 p-6 text-xs text-muted-foreground">
            {latestData ? "A aguardar eventos da sessão..." : "Sem sessão ativa — inicie o ambiente virtual"}
          </div>
        )}
        {events.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-secondary/40 animate-in fade-in slide-in-from-top-1 duration-300"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                <Icon className="size-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{item.titulo}</p>
                <p className="truncate text-xs text-muted-foreground">{item.descricao}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground font-mono">{item.tempo}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
