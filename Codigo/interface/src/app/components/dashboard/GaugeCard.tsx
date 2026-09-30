import {
  RadialBar,
  RadialBarChart,
  PolarAngleAxis,
  ResponsiveContainer,
} from "recharts";
import { Activity } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { gauge } from "./data";

export function GaugeCard({ latestData }: { latestData?: any }) {
  const value = latestData ? Math.round(((latestData.val || 0) + 1) / 2 * 100) : gauge.value;
  const data = [{ name: gauge.label, value, fill: "#7b3fe2" }];

  return (
    <Card className="border-border bg-card panel-shadow">
      <CardHeader>
        <CardTitle className="text-foreground">Índice de Harmonia</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <div className="relative h-44 w-full">
          <div
            className="size-full"
            style={{ filter: "drop-shadow(0 0 8px rgba(123,63,226,0.5))" }}
          >
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="72%"
              outerRadius="100%"
              data={data}
              startAngle={220}
              endAngle={-40}
            >
              <PolarAngleAxis
                key="angle"
                type="number"
                domain={[0, 100]}
                angleAxisId={0}
                tick={false}
              />
              <RadialBar
                key="bar"
                background={{ fill: "#1f2547" }}
                dataKey="value"
                cornerRadius={12}
                angleAxisId={0}
                isAnimationActive={false}
              />
            </RadialBarChart>
          </ResponsiveContainer>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/20 shadow-[0_0_24px_rgba(123,63,226,0.6)]">
              <Activity className="size-5 text-primary" />
            </div>
            <span className="text-foreground" style={{ fontSize: "2rem", fontWeight: 600 }}>
              {value}%
            </span>
            <span className="text-xs text-muted-foreground">{gauge.label}</span>
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {latestData ? `Sinal cardíaco rPPG ${latestData.bpm > 0 ? "bloqueado em " + Math.round(latestData.bpm) + " BPM" : "a calibrar..."}` : "Equilíbrio emocional dentro do intervalo ideal"}
        </p>
      </CardContent>
    </Card>
  );
}
