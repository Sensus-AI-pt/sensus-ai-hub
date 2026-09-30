import { useEffect, useState } from "react";
import {
  LineChart as LineChartIcon,
  FileText,
  BarChart3,
  Map,
  Video,
  Download,
  Play,
  Clock,
  Loader2,
  Trash2,
  Eye,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { PageHeader } from "./PageHeader";
import { SeletorAmbiente, MetricasDoAmbiente } from "./SeletorAmbiente";
import { getSessionSummaries } from "./sessionHistory";
import { BehaviorTable } from "./BehaviorTable";
import { ActivityChart } from "./ActivityChart";
import { RecentActivity } from "./RecentActivity";

const meta: Record<
  string,
  { subtitle: string; icon: React.ComponentType<{ className?: string }> }
> = {
  Análise: { subtitle: "Análise comportamental em tempo real", icon: LineChartIcon },
  Relatórios: { subtitle: "Relatórios e resumos gerados", icon: FileText },
  Gráficos: { subtitle: "Visualização gráfica dos dados", icon: BarChart3 },
  "Mapa Emocional": { subtitle: "Distribuição emocional por espaço", icon: Map },
  Vídeos: { subtitle: "Registos de vídeo das sessões", icon: Video },
};

const tooltipStyle = {
  background: "#1a1f3a",
  border: "1px solid rgba(123,63,226,0.3)",
  borderRadius: 12,
  color: "#eef0ff",
  boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
  padding: "8px 12px",
};

export function MonitoringPage({
  section,
  latestData,
  history,
  searchQuery = "",
}: {
  section: string;
  latestData?: any;
  history?: any[];
  searchQuery?: string;
}) {
  const info = meta[section] ?? { subtitle: "Monitorização sensorial", icon: LineChartIcon };

  const [ambienteSel, setAmbienteSel] = useState("todos");
  const [sessoesGravadas] = useState(() => getSessionSummaries());

  return (
    <div className="relative z-10 flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary glow-text-primary">
          <info.icon className="size-5" />
        </div>
        <PageHeader title={section} subtitle={info.subtitle} />
        <div className="ml-auto">
          <SeletorAmbiente valor={ambienteSel} onChange={setAmbienteSel} sessoes={sessoesGravadas} />
        </div>
      </div>

      {/* Métricas do ambiente escolhido, acima dos gráficos ao vivo. */}
      <MetricasDoAmbiente ambienteId={ambienteSel} sessoes={sessoesGravadas} />

      {section === "Análise" && <AnaliseSection latestData={latestData} history={history} />}
      {section === "Relatórios" && <RelatoriosSection latestData={latestData} searchQuery={searchQuery} />}
      {section === "Gráficos" && <GraficosSection latestData={latestData} history={history} />}
      {section === "Mapa Emocional" && <MapaEmocionalSection latestData={latestData} />}
      {section === "Vídeos" && <VideosSection searchQuery={searchQuery} />}
    </div>
  );
}

/* ---------- Análise ---------- */
function AnaliseSection({ latestData, history }: { latestData?: any; history?: any[] }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ActivityChart history={history} />
        </div>
        <RecentActivity latestData={latestData} />
      </div>
      <SalaCard latestData={latestData} />
      <BehaviorTable latestData={latestData} />
    </>
  );
}

