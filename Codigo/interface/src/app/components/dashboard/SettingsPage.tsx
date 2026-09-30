import { useState, useEffect } from "react";
import {
  Palette,
  Globe,
  Clock,
  Ruler,
  ChevronRight,
  Download,
  Trash2,
  DatabaseBackup,
  RotateCcw,
  UserX,
  Sparkles,
  Maximize2,
  Zap,
  RefreshCw,
  Camera,
  Cpu,
  Lock,
  History,
  Shield,
  Layers,
  Database,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { translations } from "./translations";
import { useSettings } from "@/context/SettingsContext";

const tabs = ["Geral", "Aparência", "Segurança", "Integrações"];

const accentColors = [
  { id: "roxo", value: "#7b3fe2" },
  { id: "azul", value: "#3b82f6" },
  { id: "ciano", value: "#00e5ff" },
  { id: "verde", value: "#34e5a3" },
  { id: "amarelo", value: "#eab308" },
  { id: "laranja", value: "#f97316" },
  { id: "vermelho", value: "#ef4444" },
  { id: "rosa", value: "#ec4899" },
];

const densities = ["Confortável", "Espaçoso", "Compacto"];

export function SettingsPage({
  lang = "pt",
  onLangChange,
  theme = "dark",
  onThemeChange,
  accent = "#7b3fe2",
  onAccentChange,
  onReplayTour,
}: {
  lang?: string;
  onLangChange?: (val: string) => void;
  theme?: string;
  onThemeChange?: (val: string) => void;
  accent?: string;
  onAccentChange?: (val: string) => void;
  onReplayTour?: () => void;
}) {
  const { activeSensors, setActiveSensors } = useSettings();
  const t = translations[lang] || translations.pt;
  const [activeTab, setActiveTab] = useState("Geral");

  // Telemetry Auto Toggles
  const [toggles, setToggles] = useState(() => {
    const savedAnim = localStorage.getItem("sensus-setting-animations");
    const savedComp = localStorage.getItem("sensus-setting-compact");
    const savedGlow = localStorage.getItem("sensus-setting-glow");
    const savedAuto = localStorage.getItem("sensus-setting-auto");
    return {
      animacoes: savedAnim !== null ? savedAnim === "true" : true,
      compacto: savedComp !== null ? savedComp === "true" : false,
      glow: savedGlow !== null ? savedGlow === "true" : true,
      auto: savedAuto !== null ? savedAuto === "true" : true,
    };
  });

  const [density, setDensity] = useState(() => {
    return localStorage.getItem("sensus-density") || "Confortável";
  });

  const [backup, setBackup] = useState(() => {
    return localStorage.getItem("sensus-backup") !== "false";
  });

  const [timezone, setTimezone] = useState(() => {
    return localStorage.getItem("sensus-timezone") || "Lisboa";
  });

  const [units, setUnits] = useState(() => {
    return localStorage.getItem("sensus-units") || "Métrico";
  });

  // Devices state dynamically loaded from localStorage
  const [deviceList, setDeviceList] = useState<any[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("sensus-devices");
    if (saved) {
      setDeviceList(JSON.parse(saved));
    }
  }, []);

  const handleDeleteDevice = (id: string) => {
    if (confirm(lang === "en" ? "Are you sure you want to remove this device?" : "Deseja mesmo remover este dispositivo?")) {
      const updated = deviceList.filter((d) => d.id !== id);
      setDeviceList(updated);
      localStorage.setItem("sensus-devices", JSON.stringify(updated));
    }
  };

  const toggle = (id: string) => {
    setToggles((s: any) => ({ ...s, [id]: !s[id] }));
  };

  // Theme selector
  const handleThemeChange = (val: string) => {
    if (onThemeChange) {
      onThemeChange(val);
    }
    if (val === "light") {
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark");
    }
  };

  // Timezone selector
  const handleTimezoneChange = (val: string) => {
    setTimezone(val);
    localStorage.setItem("sensus-timezone", val);
  };

  // Units selector
  const handleUnitsChange = (val: string) => {
    setUnits(val);
    localStorage.setItem("sensus-units", val);
  };

  // Glow listener
  useEffect(() => {
    if (toggles.glow) {
      document.documentElement.classList.remove("no-glow");
    } else {
      document.documentElement.classList.add("no-glow");
    }
    localStorage.setItem("sensus-setting-glow", String(toggles.glow));
  }, [toggles.glow]);

  // Compact listener
  useEffect(() => {
    if (toggles.compacto) {
      document.documentElement.classList.add("compact-mode");
    } else {
      document.documentElement.classList.remove("compact-mode");
    }
    localStorage.setItem("sensus-setting-compact", String(toggles.compacto));
  }, [toggles.compacto]);

  // Animations listener
  useEffect(() => {
    if (toggles.animacoes) {
      document.documentElement.classList.remove("no-animations");
    } else {
      document.documentElement.classList.add("no-animations");
    }
    localStorage.setItem("sensus-setting-animations", String(toggles.animacoes));
  }, [toggles.animacoes]);

  // Auto update listener
  useEffect(() => {
    localStorage.setItem("sensus-setting-auto", String(toggles.auto));
  }, [toggles.auto]);

  // Density listener
  useEffect(() => {
    localStorage.setItem("sensus-density", density);
    if (density === "Compacto") {
      document.documentElement.classList.add("compact-mode");
      document.documentElement.classList.remove("spacious-mode");
    } else if (density === "Espaçoso") {
      document.documentElement.classList.add("spacious-mode");
      document.documentElement.classList.remove("compact-mode");
    } else {
      document.documentElement.classList.remove("compact-mode", "spacious-mode");
    }
  }, [density]);

  // Backup listener
  useEffect(() => {
    localStorage.setItem("sensus-backup", String(backup));
  }, [backup]);

  // Backups modal state
  const [showBackupsModal, setShowBackupsModal] = useState(false);
  const [backupsList, setBackupsList] = useState<any[]>(() => {
    const saved = localStorage.getItem("sensus-backups-history");
    return saved ? JSON.parse(saved) : [
      { id: "b1", name: "Backup de Fábrica", date: "2026-07-13 14:00" }
    ];
  });

  const handleCreateBackup = () => {
    const newB = {
      id: `b-${Date.now()}`,
      name: `Backup Sensus - ${new Date().toLocaleDateString("pt-PT")} ${new Date().toLocaleTimeString("pt-PT", {hour: "2-digit", minute:"2-digit"})}`,
      date: new Date().toISOString().replace("T", " ").substring(0, 16),
      state: {
        theme,
        accent,
        density,
        timezone,
        units,
        toggles,
      }
    };
    const updated = [...backupsList, newB];
    setBackupsList(updated);
    localStorage.setItem("sensus-backups-history", JSON.stringify(updated));
    alert("Backup criado localmente com sucesso!");
  };

  const handleRestoreBackup = (b: any) => {
    if (b.state) {
      localStorage.setItem("sensus-theme", b.state.theme);
      localStorage.setItem("sensus-accent", b.state.accent);
      localStorage.setItem("sensus-density", b.state.density);
      localStorage.setItem("sensus-timezone", b.state.timezone);
      localStorage.setItem("sensus-units", b.state.units);
      alert("Backup restaurado com sucesso! A recarregar página...");
      window.location.reload();
    } else {
      alert("Backup sem dados válidos.");
    }
  };

  const handleDeleteBackup = (id: string) => {
    if (confirm("Deseja eliminar este backup?")) {
      const updated = backupsList.filter((b) => b.id !== id);
      setBackupsList(updated);
      localStorage.setItem("sensus-backups-history", JSON.stringify(updated));
    }
  };

  const handleDataAction = async (id: string) => {
    if (id === "exportar") {
      const config = {
        accent,
        toggles,
        density,
        backup,
        timezone,
        units,
        theme,
        timestamp: new Date().toISOString(),
      };
      if (window.electronAPI?.showSaveDialog) {
        try {
          const result = await window.electronAPI.showSaveDialog({
            title: "Exportar Configurações",
            defaultPath: "sensus-dashboard-config.json",
            filters: [{ name: "JSON Files", extensions: ["json"] }],
          });
          if (!result.canceled && result.filePath) {
            await window.electronAPI.writeCSV(result.filePath, JSON.stringify(config, null, 2));
            alert(`Configurações exportadas com sucesso para:\n${result.filePath}`);
          }
        } catch (err) {
          console.error(err);
          alert("Erro ao exportar dados.");
        }
      } else {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(config, null, 2));
        const downloadAnchor = document.createElement("a");
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", "sensus-dashboard-config.json");
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
      }
    } else if (id === "cache") {
      localStorage.clear();
      window.location.reload();
    }
  };

  // Mock Password State
  const [passWord, setPassWord] = useState("");
  const [confirmPass, setConfirmPass] = useState("");

  const handleUpdatePassword = () => {
    if (!passWord.trim()) return alert("Palavra-passe não pode estar vazia.");
    if (passWord !== confirmPass) return alert("As palavras-passe não coincidem.");
    alert("Palavra-passe atualizada com sucesso!");
    setPassWord("");
    setConfirmPass("");
  };

  return (
    <div className="relative z-10 flex flex-1 flex-col gap-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col leading-tight">
        <h1 className="text-foreground">{t.settings}</h1>
        <p className="text-sm text-muted-foreground">
          Personalize a sua experiência e gerencie os detalhes da aplicação
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-6 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`relative -mb-px pb-3 text-sm transition-colors ${
              activeTab === tab
                ? "text-primary glow-text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "Geral" ? "Geral" :
             tab === "Aparência" ? "Aparência" :
             tab === "Segurança" ? "Segurança" :
             tab === "Integrações" ? "Integrações" : tab}
            {activeTab === tab && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary glow-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column (2/3) */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          
          {/* TAB 1: GERAL */}
          {activeTab === "Geral" && (
            <>
              <Card className="border-border bg-card panel-shadow">
                <CardHeader>
                  <CardTitle className="text-foreground">Preferências Gerais</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  
                  {/* Tema Dropdown */}
                  <div className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 p-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                      <Palette className="size-5" />
                    </div>
                    <div className="flex flex-col leading-tight">
                      <span className="text-sm text-foreground">{t.theme}</span>
                      <span className="text-xs text-muted-foreground">{t.themeDesc}</span>
                    </div>
                    <select
                      value={theme}
                      onChange={(e) => handleThemeChange(e.target.value)}
                      className="ml-auto bg-secondary hover:bg-secondary/80 border border-border text-foreground px-3 py-1.5 rounded-xl text-xs outline-none cursor-pointer transition-colors"
                    >
                      <option value="dark">Escuro</option>
                      <option value="light">Claro</option>
                      <option value="system">Sistema</option>
                    </select>
                  </div>

                  {/* Idioma Dropdown */}
                  <div className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 p-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                      <Globe className="size-5" />
                    </div>
                    <div className="flex flex-col leading-tight">
                      <span className="text-sm text-foreground">{t.lang}</span>
                      <span className="text-xs text-muted-foreground">{t.langDesc}</span>
                    </div>
                    <select
                      value={lang}
                      onChange={(e) => onLangChange && onLangChange(e.target.value)}
                      className="ml-auto bg-secondary hover:bg-secondary/80 border border-border text-foreground px-3 py-1.5 rounded-xl text-xs outline-none cursor-pointer transition-colors"
                    >
                      <option value="pt">Português</option>
                      <option value="en">English</option>
                      <option value="es">Español</option>
                      <option value="fr">Français</option>
                    </select>
                  </div>

                  {/* Fuso Horário Dropdown */}
                  <div className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 p-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                      <Clock className="size-5" />
                    </div>
                    <div className="flex flex-col leading-tight">
                      <span className="text-sm text-foreground">{t.timezone}</span>
                      <span className="text-xs text-muted-foreground">{t.timezoneDesc}</span>
                    </div>
                    <select
                      value={timezone}
                      onChange={(e) => handleTimezoneChange(e.target.value)}
                      className="ml-auto bg-secondary hover:bg-secondary/80 border border-border text-foreground px-3 py-1.5 rounded-xl text-xs outline-none cursor-pointer transition-colors"
                    >
                      <option value="Lisboa">(UTC+00:00) Lisboa</option>
                      <option value="Brasilia">(UTC-03:00) Brasília</option>
                      <option value="Londres">(UTC+01:00) Londres</option>
                      <option value="Toquio">(UTC+09:00) Tóquio</option>
                    </select>
                  </div>

                  {/* Unidades Dropdown */}
                  <div className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 p-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                      <Ruler className="size-5" />
                    </div>
                    <div className="flex flex-col leading-tight">
                      <span className="text-sm text-foreground">{t.units}</span>
                      <span className="text-xs text-muted-foreground">{t.unitsDesc}</span>
                    </div>
                    <select
                      value={units}
                      onChange={(e) => handleUnitsChange(e.target.value)}
                      className="ml-auto bg-secondary hover:bg-secondary/80 border border-border text-foreground px-3 py-1.5 rounded-xl text-xs outline-none cursor-pointer transition-colors"
                    >
                      <option value="Métrico">Métrico (kg, cm)</option>
                      <option value="Imperial">Imperial (lb, in)</option>
                    </select>
                  </div>

                </CardContent>
              </Card>

              {/* Rever tutorial de boas-vindas */}
              <Card className="border-border bg-card panel-shadow">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Sparkles className="size-5" />
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm text-foreground">
                      {lang === "en" ? "Welcome tutorial" : lang === "es" ? "Tutorial de bienvenida" : lang === "fr" ? "Tutoriel de bienvenue" : "Tutorial de boas-vindas"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {lang === "en" ? "Replay the guided tour of the app" : lang === "es" ? "Vuelve a ver el tour guiado de la app" : lang === "fr" ? "Revoir la visite guidée de l'application" : "Voltar a ver o tour guiado da app"}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => onReplayTour && onReplayTour()}
                    className="ml-auto rounded-xl border border-border text-xs hover:bg-secondary/60"
                  >
                    {lang === "en" ? "Replay tutorial" : lang === "es" ? "Repetir tutorial" : lang === "fr" ? "Revoir le tutoriel" : "Rever tutorial"}
                  </Button>
                </CardContent>
              </Card>

              {/* Sincronização Sensus AI Hub (Android) */}
              <Card className="border-border bg-card panel-shadow">
                <CardHeader>
                  <CardTitle className="text-foreground">Sincronização Sensus AI Hub (Android)</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <span className="text-xs text-muted-foreground">
                    Utilize as credenciais abaixo para sincronizar a sua aplicação móvel Android.
                  </span>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Sync ID */}
                    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-secondary/35 p-3.5">
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">ID de Sincronização</span>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <code className="text-sm font-mono font-bold text-primary">SENSUS-HUB-8B42</code>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 rounded-md hover:bg-secondary border border-border/40 text-muted-foreground"
                          onClick={() => {
                            navigator.clipboard.writeText("SENSUS-HUB-8B42");
                            alert(lang === "en" ? "Copied ID!" : "ID de Sincronização copiado!");
                          }}
                        >
                          <svg className="size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                        </Button>
                      </div>
                    </div>

                    {/* Sync Password */}
                    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-secondary/35 p-3.5">
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Palavra-passe</span>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <code className="text-sm font-mono font-bold text-foreground">9824-A19F</code>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 rounded-md hover:bg-secondary border border-border/40 text-muted-foreground"
                          onClick={() => {
                            navigator.clipboard.writeText("9824-A19F");
                            alert(lang === "en" ? "Copied Password!" : "Palavra-passe copiada!");
                          }}
                        >
                          <svg className="size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-border/40 pt-3 flex flex-col gap-3">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Gerir Permissões</span>
                    
                    <div className="flex flex-col gap-2">
                      {[
                        { id: "perm_rppg", label: lang === "en" ? "Heart Rate Telemetry (rPPG)" : "Telemetria de Batimentos Cardíacos (rPPG)", desc: lang === "en" ? "Allow mobile app to send processed camera vitals" : "Permite que a aplicação móvel envie dados vitais processados" },
                        { id: "perm_cam", label: lang === "en" ? "Camera Stream Access" : "Acesso Remoto à Câmara do Telemóvel", desc: lang === "en" ? "Access cellular video feed over USB connection" : "Acede à transmissão de vídeo do telemóvel via USB" },
                        { id: "perm_audio", label: lang === "en" ? "DDSP Audio Feedback Sync" : "Sincronização de Sinais de Áudio DDSP", desc: lang === "en" ? "Transmit synthesizer parameters to the mobile app" : "Transmite os sinais sintetizados para a aplicação móvel" },
                        { id: "perm_accel", label: lang === "en" ? "Motion and Acceleration Telemetry" : "Telemetria de Aceleração e Movimento", desc: lang === "en" ? "Fetch gyroscope and accelerometer sensors from Android" : "Lê os sensores de acelerómetro e giroscópio do Android" },
                      ].map((perm) => (
                        <div key={perm.id} className="flex items-center justify-between gap-4 rounded-xl border border-border bg-secondary/15 p-3">
                          <div className="flex flex-col">
                            <span className="text-xs text-foreground font-semibold">{perm.label}</span>
                            <span className="text-[10px] text-muted-foreground">{perm.desc}</span>
                          </div>
                          <Switch 
                            checked={toggles[perm.id] !== false} 
                            onCheckedChange={() => {
                              setToggles((prev: any) => ({ ...prev, [perm.id]: prev[perm.id] === false ? true : false }));
                            }} 
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* TAB 2: APARÊNCIA */}
          {activeTab === "Aparência" && (
            <Card className="border-border bg-card panel-shadow">
              <CardHeader>
                <CardTitle className="text-foreground">Preferências de Visualização</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {/* Animations switch */}
                <div className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 p-4">
                  <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${toggles.animacoes ? "bg-primary/15 text-primary glow-text-primary" : "bg-secondary text-muted-foreground"}`}>
                    <Sparkles className="size-5" />
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm text-foreground">{t.animations}</span>
                    <span className="text-xs text-muted-foreground">{t.animationsDesc}</span>
                  </div>
                  <div className="ml-auto">
                    <Switch checked={toggles.animacoes} onCheckedChange={() => toggle("animacoes")} />
                  </div>
                </div>

                {/* Compact mode switch */}
                <div className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 p-4">
                  <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${toggles.compacto ? "bg-primary/15 text-primary glow-text-primary" : "bg-secondary text-muted-foreground"}`}>
                    <Maximize2 className="size-5" />
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm text-foreground">{t.compact}</span>
                    <span className="text-xs text-muted-foreground">{t.compactDesc}</span>
                  </div>
                  <div className="ml-auto">
                    <Switch checked={toggles.compacto} onCheckedChange={() => toggle("compacto")} />
                  </div>
                </div>

                {/* Glow switch */}
                <div className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 p-4">
                  <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${toggles.glow ? "bg-primary/15 text-primary glow-text-primary" : "bg-secondary text-muted-foreground"}`}>
                    <Zap className="size-5" />
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm text-foreground">{t.glow}</span>
                    <span className="text-xs text-muted-foreground">{t.glowDesc}</span>
                  </div>
                  <div className="ml-auto">
                    <Switch checked={toggles.glow} onCheckedChange={() => toggle("glow")} />
                  </div>
                </div>

                {/* Auto Update switch */}
                <div className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 p-4">
                  <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${toggles.auto ? "bg-primary/15 text-primary glow-text-primary" : "bg-secondary text-muted-foreground"}`}>
                    <RefreshCw className="size-5" />
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm text-foreground">{t.autoUpdate}</span>
                    <span className="text-xs text-muted-foreground">{t.autoUpdateDesc}</span>
                  </div>
                  <div className="ml-auto">
                    <Switch checked={toggles.auto} onCheckedChange={() => toggle("auto")} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* TAB 3: SEGURANÇA */}
          {activeTab === "Segurança" && (
            <>
              {/* Palavra-passe update */}
              <Card className="border-border bg-card panel-shadow">
                <CardHeader>
                  <CardTitle className="text-foreground">Atualizar Palavra-passe</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-muted-foreground">Nova Palavra-passe</span>
                    <Input
                      type="password"
                      value={passWord}
                      onChange={(e) => setPassWord(e.target.value)}
                      className="border border-border bg-secondary"
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-muted-foreground">Confirmar Nova Palavra-passe</span>
                    <Input
                      type="password"
                      value={confirmPass}
                      onChange={(e) => setConfirmPass(e.target.value)}
                      className="border border-border bg-secondary"
                      placeholder="••••••••"
                    />
                  </div>
                  <Button onClick={handleUpdatePassword} className="self-start gap-2 bg-primary text-primary-foreground glow-primary">
                    <Lock className="size-4" />
                    Guardar Palavra-passe
                  </Button>
                </CardContent>
              </Card>

              {/* Login history */}
              <Card className="border-border bg-card panel-shadow">
                <CardHeader>
                  <CardTitle className="text-foreground">Histórico de Logins</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/20 p-3 text-xs">
                    <History className="size-4 text-cyan" />
                    <span>Sessão atual iniciada de IP local (127.0.0.1)</span>
                    <span className="ml-auto text-muted-foreground">Hoje, {new Date().toLocaleTimeString("pt-PT", {hour:"2-digit", minute:"2-digit"})}</span>
                  </div>
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/10 p-3 text-xs text-muted-foreground">
                    <History className="size-4" />
                    <span>Sessão anterior terminada de forma segura</span>
                    <span className="ml-auto">Ontem, 23:18</span>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* TAB 4: INTEGRAÇÕES */}
          {activeTab === "Integrações" && (
            <>
              <Card className="border-border bg-card panel-shadow">
              <CardHeader>
                <CardTitle className="text-foreground">Conectores Sensus AI</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                
                {/* Obsidian Vault Connector */}
                <div className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 p-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Shield className="size-5" />
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm text-foreground">Obsidian Vault API</span>
                    <span className="text-xs text-muted-foreground">Conexão à base de dados local de memória</span>
                  </div>
                  <Badge className="ml-auto border-positive/30 bg-positive/10 text-positive">Ligado</Badge>
                </div>

                {/* MediaPipe Engine */}
                <div className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 p-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Layers className="size-5" />
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm text-foreground">MediaPipe Biometrics Engine</span>
                    <span className="text-xs text-muted-foreground">Mecanismo nativo de extração facial</span>
                  </div>
                  <Badge className="ml-auto border-positive/30 bg-positive/10 text-positive">Ligado</Badge>
                </div>

                {/* StreamDiffusion server */}
                <div className="flex items-center gap-4 rounded-xl border border-border bg-secondary/40 p-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Database className="size-5" />
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm text-foreground">StreamDiffusion Local Server</span>
                    <span className="text-xs text-muted-foreground">Servidor de renderização em VRAM</span>
                  </div>
                  <Badge className="ml-auto border-positive/30 bg-positive/10 text-positive">Ligado</Badge>
                </div>

              </CardContent>
            </Card>

            {/* Biometric Active Sensors Controls */}
            <Card className="border-border bg-card panel-shadow mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <CardHeader>
                <CardTitle className="text-foreground">Controlo Ativo de Sensores Biométricos</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <span className="text-xs text-muted-foreground mb-1 leading-relaxed">
                  Ative ou desative sensores biométricos em tempo real (hot-swapping) para otimizar o processamento e a poupança de recursos (CPU/GPU) no motor Python.
                </span>

                {/* Switch 1: rPPG */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-secondary/15 p-3.5 hover:bg-secondary/20 transition-colors">
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs text-foreground font-semibold">Ativar Leitura Cardíaca (rPPG)</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">Extração remota de batimentos cardíacos por câmara</span>
                  </div>
                  <Switch 
                    checked={activeSensors.rppg} 
                    onCheckedChange={(val) => setActiveSensors(prev => ({ ...prev, rppg: val }))} 
                  />
                </div>

                {/* Switch 2: Gaze */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-secondary/15 p-3.5 hover:bg-secondary/20 transition-colors">
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs text-foreground font-semibold">Ativar Rastreio do Olhar (Gaze)</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">Estimativa ocular 3D de foco e direção do vetor do olhar</span>
                  </div>
                  <Switch 
                    checked={activeSensors.gaze} 
                    onCheckedChange={(val) => setActiveSensors(prev => ({ ...prev, gaze: val }))} 
                  />
                </div>

                {/* Switch 3: Blink */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-secondary/15 p-3.5 hover:bg-secondary/20 transition-colors">
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs text-foreground font-semibold">Ativar Análise de Pestanejo e Fadiga (Blink/EAR)</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">Cálculo de abertura das pálpebras (EAR) e frequência de pestanejo</span>
                  </div>
                  <Switch 
                    checked={activeSensors.blink} 
                    onCheckedChange={(val) => setActiveSensors(prev => ({ ...prev, blink: val }))} 
                  />
                </div>

                {/* Switch 4: Symmetry */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-secondary/15 p-3.5 hover:bg-secondary/20 transition-colors">
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs text-foreground font-semibold">Ativar Análise de Simetria e Micro-expressões</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">Diferença absoluta do EAR esquerdo/direito para tensão facial</span>
                  </div>
                  <Switch
                    checked={activeSensors.symmetry}
                    onCheckedChange={(val) => setActiveSensors(prev => ({ ...prev, symmetry: val }))}
                  />
                </div>

                {/* Switch 5: Fluxo Ótico da Sala */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-secondary/15 p-3.5 hover:bg-secondary/20 transition-colors">
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs text-foreground font-semibold">Ativar Fluxo Ótico da Sala</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">Energia e direção do movimento coletivo no espaço (funciona sem rosto)</span>
                  </div>
                  <Switch
                    checked={activeSensors.flow}
                    onCheckedChange={(val) => setActiveSensors(prev => ({ ...prev, flow: val }))}
                  />
                </div>

                {/* Switch 6: Presença Multi-Pessoa */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-secondary/15 p-3.5 hover:bg-secondary/20 transition-colors">
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs text-foreground font-semibold">Ativar Presença Multi-Pessoa</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">Contagem e posição de visitantes; tamanho da face como proxy de proximidade</span>
                  </div>
                  <Switch
                    checked={activeSensors.presence}
                    onCheckedChange={(val) => setActiveSensors(prev => ({ ...prev, presence: val }))}
                  />
                </div>

                {/* Switch 7: Gestos de Corpo */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-secondary/15 p-3.5 hover:bg-secondary/20 transition-colors">
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs text-foreground font-semibold">Ativar Gestos de Corpo (1 pessoa)</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">Braços abertos e agachamento via pose corporal — custo de CPU adicional</span>
                  </div>
                  <Switch
                    checked={activeSensors.gesture}
                    onCheckedChange={(val) => setActiveSensors(prev => ({ ...prev, gesture: val }))}
                  />
                </div>
              </CardContent>
            </Card>
          </>
        )}

        </div>

        {/* Right column (1/3) */}
        <div className="flex flex-col gap-6">
          
          {/* Interface custom controls (Appearance) */}
          <Card className="border-border bg-card panel-shadow">
            <CardHeader>
              <CardTitle className="text-foreground">Personalização de Interface</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-3">
                <span className="text-sm text-muted-foreground">{t.accentColor}</span>
                <div className="flex flex-wrap gap-3">
                  {accentColors.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onAccentChange && onAccentChange(c.value)}
                      aria-label={c.id}
                      className={`size-7 rounded-full transition-transform hover:scale-110 ${
                        accent === c.value ? "ring-2 ring-white ring-offset-2 ring-offset-card" : ""
                      }`}
                      style={{
                        backgroundColor: c.value,
                        boxShadow: `0 0 10px ${c.value}99`,
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <span className="text-sm text-muted-foreground">{t.density}</span>
                <div className="grid grid-cols-3 gap-2">
                  {densities.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDensity(d)}
                      className={`rounded-lg px-2 py-2 text-xs transition-colors ${
                        density === d
                          ? "bg-primary text-primary-foreground glow-primary"
                          : "border border-border bg-secondary text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {d === "Confortável" ? "Confortável" : d === "Espaçoso" ? "Espaçoso" : "Compacto"}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Gestão de Dados (Security tab block) */}
          <Card className="border-border bg-card panel-shadow">
            <CardHeader>
              <CardTitle className="text-foreground">Gestão de Dados</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              
              {/* Export Button */}
              <button
                type="button"
                onClick={() => handleDataAction("exportar")}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3 text-left hover:bg-secondary/70 transition-colors cursor-pointer"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Download className="size-4" />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-sm text-foreground">{t.export}</span>
                  <span className="text-xs text-muted-foreground">{t.exportDesc}</span>
                </div>
                <ChevronRight className="ml-auto size-4 text-muted-foreground" />
              </button>

              {/* Clear Cache Button */}
              <button
                type="button"
                onClick={() => handleDataAction("cache")}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3 text-left hover:bg-secondary/70 transition-colors cursor-pointer"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Trash2 className="size-4" />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-sm text-foreground">{t.clearCache}</span>
                  <span className="text-xs text-muted-foreground">{t.clearCacheDesc}</span>
                </div>
                <ChevronRight className="ml-auto size-4 text-muted-foreground" />
              </button>

              {/* Automatic backup switch */}
              <div className="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <DatabaseBackup className="size-4" />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-sm text-foreground">{t.autoBackup}</span>
                  <span className="text-xs text-muted-foreground">{t.autoBackupDesc}</span>
                </div>
                <div className="ml-auto">
                  <Switch checked={backup} onCheckedChange={setBackup} />
                </div>
              </div>

              {/* Ver backups list triggers */}
              <button
                type="button"
                onClick={() => {
                  handleCreateBackup();
                  setShowBackupsModal(true);
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3 text-left hover:bg-secondary/70 transition-colors cursor-pointer"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <History className="size-4" />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-sm text-foreground">{t.viewBackups}</span>
                  <span className="text-xs text-muted-foreground">{t.viewBackupsDesc}</span>
                </div>
                <ChevronRight className="ml-auto size-4 text-muted-foreground" />
              </button>

            </CardContent>
          </Card>

          {/* Danger zone (No actions, purely visual as required) */}
          <Card className="border-destructive/40 bg-card panel-shadow">
            <CardHeader>
              <CardTitle className="text-red-400">{t.dangerZone}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <button
                type="button"
                className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-left transition-colors hover:bg-red-500/10 cursor-not-allowed opacity-80"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-400">
                  <RotateCcw className="size-4" />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-sm text-red-400">{t.resetSettings}</span>
                  <span className="text-xs text-muted-foreground">{t.resetSettingsDesc}</span>
                </div>
                <ChevronRight className="ml-auto size-4 text-red-400/60" />
              </button>
              <button
                type="button"
                className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-left transition-colors hover:bg-red-500/10 cursor-not-allowed opacity-80"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-400">
                  <UserX className="size-4" />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-sm text-red-400">{t.deleteAccount}</span>
                  <span className="text-xs text-muted-foreground">{t.deleteAccountDesc}</span>
                </div>
                <ChevronRight className="ml-auto size-4 text-red-400/60" />
              </button>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* Backups viewer modal dialog */}
      {showBackupsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-[#0b0f19] p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <div className="flex items-center gap-2">
                <DatabaseBackup className="size-5 text-primary glow-text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Backups Guardados</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowBackupsModal(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-lg"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-1">
              {backupsList.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-4 border border-border bg-secondary/30 p-3 rounded-xl">
                  <div className="flex flex-col">
                    <span className="text-xs text-foreground font-semibold">{b.name}</span>
                    <span className="text-[10px] text-muted-foreground">{b.date}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleRestoreBackup(b)}
                      className="h-8 bg-primary/20 text-primary hover:bg-primary/30 text-xs px-2.5 rounded-lg border border-primary/20"
                    >
                      Restaurar
                    </Button>
                    <button
                      type="button"
                      onClick={() => handleDeleteBackup(b.id)}
                      className="text-muted-foreground hover:text-red-400 p-1.5 rounded-lg transition-colors"
                      title="Eliminar"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-4 mt-5">
              <Button
                variant="outline"
                onClick={() => setShowBackupsModal(false)}
                className="h-9 border-border hover:bg-secondary text-xs rounded-xl"
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Simple local close icon imported dynamically
function X(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
