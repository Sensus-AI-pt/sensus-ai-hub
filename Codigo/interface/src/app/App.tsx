import { useState, useEffect, useRef } from "react";
import { SidebarProvider, SidebarInset } from "./components/ui/sidebar";
import { LoginScreen } from "./components/dashboard/LoginScreen";
import { AppSidebar } from "./components/dashboard/AppSidebar";
import { TopNav } from "./components/dashboard/TopNav";
import { KpiCard } from "./components/dashboard/KpiCard";
import { HeroCard } from "./components/dashboard/HeroCard";
import { BehaviorTable } from "./components/dashboard/BehaviorTable";
import { GaugeCard } from "./components/dashboard/GaugeCard";
import { ActivityChart } from "./components/dashboard/ActivityChart";
import { RecentActivity } from "./components/dashboard/RecentActivity";
import { EmotionParams } from "./components/dashboard/EmotionParams";
import { StateControls } from "./components/dashboard/StateControls";
import { SettingsPage } from "./components/dashboard/SettingsPage";
import { ChatbotsPage } from "./components/dashboard/ChatbotsPage";
import { StatisticsPage } from "./components/dashboard/StatisticsPage";
import { DevicesPage } from "./components/dashboard/DevicesPage";
import { AssistantPage } from "./components/dashboard/AssistantPage";
import { UpgradeRequired } from "./components/dashboard/UpgradeRequired";
import { hasAccess, PAGE_TIER } from "./components/dashboard/tierAccess";
import { MonitoringPage } from "./components/dashboard/MonitoringPage";
import { StartScreen } from "./components/dashboard/StartScreen";
import type { ExhibitionFile } from "../exhibitions/types";
import { HomePage } from "./components/dashboard/HomePage";
import { OnboardingTour } from "./components/dashboard/OnboardingTour";
import { hasSeenOnboarding, markOnboardingSeen } from "./components/dashboard/onboarding";
import { ProjectionCameraView, ProjectionAIView } from "./components/dashboard/ProjectionView";
import { kpis, kpisSecondary } from "./components/dashboard/data";
import { incrementSessions } from "./components/dashboard/sessions";
import { cameraDeArranque } from "./components/dashboard/cameraSource";
import { vistaDaJanela } from "../lib/vistaDaJanela";
import { saveSessionSummary } from "./components/dashboard/sessionHistory";
import { translations } from "./components/dashboard/translations";
import { Lock } from "lucide-react";
import { useSettings } from "../context/SettingsContext";
// @ts-ignore
import transitionVideo from "../imports/1.mp4";
import loginBg from "../imports/ChatGPT_Image_13_07_2026__16_21_33.png";

const MONITOR_SECTIONS = ["Análise", "Relatórios", "Gráficos", "Mapa Emocional", "Vídeos"];

const resolveVideoSrc = (src: any) => {
  if (typeof src === "string" && src.startsWith("file://")) {
    const idx = src.indexOf("assets/");
    if (idx !== -1) {
      return src.substring(idx);
    }
  }
  return src;
};

declare global {
  interface Window {
    electronAPI?: any;
  }
}