/* ---------- Sensores de Sala ---------- */
function SalaCard({ latestData }: { latestData?: any }) {
  const room = latestData?.room;
  const energy = typeof room?.energy === "number" ? room.energy : 0;
  const flow = Array.isArray(room?.flow) ? room.flow : [0, 0];
  const fx = typeof flow[0] === "number" ? flow[0] : 0;
  const fy = typeof flow[1] === "number" ? flow[1] : 0;
  // Coordenadas de imagem (y para baixo) coincidem com a rotação CSS (horária)
  const angle = Math.atan2(fy, fx);
  const count = typeof room?.count === "number" ? room.count : 0;
  const people = Array.isArray(room?.people) ? room.people : [];
  const gesture = room?.gesture;

  return (
    <Card className="border-border panel-shadow">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-foreground">Sensores de Sala</CardTitle>
        {!room && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Sem sessão ativa — valores a zero
          </span>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {/* Energia do movimento coletivo (fluxo ótico global) */}
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/15 p-4">
            <span className="text-xs text-muted-foreground">Energia do Movimento</span>
            <span className="font-mono text-2xl text-cyan glow-text-cyan">{Math.round(energy * 100)}%</span>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/40">
              <div
                className="mov-leitura h-full rounded-full bg-gradient-to-r from-cyan to-primary"
                style={{ width: `${Math.min(100, energy * 100)}%` }}
              />
            </div>
          </div>

          {/* Direção dominante do fluxo — esbatida sem movimento (direção = ruído) */}
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/15 p-4">
            <span className="text-xs text-muted-foreground">Direção Dominante</span>
            <div className={`flex flex-1 items-center justify-center transition-opacity duration-300 ${energy < 0.05 ? "opacity-20" : "opacity-100"}`}>
              <span
                className="inline-block text-3xl text-primary glow-text-primary transition-transform duration-300"
                style={{ transform: `rotate(${angle}rad)` }}
              >
                →
              </span>
            </div>
          </div>

          {/* Visitantes: contagem + mini-mapa (tamanho do ponto ∝ proximidade) */}
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/15 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Visitantes</span>
              <span className="font-mono text-2xl text-foreground">{count}</span>
            </div>
            <div className="relative min-h-20 flex-1 overflow-hidden rounded-lg border border-border/60 bg-background/40">
              {people.map((p: any, i: number) =>
                typeof p?.x === "number" && typeof p?.y === "number" ? (
                  <span
                    key={i}
                    className="absolute rounded-full bg-cyan/70 shadow-[0_0_8px_rgba(0,229,255,0.6)] transition-all duration-300"
                    style={{
                      left: `${p.x * 100}%`,
                      top: `${p.y * 100}%`,
                      width: `${Math.max(6, (typeof p.s === "number" ? p.s : 0.05) * 60)}px`,
                      height: `${Math.max(6, (typeof p.s === "number" ? p.s : 0.05) * 60)}px`,
                      transform: "translate(-50%, -50%)",
                    }}
                  />
                ) : null
              )}
            </div>
          </div>

          {/* Gestos macro (braços abertos / agachado) */}
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/15 p-4">
            <span className="text-xs text-muted-foreground">Gestos Macro</span>
            {gesture ? (
              <div className="flex flex-1 flex-col justify-center gap-2">
                <Badge
                  variant="secondary"
                  className={gesture.arms ? "border-cyan/30 bg-cyan/10 text-cyan" : "border-border bg-secondary/20 text-muted-foreground"}
                >
                  Braços Abertos
                </Badge>
                <Badge
                  variant="secondary"
                  className={gesture.crouch ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-secondary/20 text-muted-foreground"}
                >
                  Agachado
                </Badge>
              </div>
            ) : (
              <span className="flex flex-1 items-center text-[10px] leading-relaxed text-muted-foreground">
                Sensor desligado — ative "Gestos de Corpo" nas Definições
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Relatórios ---------- */
const REPORTS_KEY = "sensus-reports";

const seedReports: any[] = [
  {
    id: "r-1",
    nome: "Sessão Sensus #1024 — Regulação Emocional Coletiva",
    tipo: "Regulação Emocional",
    data: "Ontem, 16:45",
    estado: "Concluído"
  },
  {
    id: "r-2",
    nome: "Sessão Sensus #1023 — Calibração Jardim Fluido",
    tipo: "Jardim Fluido",
    data: "Ontem, 14:30",
    estado: "Concluído"
  },
  {
    id: "r-3",
    nome: "Sessão Sensus #1022 — Imersão Lego World",
    tipo: "Lego World",
    data: "Anteontem, 11:15",
    estado: "Concluído"
  }
];

function loadStoredReports(): any[] {
  try {
    const raw = localStorage.getItem(REPORTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  localStorage.setItem(REPORTS_KEY, JSON.stringify(seedReports));
  return seedReports;
}

function buildReportContent(report: any, latestData?: any): string {
  let content = `ID: ${report.id}\nTítulo: ${report.nome}\nAmbiente: ${report.tipo}\nData: ${report.data}\nEstado: ${report.estado}\n`;
  if (report.id === "r-active" && latestData) {
    content += `\n--- TELEMETRIA EM TEMPO REAL ---\nBPM: ${latestData.bpm}\nValence: ${latestData.val}\nArousal: ${latestData.aro}\nSymmetry: ${latestData.sym}\nBlinks: ${latestData.blinks}\nGaze: ${latestData.gaze ? `${latestData.gaze[0]};${latestData.gaze[1]}` : "0;0"}\nFixation Duration: ${latestData.fixation} ms\nDominante: ${latestData.dom}\n`;
  } else {
    content += `\nMock report file generated by Sensus AI Hub.\n`;
  }
  return content;
}

function RelatoriosSection({ latestData, searchQuery = "" }: { latestData?: any; searchQuery?: string }) {
  const [storedReports, setStoredReports] = useState<any[]>(() => loadStoredReports());
  const [previewReport, setPreviewReport] = useState<any>(null);

  const handleDeleteReport = (report: any) => {
    const next = storedReports.filter((r) => r.id !== report.id);
    setStoredReports(next);
    localStorage.setItem(REPORTS_KEY, JSON.stringify(next));
    if (previewReport?.id === report.id) setPreviewReport(null);
  };

  const reportsList = (latestData ? [
    {
      id: "r-active",
      nome: `Sessão Sensus #1025 — Regulação Em Tempo Real`,
      tipo: localStorage.getItem("sensus-active-prompt") || "Regulação Emocional",
      data: "Hoje (Sessão Ativa)",
      estado: "Em Execução"
    },
    ...storedReports
  ] : storedReports).filter(r =>
    r.nome.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.tipo.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDownloadReport = async (report: any) => {
    const mockContent = buildReportContent(report, latestData);

    if (window.electronAPI) {
      try {
        const defaultName = `${report.nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ /g, "-")}.txt`;
        const saveResult = await window.electronAPI.showSaveDialog({
          title: "Guardar Relatório da Sessão",
          defaultPath: defaultName,
          filters: [{ name: "Ficheiros de Texto", extensions: ["txt"] }],
        });

        if (saveResult && !saveResult.canceled && saveResult.filePath) {
          await window.electronAPI.writeCSV(saveResult.filePath, mockContent);
          alert(`Relatório guardado com sucesso em:\n${saveResult.filePath}`);
        }
      } catch (err) {
        console.error(err);
        alert("Erro ao guardar o ficheiro.");
      }
    } else {
      const dataStr = "data:text/plain;charset=utf-8," + encodeURIComponent(mockContent);
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `${report.nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ /g, "-")}.txt`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    }
  };

  return (
    <>
      <Card className="border-border panel-shadow">
        <CardHeader>
          <CardTitle className="text-foreground">Relatórios Gerados</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {reportsList.length === 0 && (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-border bg-secondary/10 p-8 text-xs text-muted-foreground">
              Sem relatórios — inicie uma sessão para gerar novos registos
            </div>
          )}
          {reportsList.map((r) => {
            const done = r.estado === "Concluído";
            return (
              <div
                key={r.id}
                className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 p-4 animate-in fade-in duration-300"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <FileText className="size-5" />
                </div>
                <div className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-sm text-foreground">{r.nome}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {r.tipo} · {r.data}
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <Badge
                    variant="secondary"
                    className={
                      done
                        ? "border-positive/30 bg-positive/10 text-positive mr-2"
                        : "border-cyan/30 bg-cyan/10 text-cyan mov-respira mr-2"
                    }
                  >
                    {!done && <Loader2 className="mr-1 size-3 animate-spin" />}
                    {r.estado}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setPreviewReport(r)}
                    className="text-muted-foreground hover:text-cyan cursor-pointer"
                    title="Pré-visualizar Relatório"
                  >
                    <Eye className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDownloadReport(r)}
                    className="text-muted-foreground hover:text-primary cursor-pointer"
                    title="Descarregar Relatório"
                  >
                    <Download className="size-4" />
                  </Button>
                  {r.id !== "r-active" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDeleteReport(r)}
                      className="text-muted-foreground hover:text-rose-400 cursor-pointer"
                      title="Apagar Relatório"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Pré-visualização inline do relatório */}
      {previewReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
          onClick={() => setPreviewReport(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-border bg-card panel-shadow animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-border p-4">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <FileText className="size-4" />
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm text-foreground">{previewReport.nome}</p>
                <p className="text-xs text-muted-foreground">{previewReport.tipo} · {previewReport.data}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => handleDownloadReport(previewReport)}
                className="text-muted-foreground hover:text-primary cursor-pointer"
                title="Descarregar"
              >
                <Download className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setPreviewReport(null)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
                title="Fechar"
              >
                <X className="size-4" />
              </Button>
            </div>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap p-5 font-mono text-xs leading-relaxed text-foreground/90">
              {buildReportContent(previewReport, latestData)}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Gráficos ---------- */
// Rótulos das AUs (FACS) para o gráfico de barras em tempo real
const AU_CHART_LABELS: [string, string][] = [
  ["1", "AU1"], ["2", "AU2"], ["4", "AU4"], ["5", "AU5"], ["6", "AU6"],
  ["9", "AU9"], ["12", "AU12"], ["15", "AU15"], ["17", "AU17"],
  ["20", "AU20"], ["23", "AU23"], ["25", "AU25"], ["26", "AU26"],
];

function GraficosSection({ latestData, history }: { latestData?: any; history?: any[] }) {
  const hasHistory = history && history.length > 0;
  const bpmHistoryData = hasHistory ? history.filter((h) => h.b > 0) : [];

  // Trajetória no circumplexo de Russell (1980): valência (x) × arousal (y)
  const russellTrajectory = hasHistory
    ? history.map((h, i) => ({ x: h.a, y: h.c, idx: i }))
    : [];
  const currentPoint = latestData
    ? [{
        x: Math.round(((typeof latestData.val === "number" ? latestData.val : 0) + 1) / 2 * 100),
        y: Math.round((typeof latestData.aro === "number" ? latestData.aro : 0) * 100),
      }]
    : [];

  // Intensidade das Action Units medidas neste instante
  const au = latestData?.au || {};
  const auData = AU_CHART_LABELS.map(([code, label]) => ({
    name: label,
    v: typeof au[code] === "number" ? Math.round(Math.max(0, Math.min(1, au[code])) * 100) : 0,
  }));

  const sensoryHistoryData = hasHistory ? history : [];

  const emptyState = (msg: string) => (
    <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-border bg-secondary/10 text-xs text-muted-foreground">
      {msg}
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Ritmo cardíaco (rPPG) ao longo da sessão */}
      <Card className="border-border panel-shadow">
        <CardHeader>
          <CardTitle className="text-foreground">Ritmo Cardíaco em Tempo Real (rPPG)</CardTitle>
        </CardHeader>
        <CardContent>
          {bpmHistoryData.length > 1 ? (
            <div className="h-56 w-full" style={{ filter: "drop-shadow(0 0 6px rgba(0,229,255,0.3))" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={bpmHistoryData} margin={{ left: -20, right: 8, top: 8 }}>
                  <defs key="dbpm">
                    <linearGradient id="gbpm" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00e5ff" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#00e5ff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid key="g" strokeDasharray="3 3" stroke="rgba(0,229,255,0.1)" vertical={false} />
                  <XAxis key="x" dataKey="name" stroke="#8b90b8" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis key="y" stroke="#8b90b8" fontSize={11} tickLine={false} axisLine={false} domain={["dataMin - 5", "dataMax + 5"]} />
                  <Tooltip key="t" contentStyle={tooltipStyle} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#fff" }} />
                  <Area key="a" type="monotone" dataKey="b" stroke="#00e5ff" strokeWidth={2} fill="url(#gbpm)" name="Batimentos (BPM)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : emptyState("A aguardar sinal cardíaco válido (rPPG em calibração)")}
        </CardContent>
      </Card>

      {/* Circumplexo de Russell: trajetória valência × arousal */}
      <Card className="border-border panel-shadow">
        <CardHeader>
          <CardTitle className="text-foreground">Circumplexo de Russell — Valência × Arousal</CardTitle>
        </CardHeader>
        <CardContent>
          {russellTrajectory.length > 0 || currentPoint.length > 0 ? (
            <div className="h-56 w-full" style={{ filter: "drop-shadow(0 0 6px rgba(123,63,226,0.4))" }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ left: -20, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid key="g" strokeDasharray="3 3" stroke="rgba(123,63,226,0.1)" />
                  <XAxis key="x" type="number" dataKey="x" domain={[0, 100]} stroke="#8b90b8" fontSize={11} tickLine={false} axisLine={false} name="Valência" unit="%" />
                  <YAxis key="y" type="number" dataKey="y" domain={[0, 100]} stroke="#8b90b8" fontSize={11} tickLine={false} axisLine={false} name="Arousal" unit="%" />
                  <ZAxis key="z" range={[30, 30]} />
                  <ReferenceLine key="rx" x={50} stroke="rgba(139,144,184,0.35)" strokeDasharray="4 4" />
                  <ReferenceLine key="ry" y={50} stroke="rgba(139,144,184,0.35)" strokeDasharray="4 4" />
                  <Tooltip key="t" contentStyle={tooltipStyle} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#fff" }} cursor={{ strokeDasharray: "3 3" }} />
                  <Scatter key="traj" name="Trajetória" data={russellTrajectory} fill="rgba(123,63,226,0.45)" isAnimationActive={false} />
                  <Scatter key="cur" name="Estado Atual" data={currentPoint} fill="#00e5ff" isAnimationActive={false} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : emptyState("Sem sessão ativa — a trajetória emocional aparece aqui")}
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            Quadrantes: direita = valência positiva · cima = ativação alta. Ponto ciano = estado atual.
          </p>
        </CardContent>
      </Card>

      {/* Action Units em tempo real */}
      <Card className="border-border panel-shadow">
        <CardHeader>
          <CardTitle className="text-foreground">Action Units (FACS) — Intensidade Atual</CardTitle>
        </CardHeader>
        <CardContent>
          {latestData ? (
            <div className="h-56 w-full" style={{ filter: "drop-shadow(0 0 6px rgba(123,63,226,0.3))" }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={auData} margin={{ left: -20, right: 8, top: 8 }}>
                  <defs key="dau">
                    <linearGradient id="gau" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7b3fe2" stopOpacity={1} />
                      <stop offset="100%" stopColor="#00e5ff" stopOpacity={0.7} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid key="g" strokeDasharray="3 3" stroke="rgba(123,63,226,0.1)" vertical={false} />
                  <XAxis key="x" dataKey="name" stroke="#8b90b8" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis key="y" domain={[0, 100]} stroke="#8b90b8" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip key="t" contentStyle={tooltipStyle} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#fff" }} cursor={{ fill: "rgba(123,63,226,0.08)" }} />
                  <Bar key="b" dataKey="v" fill="url(#gau)" radius={[4, 4, 0, 0]} name="Intensidade (%)" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : emptyState("Sem sessão ativa — as Action Units aparecem aqui")}
        </CardContent>
      </Card>

      {/* Valência, Arousal e Íris ao longo da sessão */}
      <Card className="border-border panel-shadow">
        <CardHeader>
          <CardTitle className="text-foreground">Valência, Arousal e Íris na Sessão</CardTitle>
        </CardHeader>
        <CardContent>
          {sensoryHistoryData.length > 1 ? (
            <div className="h-56 w-full" style={{ filter: "drop-shadow(0 0 6px rgba(123,63,226,0.3))" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sensoryHistoryData} margin={{ left: -20, right: 8, top: 8 }}>
                  <defs key="dsens">
                    <linearGradient id="gval" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7b3fe2" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#7b3fe2" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="garo" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00e5ff" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#00e5ff" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="giris" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34e5a3" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#34e5a3" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid key="g" strokeDasharray="3 3" stroke="rgba(123,63,226,0.1)" vertical={false} />
                  <XAxis key="x" dataKey="name" stroke="#8b90b8" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis key="y" stroke="#8b90b8" fontSize={11} tickLine={false} axisLine={false} domain={[0, 100]} />
                  <Tooltip key="t" contentStyle={tooltipStyle} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#fff" }} />
                  <Area key="aval" type="monotone" dataKey="a" stroke="#7b3fe2" strokeWidth={2} fill="url(#gval)" name="Valência (%)" isAnimationActive={false} />
                  <Area key="aaro" type="monotone" dataKey="c" stroke="#00e5ff" strokeWidth={2} fill="url(#garo)" name="Arousal (%)" isAnimationActive={false} />
                  <Area key="airis" type="monotone" dataKey="i" stroke="#34e5a3" strokeWidth={2} fill="url(#giris)" name="Dilatação da Íris (%)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : emptyState("Sem sessão ativa — a evolução temporal aparece aqui")}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- Mapa Emocional ---------- */
const zones = ["Jardim Fluido", "Geometria Abstrata", "Lego World", "Espaço Cósmico", "Tons de Outono", "Cyberpunk Neon"];
const emotions = ["Valência Positiva", "Excitação (Arousal)", "Simetria Facial", "Taxa de Piscadas", "Dilatação Íris"];

// Estado de fábrica: tudo a zero — só a zona ativa recebe valores medidos.
const zeroHeat = () => zones.map(() => emotions.map(() => 0));

function heatColor(v: number) {
  if (v <= 0) return "rgba(139,144,184,0.08)";
  const alpha = 0.15 + (Math.min(100, v) / 100) * 0.75;
  return v > 55
    ? `rgba(123, 63, 226, ${alpha})`
    : `rgba(0, 229, 255, ${alpha})`;
}

function MapaEmocionalSection({ latestData }: { latestData?: any }) {
  const activePrompt = localStorage.getItem("sensus-active-prompt") || "lego";
  let activeZoneIndex = 2; // Default to Lego World

  if (activePrompt.toLowerCase().includes("jardim") || activePrompt.toLowerCase().includes("fluido")) {
    activeZoneIndex = 0;
  } else if (activePrompt.toLowerCase().includes("geometria") || activePrompt.toLowerCase().includes("abstrata")) {
    activeZoneIndex = 1;
  } else if (activePrompt.toLowerCase().includes("lego")) {
    activeZoneIndex = 2;
  } else if (activePrompt.toLowerCase().includes("cosmico") || activePrompt.toLowerCase().includes("espaço")) {
    activeZoneIndex = 3;
  } else if (activePrompt.toLowerCase().includes("outono")) {
    activeZoneIndex = 4;
  } else if (activePrompt.toLowerCase().includes("cyberpunk") || activePrompt.toLowerCase().includes("neon")) {
    activeZoneIndex = 5;
  }

  const dynamicHeat = zeroHeat();
  if (latestData) {
    const valPercent = Math.round(((typeof latestData.val === "number" ? latestData.val : 0) + 1) / 2 * 100);
    const aroPercent = Math.round((typeof latestData.aro === "number" ? latestData.aro : 0) * 100);
    const symPercent = Math.round((typeof latestData.sym === "number" ? latestData.sym : 0) * 100);
    const blinkCount = Math.min(100, typeof latestData.blinks === "number" ? latestData.blinks : 0);
    // Raio da íris normalizado pela largura facial (~0.06–0.16) → 0–100%
    const irisPercent = typeof latestData.iris_radius === 'number' && latestData.iris_radius > 0
      ? Math.max(0, Math.min(100, Math.round(((latestData.iris_radius - 0.06) / 0.10) * 100)))
      : 0;

    dynamicHeat[activeZoneIndex] = [
      valPercent,
      aroPercent,
      symPercent,
      blinkCount,
      irisPercent
    ];
  }

  return (
    <Card className="border-border panel-shadow">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-foreground">Mapa de Intensidade Emocional</CardTitle>
        {!latestData && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Sem sessão ativa — valores a zero
          </span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="overflow-x-auto">
          <div className="min-w-[620px]">
            <div className="grid grid-cols-[140px_repeat(5,1fr)] gap-2">
              <div />
              {emotions.map((e) => (
                <div key={e} className="text-center text-xs text-muted-foreground">
                  {e}
                </div>
              ))}
            </div>
            {zones.map((z, zi) => {
              const isActiveZone = zi === activeZoneIndex && !!latestData;
              return (
                <div
                  key={z}
                  className={`mt-2 grid grid-cols-[140px_repeat(5,1fr)] items-center gap-2 p-1.5 rounded-xl transition-all duration-300 ${
                    isActiveZone
                      ? "border border-cyan/40 bg-cyan/5 shadow-[0_0_15px_rgba(0,229,255,0.08)]"
                      : "border border-transparent"
                  }`}
                >
                  <div className={`text-sm ${isActiveZone ? "text-cyan font-bold glow-text-cyan" : "text-foreground"}`}>
                    {z} {isActiveZone && "• Ativo"}
                  </div>
                  {emotions.map((e, ei) => {
                    const v = dynamicHeat[zi][ei];
                    return (
                      <div
                        key={e}
                        className="flex h-12 items-center justify-center rounded-lg text-xs text-white/90 font-mono transition-all duration-300"
                        style={{
                          backgroundColor: heatColor(v),
                          boxShadow: isActiveZone && v > 65 ? "0 0 10px rgba(0,229,255,0.3)" : "none",
                        }}
                      >
                        {v}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="size-3 rounded" style={{ backgroundColor: "rgba(0,229,255,0.7)" }} />
            Baixa/Média intensidade
          </span>
          <span className="flex items-center gap-2">
            <span className="size-3 rounded" style={{ backgroundColor: "rgba(123,63,226,0.85)" }} />
            Alta intensidade
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Vídeos ---------- */
const VIDEOS_KEY = "sensus-videos";
const RECORDED_KEY = "sensus-recorded-videos";

const seedVideos: any[] = [
  {
    id: "v-1",
    titulo: "Gravação de Sessão #1024 — Regulação Emocional",
    dur: "12:45",
    tag: "Regulação Emocional"
  },
  {
    id: "v-2",
    titulo: "Gravação de Sessão #1023 — Jardim Fluido",
    dur: "10:15",
    tag: "Jardim Fluido"
  },
  {
    id: "v-3",
    titulo: "Gravação de Sessão #1022 — Lego World",
    dur: "18:30",
    tag: "Lego World"
  }
];

function loadStoredVideos(): any[] {
  try {
    const raw = localStorage.getItem(VIDEOS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  localStorage.setItem(VIDEOS_KEY, JSON.stringify(seedVideos));
  return seedVideos;
}

function loadRecordedVideos(): any[] {
  try {
    return JSON.parse(localStorage.getItem(RECORDED_KEY) || "[]");
  } catch (e) {
    return [];
  }
}

function VideosSection({ searchQuery = "" }: { searchQuery?: string }) {
  const [storedVideos, setStoredVideos] = useState<any[]>(() => loadStoredVideos());
  const [recordedVideos, setRecordedVideos] = useState<any[]>(() => loadRecordedVideos());

  // Atualiza a lista quando o utilizador grava um novo vídeo na projeção
  useEffect(() => {
    const interval = setInterval(() => {
      const cur = loadRecordedVideos();
      setRecordedVideos((prev) => (prev.length !== cur.length ? cur : prev));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleDeleteVideo = (video: any) => {
    const next = storedVideos.filter((v) => v.id !== video.id);
    setStoredVideos(next);
    localStorage.setItem(VIDEOS_KEY, JSON.stringify(next));
  };

  const handleDeleteRecorded = async (video: any) => {
    const next = recordedVideos.filter((v) => v.id !== video.id);
    setRecordedVideos(next);
    localStorage.setItem(RECORDED_KEY, JSON.stringify(next));
    // Remove também o ficheiro .webm do disco, se a API existir
    if (video.path && window.electronAPI?.deleteFile) {
      try {
        await window.electronAPI.deleteFile(video.path);
      } catch (e) {
        console.error("Falha ao apagar ficheiro de vídeo:", e);
      }
    }
  };

  const handleDownloadVideo = async (video: any) => {
    const mockContent = `ID: ${video.id}\nTítulo: ${video.titulo}\nDuração: ${video.dur}\nTag: ${video.tag}\nMock video file generated by Sensus AI Hub.`;
    if (window.electronAPI) {
      try {
        const defaultName = `${video.titulo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ /g, "-")}.txt`;
        const saveResult = await window.electronAPI.showSaveDialog({
          title: "Guardar Registo de Vídeo",
          defaultPath: defaultName,
          filters: [{ name: "Ficheiros de Texto", extensions: ["txt"] }],
        });

        if (saveResult && !saveResult.canceled && saveResult.filePath) {
          await window.electronAPI.writeCSV(saveResult.filePath, mockContent);
          alert(`Ficheiro de simulação de vídeo descarregado com sucesso para:\n${saveResult.filePath}`);
        }
      } catch (err) {
        console.error(err);
        alert("Erro ao guardar o ficheiro.");
      }
    } else {
      const dataStr = "data:text/plain;charset=utf-8," + encodeURIComponent(mockContent);
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `${video.titulo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ /g, "-")}.txt`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      alert(`Ficheiro de simulação de vídeo descarregado no browser.`);
    }
  };

  const q = searchQuery.toLowerCase();
  const filteredVideos = storedVideos.filter(v =>
    v.titulo.toLowerCase().includes(q) || v.tag.toLowerCase().includes(q)
  );
  const filteredRecorded = recordedVideos.filter(v =>
    (v.name || "").toLowerCase().includes(q)
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {filteredVideos.length === 0 && filteredRecorded.length === 0 && (
        <div className="col-span-full flex items-center justify-center rounded-xl border border-dashed border-border bg-secondary/10 p-10 text-xs text-muted-foreground">
          Sem vídeos — use o botão Record no ambiente virtual para gravar sessões
        </div>
      )}

      {/* Gravações reais feitas com o botão Record da projeção */}
      {filteredRecorded.map((v) => (
        <Card key={v.id} className="overflow-hidden border-border panel-shadow">
          <div className="group relative flex aspect-video items-center justify-center bg-gradient-to-br from-cyan/20 via-secondary to-primary/10">
            <div className="flex size-12 items-center justify-center rounded-full bg-cyan/80 text-white transition-transform group-hover:scale-110">
              <Play className="size-5 translate-x-0.5 fill-current" />
            </div>
            <Badge className="absolute left-2 top-2 border-cyan/30 bg-cyan/20 text-cyan">
              Gravação Real
            </Badge>
          </div>
          <CardContent className="p-4 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm text-foreground">{v.name}</span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {v.date ? new Date(v.date).toLocaleString("pt-PT") : ""}
              </span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => handleDeleteRecorded(v)}
              className="text-muted-foreground hover:text-rose-400 cursor-pointer shrink-0"
              title="Apagar Vídeo"
            >
              <Trash2 className="size-4" />
            </Button>
          </CardContent>
        </Card>
      ))}

      {filteredVideos.map((v) => (
        <Card key={v.id} className="overflow-hidden border-border panel-shadow">
          <div className="group relative flex aspect-video items-center justify-center bg-gradient-to-br from-primary/25 via-secondary to-cyan/10">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/80 text-white glow-primary transition-transform group-hover:scale-110">
              <Play className="size-5 translate-x-0.5 fill-current" />
            </div>
            <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-background/70 px-2 py-0.5 text-xs text-white backdrop-blur-md">
              <Clock className="size-3" />
              {v.dur}
            </span>
            <Badge className="absolute left-2 top-2 border-primary/30 bg-primary/20 text-primary">
              {v.tag}
            </Badge>
          </div>
          <CardContent className="p-4 flex items-center justify-between gap-2">
            <span className="text-sm text-foreground truncate">{v.titulo}</span>
            <div className="flex items-center shrink-0">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => handleDownloadVideo(v)}
                className="text-muted-foreground hover:text-primary cursor-pointer"
                title="Descarregar Vídeo"
              >
                <Download className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => handleDeleteVideo(v)}
                className="text-muted-foreground hover:text-rose-400 cursor-pointer"
                title="Apagar Vídeo"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
