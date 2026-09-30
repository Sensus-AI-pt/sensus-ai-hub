import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Users, Activity, HeartPulse, Smile } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { PageHeader } from "./PageHeader";
import { getTotalSessions, getTodaySessions, getSessionsLast7Days } from "./sessions";
import { getLatestSessionSummary, getSessionSummaries } from "./sessionHistory";
import { SeletorAmbiente, MetricasDoAmbiente } from "./SeletorAmbiente";

const tooltipStyle = {
  background: "#1a1f3a",
  border: "1px solid rgba(123,63,226,0.3)",
  borderRadius: 12,
  color: "#eef0ff",
  boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
  padding: "8px 12px",
};

// Estatísticas funcionais: contadores reais de sessões (localStorage) e
// métricas em tempo real derivadas da telemetria da sessão ativa (history).
export function StatisticsPage({
  latestData,
  history = [],
  lang = "pt",
  searchQuery = "",
}: {
  latestData?: any;
  history?: any[];
  lang?: string;
  searchQuery?: string;
}) {
  const [ambienteSel, setAmbienteSel] = useState("todos");
  const [sessoesGravadas, setSessoesGravadas] = useState(() => getSessionSummaries());
  const [sessionCounts, setSessionCounts] = useState(() => ({
    total: getTotalSessions(),
    today: getTodaySessions(),
    week: getSessionsLast7Days(),
  }));

  // Recarrega contadores periodicamente (novas sessões, reset à meia-noite)
  useEffect(() => {
    const interval = setInterval(() => {
      setSessoesGravadas(getSessionSummaries());
      setSessionCounts({
        total: getTotalSessions(),
        today: getTodaySessions(),
        week: getSessionsLast7Days(),
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Médias da sessão ativa, calculadas sobre o histórico de telemetria
  const validBpm = history.filter((h) => h.b > 0);
  const avgBpm = validBpm.length > 0
    ? Math.round(validBpm.reduce((s, h) => s + h.b, 0) / validBpm.length)
    : 0;
  const avgVal = history.length > 0
    ? Math.round(history.reduce((s, h) => s + h.a, 0) / history.length)
    : 0;

  const summary = [
    { id: "s1", icon: Users, label: "Sessões Totais", value: String(sessionCounts.total), detail: `${sessionCounts.today} hoje` },
    { id: "s2", icon: Activity, label: "Sessão Ativa", value: latestData ? "Sim" : "Não", detail: latestData ? `${latestData.fps || 0} FPS` : "—" },
    { id: "s3", icon: HeartPulse, label: "BPM Médio (Sessão)", value: avgBpm > 0 ? `${avgBpm}` : "—", detail: "rPPG" },
    { id: "s4", icon: Smile, label: "Valência Média (Sessão)", value: history.length > 0 ? `${avgVal}%` : "—", detail: "modelo de Russell" },
  ];

  // Distribuição real do tempo da sessão pelos quadrantes do circumplexo
  // de Russell (valência × arousal), contada sobre o histórico.
  const quadrants = [
    { name: "Positivo · Ativado", value: 0, fill: "#34e5a3" },
    { name: "Positivo · Calmo", value: 0, fill: "#00e5ff" },
    { name: "Negativo · Ativado", value: 0, fill: "#f43f5e" },
    { name: "Negativo · Calmo", value: 0, fill: "#7b3fe2" },
  ];
  history.forEach((h) => {
    const pos = h.a >= 50;
    const act = h.c >= 50;
    const idx = pos ? (act ? 0 : 1) : (act ? 2 : 3);
    quadrants[idx].value += 1;
  });
  const totalSamples = history.length;
  const lastSummary = totalSamples === 0 ? getLatestSessionSummary() : null;
  const distribution = totalSamples > 0
    ? quadrants.map((q) => ({ ...q, value: Math.round((q.value / totalSamples) * 100) }))
    : lastSummary
    ? [
        { name: "Positivo · Ativado", value: lastSummary.quadrantPct.posAct, fill: "#34e5a3" },
        { name: "Positivo · Calmo", value: lastSummary.quadrantPct.posCalm, fill: "#00e5ff" },
        { name: "Negativo · Ativado", value: lastSummary.quadrantPct.negAct, fill: "#f43f5e" },
        { name: "Negativo · Calmo", value: lastSummary.quadrantPct.negCalm, fill: "#7b3fe2" },
      ]
    : quadrants.map((q) => ({ ...q, value: 0 }));
  const hasDistribution = distribution.some((d) => d.value > 0);
  const valenceSeries = totalSamples > 1
    ? history
    : lastSummary
    ? lastSummary.valenceSeries.map((p) => ({ name: String(p.t), a: p.v }))
    : [];

  const emptyState = (msg: string) => (
    <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border bg-secondary/10 text-xs text-muted-foreground">
      {msg}
    </div>
  );

  return (
    <div className="relative z-10 flex flex-1 flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="Estatísticas"
        subtitle="Análise detalhada do desempenho e bem-estar"
      />

      {/* Escolha do ambiente + métricas próprias dele. Cada ambiente mede coisas
          diferentes, e mostrar as mesmas quatro caixas em todos era dar números
          que não existem naquele contexto. */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Métricas do ambiente
          </span>
          <SeletorAmbiente valor={ambienteSel} onChange={setAmbienteSel} sessoes={sessoesGravadas} />
        </div>
        <MetricasDoAmbiente ambienteId={ambienteSel} sessoes={sessoesGravadas} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summary.filter(s => s.label.toLowerCase().includes(searchQuery.toLowerCase())).map((s) => (
          <Card key={s.id} className="border-border bg-card panel-shadow animate-in fade-in duration-300">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary glow-text-primary">
                <s.icon className="size-5" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                <span className="text-foreground" style={{ fontSize: "1.5rem", fontWeight: 600 }}>
                  {s.value}
                </span>
              </div>
              <span className="ml-auto text-xs text-muted-foreground">{s.detail}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border-border bg-card panel-shadow lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-foreground">Sessões por Dia (Últimos 7 Dias)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full" style={{ filter: "drop-shadow(0 0 6px rgba(123,63,226,0.4))" }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sessionCounts.week} margin={{ left: -20, right: 8, top: 8 }}>
                  <defs key="defs">
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7b3fe2" stopOpacity={1} />
                      <stop offset="100%" stopColor="#00e5ff" stopOpacity={0.7} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid key="grid" strokeDasharray="3 3" stroke="rgba(123,63,226,0.1)" vertical={false} />
                  <XAxis key="x" dataKey="name" stroke="#8b90b8" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis key="y" stroke="#8b90b8" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip key="t" contentStyle={tooltipStyle} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#fff" }} cursor={{ fill: "rgba(123,63,226,0.08)" }} />
                  <Bar key="b" dataKey="sessoes" fill="url(#barGrad)" radius={[6, 6, 0, 0]} name="Sessões" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card panel-shadow">
          <CardHeader>
            <CardTitle className="text-foreground">
              Distribuição por Quadrante (Russell) {totalSamples === 0 && lastSummary ? "· Última Sessão" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasDistribution ? (
              <>
                <div className="h-64 w-full" style={{ filter: "drop-shadow(0 0 6px rgba(123,63,226,0.4))" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        key="pie"
                        data={distribution.filter((d) => d.value > 0)}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="55%"
                        outerRadius="80%"
                        paddingAngle={3}
                        stroke="none"
                        isAnimationActive={false}
                      >
                        {distribution.filter((d) => d.value > 0).map((e) => (
                          <Cell key={e.name} fill={e.fill} />
                        ))}
                      </Pie>
                      <Tooltip key="t" contentStyle={tooltipStyle} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#fff" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-1.5">
                  {distribution.map((e) => (
                    <div key={e.name} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: e.fill }} />
                      {e.name} · {e.value}%
                    </div>
                  ))}
                </div>
              </>
            ) : emptyState("Sem sessão ativa — % de tempo em cada quadrante emocional")}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border bg-card panel-shadow">
        <CardHeader>
          <CardTitle className="text-foreground">
            Evolução do Bem-Estar na Sessão (Valência) {totalSamples === 0 && lastSummary ? "· Última Sessão" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {valenceSeries.length > 1 ? (
            <div className="h-64 w-full" style={{ filter: "drop-shadow(0 0 6px rgba(0,229,255,0.4))" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={valenceSeries} margin={{ left: -20, right: 8, top: 8 }}>
                  <defs key="defs">
                    <linearGradient id="statVal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00e5ff" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#00e5ff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid key="grid" strokeDasharray="3 3" stroke="rgba(123,63,226,0.1)" vertical={false} />
                  <XAxis key="x" dataKey="name" stroke="#8b90b8" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis key="y" domain={[0, 100]} stroke="#8b90b8" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip key="t" contentStyle={tooltipStyle} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#fff" }} />
                  <Area key="l" type="monotone" dataKey="a" stroke="#00e5ff" strokeWidth={2} fill="url(#statVal)" name="Valência (%)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : emptyState("Sem sessão ativa — inicie o ambiente virtual para ver a evolução")}
        </CardContent>
      </Card>
    </div>
  );
}
