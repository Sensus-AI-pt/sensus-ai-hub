import { TrendingUp, TrendingDown } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Card } from "../ui/card";
import type { Kpi } from "./data";

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const up = kpi.trend === "up";
  // Single data-accent colour for all sparklines (cyan = dados/métricas)
  const color = "#00e5ff";

  return (
    <Card className="gap-3 border-border bg-card p-5 panel-shadow">
      <div className="flex items-start justify-between">
        <span className="text-sm text-muted-foreground">{kpi.label}</span>
        <span
          className={`flex items-center gap-1 text-xs ${
            up ? "text-positive glow-text-positive" : "text-muted-foreground"
          }`}
        >
          {up ? (
            <TrendingUp className="size-3" />
          ) : (
            <TrendingDown className="size-3" />
          )}
          {kpi.delta}
        </span>
      </div>

      <div className="text-foreground" style={{ fontSize: "1.75rem", fontWeight: 600 }}>
        {kpi.value}
      </div>

      <div
        className="h-10 w-full"
        style={{ filter: `drop-shadow(0 0 6px ${color}99)` }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={kpi.data} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
            <defs key="defs">
              <linearGradient id={`spark-${kpi.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              key="area"
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={2}
              fill={`url(#spark-${kpi.id})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