export default function App() {
  const {
    user,
    loading,
    hasPaid,
    tier,
    theme,
    accent,
    lang,
    setLang,
    setTheme,
    setAccent,
    logout,
    activeSensors
  } = useSettings();

  const [active, setActive] = useState("home");
  const [envStarted, setEnvStarted] = useState(false);
  const [latestData, setLatestData] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  // Histórico da sessão inteira (sem limite de 20 frames) — usado pelas Estatísticas.
  const [sessionHistory, setSessionHistory] = useState<any[]>([]);
  const sessionHistoryRef = useRef<any[]>([]);
  const sessionStartedAtRef = useRef<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [tourOpen, setTourOpen] = useState(false);
  const t = translations[lang] || translations.pt;

  useEffect(() => {
    if (!user) return;
    if (!hasSeenOnboarding(user.id)) {
      setTourOpen(true);
    }
  }, [user]);

  const viewParam = vistaDaJanela();

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onRPPGData((data: any) => {
        if (!data) return;
        const isAutoUpdate = localStorage.getItem("sensus-setting-auto") !== "false";
        if (!isAutoUpdate) return;
        setLatestData(data);

        // NOTA: telemetria contínua (BPM, sensorial, biométrica) NÃO gera
        // notificações. O centro de notificações recebe apenas eventos
        // estruturais de ciclo de vida (início/fim de sessão, sincronização).

        setHistory((prev) => {
          const val = typeof data.val === 'number' ? data.val : 0;
          const aro = typeof data.aro === 'number' ? data.aro : 0;
          const bpm = typeof data.bpm === 'number' ? data.bpm : 0;
          // Dilatação da íris (raio normalizado pela largura facial, ~0.06–0.16) → índice 0–100%
          const iris = typeof data.iris_radius === 'number' && data.iris_radius > 0
            ? Math.max(0, Math.min(100, Math.round(((data.iris_radius - 0.06) / 0.10) * 100)))
            : 0;
          const next = [
            ...prev,
            {
              name: new Date().toLocaleTimeString("pt-PT", {
                second: "2-digit",
                minute: "2-digit",
              }),
              a: Math.round((val + 1) / 2 * 100), // Bem-estar / Valência (%)
              b: bpm > 0 ? Math.round(bpm) : 0, // Batimento (BPM)
              c: Math.round(aro * 100), // Excitação / Arousal (%)
              i: iris, // Dilatação da íris (%)
            },
          ];
          if (next.length > 20) next.shift();
          return next;
        });

        setSessionHistory((prev) => {
          const val = typeof data.val === 'number' ? data.val : 0;
          const aro = typeof data.aro === 'number' ? data.aro : 0;
          const bpm = typeof data.bpm === 'number' ? data.bpm : 0;
          const next = [
            ...prev,
            {
              name: new Date().toLocaleTimeString("pt-PT", { second: "2-digit", minute: "2-digit" }),
              a: Math.round((val + 1) / 2 * 100),
              b: bpm > 0 ? Math.round(bpm) : 0,
              c: Math.round(aro * 100),
              // Campos por ambiente: cada um só é preenchido onde existe, e as
              // Estatísticas só mostram os que fazem sentido para o ambiente.
              dist: typeof data.dist_cm === "number" ? data.dist_cm : undefined,
              aPintar: data.paint ? !!data.paint.pintar : undefined,
              maos: data.paint ? data.paint.maos ?? 0 : undefined,
              energia: typeof data.room?.energy === "number" ? data.room.energy : undefined,
              comGeracao: data.flow_field ? !!data.image_ia : undefined,
            },
          ];
          if (next.length > 2000) next.shift();
          sessionHistoryRef.current = next;
          return next;
        });
      });

      const pushEndOfSessionNotif = () => {
        const endNotif = {
          id: Date.now(),
          title: "Fim de Sessão",
          titleColor: "text-cyan",
          time: "agora",
          text: "A sessão do ambiente virtual foi encerrada.",
        };
        try {
          const raw = localStorage.getItem("sensus-live-notifications") || "[]";
          const list = JSON.parse(raw);
          localStorage.setItem("sensus-live-notifications", JSON.stringify([endNotif, ...list]));
        } catch (e) {}
      };

      const flushSessionHistory = () => {
        // O ambiente vem do localStorage, que é onde o StartScreen o deixa —
        // é a mesma fonte que o painel de projeção usa.
        let ambiente: { id: string; nome: string } | undefined;
        try {
          const raw = localStorage.getItem("sensus-active-exhibition");
          if (raw) {
            const e = JSON.parse(raw) as ExhibitionFile;
            ambiente = { id: e.id, nome: e.name };
          }
        } catch {
          // Ignorado — a sessão fica sem ambiente e aparece como "Todos".
        }
        saveSessionSummary(sessionHistoryRef.current, sessionStartedAtRef.current || new Date().toISOString(), ambiente);
        sessionHistoryRef.current = [];
        setSessionHistory([]);
      };

      if (viewParam !== "projection") {
        window.electronAPI.onRPPGExit((code: number) => {
          setEnvStarted(false);
          setLatestData(null);
          pushEndOfSessionNotif();
          flushSessionHistory();
        });

        window.electronAPI.onProjectionClosed(() => {
          setEnvStarted(false);
          setLatestData(null);
          pushEndOfSessionNotif();
          flushSessionHistory();
        });
      }
    }
  }, [viewParam]);

  const handleStartEnv = async (exhibition: ExhibitionFile) => {
    // Zero out states to empty/zeroed defaults on environment start
    setLatestData(null);
    setHistory([]);
    setSessionHistory([]);
    sessionHistoryRef.current = [];
    sessionStartedAtRef.current = new Date().toISOString();
    localStorage.setItem("sensus-active-exhibition", JSON.stringify(exhibition));
    if (!window.electronAPI) {
      // In web development mode, just simulate starting
      setEnvStarted(true);
      return;
    }
    try {
      // O ambiente arranca **sempre** na câmara do PC. O telemóvel pede
      // autorização de espelhamento no próprio telemóvel, e uma peça que
      // arranca à espera dessa autorização — ou que a apanha recusada — fica
      // sem imagem por um motivo que não está no ecrã do operador. Escolher o
      // telemóvel nas configurações troca a fonte ao vivo, mas não fica a valer
      // para o arranque seguinte (ver `handleCameraSourceChange`).
      const res = await window.electronAPI.launchRPPG(cameraDeArranque());
      if (res.success && res.status === "running") {
        setEnvStarted(true);

        // Incrementa o total acumulado e o contador diário (reset automático à meia-noite)
        incrementSessions();

        // Launch secondary projection monitor windows
        window.electronAPI.openProjection();
        // Send initial parameters after a small delay
        setTimeout(() => {
          // Nada de repetir aqui o SET_CAMERA_SOURCE: o motor já arrancou com
          // `--camera`, e reenviá-lo dois segundos depois desfazia qualquer
          // recurso que o motor tivesse entretanto tomado (era assim que uma
          // fonte que falhou voltava a ser tentada em vez de ficar no PC).
          window.electronAPI.sendRPPGCommand(`LOAD_EXHIBITION ${JSON.stringify(exhibition)}`);

          // Log active environment startup notification
          const startNotif = {
            id: Date.now(),
            title: "Ambiente Iniciado",
            titleColor: "text-primary",
            time: "agora",
            text: `Ambiente virtual [${exhibition.name}] inicializado com sucesso.`
          };
          const raw = localStorage.getItem("sensus-live-notifications") || "[]";
          const list = JSON.parse(raw);
          localStorage.setItem("sensus-live-notifications", JSON.stringify([startNotif, ...list]));
        }, 2000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // As janelas de projeção são decididas ANTES de qualquer porta de
  // autenticação. São superfícies de saída, abertas por uma janela principal
  // que já tem sessão: o que lhes chega é telemetria por IPC, não dados de
  // conta. Enquanto estiveram depois do `if (!user)`, uma sessão que não fosse
  // o acesso local punha o ecrã de entrada em cima do projetor — e agora, sem
  // sessão guardada entre arranques, seria sempre assim.
  if (viewParam === "projection-camera") {
    return (
      <div className={theme} style={{ '--primary': accent } as React.CSSProperties}>
        <ProjectionCameraView latestData={latestData} />
      </div>
    );
  }

  if (viewParam === "projection-ai" || viewParam === "projection") {
    return (
      <div className={theme} style={{ '--primary': accent } as React.CSSProperties}>
        <ProjectionAIView latestData={latestData} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="dark min-h-svh bg-[#060814] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-[0_0_15px_rgba(123,63,226,0.3)]" />
          <span className="mov-respira text-sm font-medium text-gray-400 uppercase tracking-widest">Sensus AI</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen 
        lang={lang}
        onLangChange={setLang}
        onLogin={() => {}} 
      />
    );
  }

  if (hasPaid === false) {
    return (
      <div className="dark min-h-svh bg-[#060814] text-white flex items-center justify-center p-6 relative overflow-hidden">
        {/* Ambient glows */}
        <div className="absolute inset-0 z-0">
          <img src={loginBg} className="size-full object-cover opacity-30" alt="" aria-hidden />
          <div className="absolute inset-0 bg-gradient-to-t from-[#060814] via-transparent to-[#060814]" />
        </div>
        <div className="pointer-events-none absolute size-[30rem] rounded-full bg-primary/10 blur-[130px] z-0" />

        <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center backdrop-blur-xl shadow-2xl">
          <div className="flex justify-center mb-6">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-lg">
              <Lock size={28} />
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-white mb-3">Licença Requerida</h2>
          
          <p className="text-sm text-gray-400 mb-8 leading-relaxed">
            {lang === "en" 
              ? "You need an active license to use Sensus AI." 
              : lang === "es"
              ? "Necesitas una licencia activa para usar Sensus AI."
              : lang === "fr"
              ? "Vous avez besoin d'une licence active pour utiliser Sensus AI."
              : "Precisas de uma licença ativa para usar o Sensus AI."}
          </p>

          <div className="flex flex-col gap-3">
            <a
              href="https://buy.stripe.com/test_4gMcMX9u53Wu5UagZGbfO00"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-medium text-white glow-primary transition-all hover:bg-primary/90"
            >
              {lang === "en" ? "Acquire License" : "Adquirir Licença"}
            </a>
            <button
              onClick={() => logout()}
              className="text-xs text-gray-400 hover:text-white transition-colors py-2 cursor-pointer"
            >
              {lang === "en" ? "Sign Out" : "Terminar Sessão"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    if (active === "home") return <HomePage lang={lang} envStarted={envStarted} onNavigate={setActive} />;
    if (active === "config") {
      return (
        <SettingsPage
          lang={lang}
          onLangChange={setLang}
          theme={theme}
          onThemeChange={setTheme}
          accent={accent}
          onAccentChange={setAccent}
          onReplayTour={() => setTourOpen(true)}
        />
      );
    }
    if (active === "chatbots") {
      if (!hasAccess(PAGE_TIER.chatbots, tier)) {
        return <UpgradeRequired pageLabel={t.chatbots} requiredTier={PAGE_TIER.chatbots!} lang={lang} />;
      }
      return <ChatbotsPage lang={lang} searchQuery={searchQuery} />;
    }
    if (active === "estatisticas") return <StatisticsPage latestData={latestData} history={sessionHistory} lang={lang} searchQuery={searchQuery} />;
    if (active === "dispositivos") {
      if (!hasAccess(PAGE_TIER.dispositivos, tier)) {
        return <UpgradeRequired pageLabel={t.devices} requiredTier={PAGE_TIER.dispositivos!} lang={lang} />;
      }
      return <DevicesPage lang={lang} searchQuery={searchQuery} />;
    }
    if (active === "assistente") {
      if (!hasAccess(PAGE_TIER.assistente, tier)) {
        return <UpgradeRequired pageLabel={t.aiAssistant} requiredTier={PAGE_TIER.assistente!} lang={lang} />;
      }
      return <AssistantPage latestData={latestData} lang={lang} />;
    }
    // `lang` deixou de ser passado ao MonitoringPage e ao DashboardView: nenhum
    // deles o declara ou usa — o idioma vem do contexto de traduções.
    if (MONITOR_SECTIONS.includes(active)) return <MonitoringPage section={active} latestData={latestData} history={history} searchQuery={searchQuery} />;

    // Dashboard: gated by the virtual environment Play button
    if (!envStarted) return <StartScreen onStart={handleStartEnv} lang={lang} />;
    return <DashboardView latestData={latestData} history={history} searchQuery={searchQuery} />;
  };

  return (
    <div className={theme} style={{ '--primary': accent } as React.CSSProperties}>
      <SidebarProvider>
        <AppSidebar active={active} onNavigate={setActive} lang={lang} />
        <SidebarInset className="relative overflow-hidden bg-background">
          {/* Ambient background glows */}
          <div className="pointer-events-none absolute -left-40 -top-40 size-96 rounded-full bg-primary/20 blur-[120px]" />
          <div className="pointer-events-none absolute right-0 top-1/3 size-96 rounded-full bg-cyan/10 blur-[120px]" />
          <div className="pointer-events-none absolute bottom-0 left-1/3 size-96 rounded-full bg-primary/10 blur-[120px]" />

          <TopNav
            latestData={latestData}
            onLogout={logout}
            envStarted={envStarted}
            lang={lang}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onNavigate={setActive}
          />

          {renderContent()}
        </SidebarInset>
      </SidebarProvider>

      {tourOpen && user && (
        <OnboardingTour
          lang={lang}
          active={active}
          onNavigate={setActive}
          onClose={() => {
            markOnboardingSeen(user.id);
            setTourOpen(false);
          }}
        />
      )}
    </div>
  );
}

function DashboardView({ latestData, history, searchQuery = "" }: { latestData: any; history: any[]; searchQuery?: string }) {
  // Map live data to KPI cards
  const liveKpis = kpis.map((kpi) => {
    if (kpi.id === "valencia") {
      const val = (latestData && typeof latestData.val === "number") ? Math.round((latestData.val + 1) / 2 * 100) : 0;
      return {
        ...kpi,
        value: `${val}%`,
        data: latestData ? [{ i: 0, v: val }] : [{ i: 0, v: 0 }],
      };
    }
    if (kpi.id === "arousal") {
      const val = (latestData && typeof latestData.aro === "number") ? latestData.aro.toFixed(2) : "0.00";
      return {
        ...kpi,
        value: val,
        data: latestData ? [{ i: 0, v: parseFloat(val) * 100 }] : [{ i: 0, v: 0 }],
      };
    }
    if (kpi.id === "foco_ocular") {
      const val = (latestData && Array.isArray(latestData.ear) && typeof latestData.ear[0] === "number" && typeof latestData.ear[1] === "number")
        ? ((latestData.ear[0] + latestData.ear[1]) / 2).toFixed(2)
        : "0.00";
      return {
        ...kpi,
        value: val,
        data: latestData ? [{ i: 0, v: parseFloat(val) * 100 }] : [{ i: 0, v: 0 }],
      };
    }
    return kpi;
  });

  const liveKpisSecondary = kpisSecondary.map((kpi) => {
    if (kpi.id === "simetria") {
      const val = (latestData && typeof latestData.sym === "number") ? Math.round(latestData.sym * 100) : 0;
      return {
        ...kpi,
        value: `${val}%`,
        data: latestData ? [{ i: 0, v: val }] : [{ i: 0, v: 0 }],
      };
    }
    if (kpi.id === "bpm") {
      const val = (latestData && typeof latestData.bpm === "number" && latestData.bpm > 0) ? `${Math.round(latestData.bpm)} BPM` : "0 BPM";
      return {
        ...kpi,
        value: val,
        data: latestData ? [{ i: 0, v: latestData.bpm || 0 }] : [{ i: 0, v: 0 }],
      };
    }
    return kpi;
  });

  const filteredKpis = liveKpis.filter(kpi => 
    kpi.label.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const filteredKpisSecondary = liveKpisSecondary.filter(kpi => 
    kpi.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="relative z-10 flex flex-1 flex-col gap-4 p-4 md:p-6">
      {/* Row 1: KPIs + hero */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-7">
          {filteredKpis.map((kpi) => (
            <KpiCard key={kpi.id} kpi={kpi} />
          ))}
          {filteredKpis.length === 0 && (
            <div className="col-span-3 flex items-center justify-center rounded-xl border border-dashed border-border bg-secondary/10 p-6 text-xs text-muted-foreground">
              Nenhum KPI principal corresponde à pesquisa
            </div>
          )}
        </div>
        <div className="lg:col-span-5">
          <HeroCard latestData={latestData} />
        </div>
      </div>

      {/* Row 2: table + gauge */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <BehaviorTable latestData={latestData} />
        </div>
        <div className="lg:col-span-4">
          <GaugeCard latestData={latestData} />
        </div>
      </div>

      {/* Row 3: secondary KPIs + activity chart */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-1">
          {filteredKpisSecondary.map((kpi) => (
            <KpiCard key={kpi.id} kpi={kpi} />
          ))}
          {filteredKpisSecondary.length === 0 && (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-border bg-secondary/10 p-6 text-xs text-muted-foreground">
              Nenhum KPI secundário corresponde à pesquisa
            </div>
          )}
        </div>
        <div className="lg:col-span-8">
          <ActivityChart history={history} />
        </div>
      </div>

      {/* Row 4: recent activity + emotion params + state controls */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RecentActivity latestData={latestData} />
        <EmotionParams latestData={latestData} />
        <StateControls latestData={latestData} />
      </div>
    </div>
  );
}
