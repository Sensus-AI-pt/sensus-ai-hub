import { useState, useEffect } from "react";
import {
  Cpu,
  Camera,
  Wind,
  Volume2,
  Lightbulb,
  Radio,
  BatteryFull,
  BatteryLow,
  Plus,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Switch } from "../ui/switch";
import { PageHeader } from "./PageHeader";
import { devices } from "./data";
import { translations } from "./translations";

const typeIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  Sensor: Cpu,
  Câmara: Camera,
  Atuador: Wind,
  Áudio: Volume2,
  Iluminação: Lightbulb,
};

export function DevicesPage({ lang = "pt", searchQuery = "" }: { lang?: string; searchQuery?: string }) {
  const t = translations[lang] || translations.pt;
  const [list, setList] = useState(() => {
    const saved = localStorage.getItem("sensus-devices");
    return saved ? JSON.parse(saved) : devices;
  });

  useEffect(() => {
    localStorage.setItem("sensus-devices", JSON.stringify(list));
  }, [list]);

  // Synchronize from localStorage changes (in case settings deleted them)
  useEffect(() => {
    const handleStorage = () => {
      const saved = localStorage.getItem("sensus-devices");
      if (saved) setList(JSON.parse(saved));
    };
    window.addEventListener("storage", handleStorage);
    // Simple interval fallback in case it's on the same tab
    const interval = setInterval(handleStorage, 1000);
    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(interval);
    };
  }, []);

  const toggle = (id: string) =>
    setList((prev: any[]) =>
      prev.map((d) =>
        d.id === id
          ? { ...d, estado: d.estado === "Online" ? "Offline" : "Online" }
          : d,
      ),
    );

  const handleDeleteDevice = (id: string) => {
    const confirmMsg = lang === "en" ? "Are you sure you want to remove this device?" :
                       lang === "es" ? "¿Está seguro de que desea eliminar este dispositivo?" :
                       lang === "fr" ? "Êtes-vous sûr de vouloir supprimer cet appareil ?" :
                       "Deseja mesmo remover este dispositivo?";
    if (confirm(confirmMsg)) {
      setList((prev: any[]) => prev.filter((d) => d.id !== id));
    }
  };

  const handleAddDevice = () => {
    const names = [
      "Sensor Presença",
      "Fita LED RGB",
      "Coluna Surround",
      "Webcam UltraHD",
      "Difusor Aromas",
    ];
    const types = ["Sensor", "Iluminação", "Áudio", "Câmara", "Atuador"];
    const rooms = ["Sala 1", "Sala 2", "Jardim", "Sala 3"];
    const idx = Math.floor(Math.random() * names.length);
    const newDev = {
      id: `dev-${Date.now()}`,
      nome: `${names[idx]} #${list.length + 1}`,
      tipo: types[idx],
      sala: rooms[Math.floor(Math.random() * rooms.length)],
      estado: "Online" as const,
      bateria: 80 + Math.floor(Math.random() * 20),
    };
    setList((prev: any[]) => [...prev, newDev]);
  };

  const online = list.filter((d: any) => d.estado === "Online").length;

  return (
    <div className="relative z-10 flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title={t.devices}
          subtitle={
            lang === "en" ? "Monitor and control connected devices" :
            lang === "es" ? "Monitoree y controle dispositivos conectados" :
            lang === "fr" ? "Surveiller et contrôler les appareils connectés" :
            "Monitorize e controle os dispositivos conectados"
          }
        />
        <Button onClick={handleAddDevice} className="gap-2 bg-primary text-primary-foreground glow-primary hover:bg-primary/90">
          <Plus className="size-4" />
          {t.addDevice}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="border-border bg-card panel-shadow">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex size-11 items-center justify-center rounded-xl bg-positive/15 text-positive glow-text-positive">
              <Radio className="size-5" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-xs text-muted-foreground">Online</span>
              <span className="text-foreground" style={{ fontSize: "1.5rem", fontWeight: 600 }}>
                {online}/{list.length}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card panel-shadow">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary glow-text-primary">
              <Cpu className="size-5" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-xs text-muted-foreground">
                {lang === "en" ? "Total Devices" :
                 lang === "es" ? "Dispositivos Totales" :
                 lang === "fr" ? "Total des Appareils" :
                 "Total de Dispositivos"}
              </span>
              <span className="text-foreground" style={{ fontSize: "1.5rem", fontWeight: 600 }}>
                {list.length}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card panel-shadow">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex size-11 items-center justify-center rounded-xl bg-cyan/15 text-cyan glow-text-cyan">
              <BatteryFull className="size-5" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-xs text-muted-foreground">
                {lang === "en" ? "Average Battery" :
                 lang === "es" ? "Batería Promedio" :
                 lang === "fr" ? "Batterie Moyenne" :
                 "Bateria Média"}
              </span>
              <span className="text-foreground" style={{ fontSize: "1.5rem", fontWeight: 600 }}>
                {list.length > 0 ? Math.round(list.reduce((a: number, d: any) => a + d.bateria, 0) / list.length) : 0}%
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.filter((d: any) => 
          d.nome.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.tipo.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.sala.toLowerCase().includes(searchQuery.toLowerCase())
        ).map((d: any) => {
          const Icon = typeIcon[d.tipo] ?? Cpu;
          const isOnline = d.estado === "Online";
          const lowBattery = d.bateria < 20;
          return (
            <Card key={d.id} className="border-border bg-card panel-shadow">
              <CardContent className="flex flex-col gap-4 p-5">
                <div className="flex items-start justify-between">
                  <div
                    className={`flex size-11 items-center justify-center rounded-xl ${
                      isOnline ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDeleteDevice(d.id)}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors"
                      title={t.delete}
                    >
                      <Trash2 className="size-4" />
                    </button>
                    <Switch checked={isOnline} onCheckedChange={() => toggle(d.id)} />
                  </div>
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-foreground">{d.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {d.tipo} · {d.sala}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <Badge
                    variant="secondary"
                    className={
                      isOnline
                        ? "border-positive/30 bg-positive/10 text-positive"
                        : "border-border bg-secondary text-muted-foreground"
                    }
                  >
                    {isOnline ? "Online" : "Offline"}
                  </Badge>
                  <span
                    className={`flex items-center gap-1 text-xs ${
                      lowBattery ? "text-red-400" : "text-muted-foreground"
                    }`}
                  >
                    {lowBattery ? <BatteryLow className="size-4" /> : <BatteryFull className="size-4" />}
                    {d.bateria}%
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
