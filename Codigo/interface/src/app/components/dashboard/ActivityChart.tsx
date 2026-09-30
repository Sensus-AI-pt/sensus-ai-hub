import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";

// O gráfico mostra a telemetria da sessão ativa e mais nada. Antes caía numa
// série de exemplo quando não havia sessão, o que dava uma curva de valência e
// BPM plausível a partir de números inventados.
export function ActivityChart({ history }: { history?: any[] }) {
  const chartData = history && history.length > 0 ? history : [];

  return (
    <Card className="border-border bg-card panel-shadow">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-foreground">Atividade Sensorial</CardTitle>
        <span className="text-[11px] text-muted-foreground">
          {chartData.length > 0 ? "Sessão em curso" : "Sem sessão"}
        </span>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border bg-secondary/10 text-xs text-muted-foreground">
            Sem dados — inicia o ambiente virtual para medir
          </div>
        ) : (
        <div
          className="h-64 w-full"
          style={{ filter: "drop-shadow(0 0 6px rgba(123,63,226,0.45))" }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ left: -20, right: 8, top: 8 }}>
              <defs key="defs">
                <linearGradient id="areaA" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7b3fe2" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#7b3fe2" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="areaB" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00e5ff" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#00e5ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid key="grid" strokeDasharray="3 3" stroke="rgba(123,63,226,0.1)" vertical={false} />
              <XAxis
                key="xaxis"
                dataKey="name"
                stroke="#8b90b8"
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />
              <YAxis key="yaxis" stroke="#8b90b8" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip
                key="tooltip"
                contentStyle={{
                  background: "#1a1f3a",
                  border: "1px solid rgba(123,63,226,0.3)",
                  borderRadius: 12,
                  color: "#eef0ff",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                  padding: "8px 12px",
                }}
                itemStyle={{ color: "#fff" }}
                labelStyle={{ color: "#fff" }}
              />
              <Area
                key="area-a"
                type="monotone"
                dataKey="a"
                stroke="#7b3fe2"
                strokeWidth={2}
                fill="url(#areaA)"
                name="Valência"
                isAnimationActive={false}
              />
              <Area
                key="area-b"
                type="monotone"
                dataKey="b"
                stroke="#00e5ff"
                strokeWidth={2}
                fill="url(#areaB)"
                name="Batimentos (BPM)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        )}
      </CardContent>
    </Card>
  );
}
