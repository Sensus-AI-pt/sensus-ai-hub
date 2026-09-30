import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Badge } from "../ui/badge";

// Action Units (FACS — Ekman & Friesen, 1978), alinhadas com o painel do engine.
const AU_LABELS: [string, string][] = [
  ["1", "Sobrancelha interna"],
  ["2", "Sobrancelha externa"],
  ["4", "Franzir sobrancelhas"],
  ["5", "Pálpebra superior"],
  ["6", "Bochechas"],
  ["9", "Franzir nariz"],
  ["12", "Sorriso"],
  ["15", "Cantos p/ baixo"],
  ["17", "Queixo elevado"],
  ["20", "Esticar lábios"],
  ["23", "Apertar lábios"],
  ["25", "Lábios abertos"],
  ["26", "Queixo caído"],
];

function estadoAU(v: number): { label: string; cls: string } {
  if (v > 0.66) return { label: "Elevada", cls: "border-cyan/30 bg-cyan/10 text-cyan" };
  if (v > 0.33) return { label: "Moderada", cls: "border-primary/20 bg-primary/15 text-primary" };
  return { label: "Baixa", cls: "border-border bg-secondary/40 text-muted-foreground" };
}

// Parâmetros realmente medidos pelo engine: intensidade das 13 Action Units
// enviadas na chave `au` da telemetria (0..1), em tempo real.
export function BehaviorTable({ latestData }: { latestData?: any }) {
  const au = latestData?.au || {};

  const rows = AU_LABELS.map(([code, label]) => {
    const v = typeof au[code] === "number" ? Math.max(0, Math.min(1, au[code])) : 0;
    return {
      id: `au${code}`,
      categoria: `AU${code} — ${label}`,
      intensidade: v,
      valor: Math.round(v * 100),
    };
  });

  return (
    <Card className="border-border bg-card panel-shadow">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-foreground">Parâmetros Medidos — Action Units (FACS)</CardTitle>
        {latestData?.face && (
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-positive">
            <span className="mov-respira inline-flex size-2 rounded-full bg-positive" />
            Live
          </span>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Action Unit</TableHead>
              <TableHead className="text-muted-foreground">Estado</TableHead>
              <TableHead className="w-40 text-muted-foreground">Intensidade</TableHead>
              <TableHead className="text-right text-muted-foreground">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const e = estadoAU(row.intensidade);
              return (
                <TableRow key={row.id} className="border-border hover:bg-secondary/40">
                  <TableCell className="text-foreground">{row.categoria}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={e.cls}>
                      {e.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-cyan transition-all duration-300"
                        style={{
                          width: `${row.valor}%`,
                          boxShadow: row.valor > 0 ? "0 0 10px rgba(123,63,226,0.6)" : "none",
                        }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{row.valor}%</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
