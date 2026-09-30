import { useState, useEffect } from "react";
import {
  Sparkles,
  Play,
  ChevronRight,
  Activity,
  CalendarCheck,
  Bot,
  BarChart3,
  Cpu,
  Settings as SettingsIcon,
  Mail,
  Linkedin,
} from "lucide-react";
import { PageHeader } from "./PageHeader";
import { translations } from "./translations";
import { getTodaySessions, getTotalSessions } from "./sessions";
import heroImage from "../../../imports/ChatGPT_Image_13_07_2026__16_21_33.png";

const SOCIAL_LINKS = [
  { label: "Email", href: "mailto:ia.sensus.ai@gmail.com", value: "ia.sensus.ai@gmail.com", icon: Mail },
  { label: "LinkedIn", href: "https://linkedin.com/company/ai-sensus-ai", value: "linkedin.com/company/ai-sensus-ai", icon: Linkedin },
];

export function HomePage({
  lang = "pt",
  envStarted = false,
  onNavigate = () => {},
}: {
  lang?: string;
  envStarted?: boolean;
  onNavigate?: (id: string) => void;
}) {
  const t = translations[lang] || translations.pt;
  const [userName, setUserName] = useState(() => localStorage.getItem("sensus_user_name") || "Utilizador");
  const [todaySessions, setTodaySessions] = useState(() => getTodaySessions());
  const [totalSessions, setTotalSessions] = useState(() => getTotalSessions());
  const firstName = userName.split(" ")[0];

  // Sessões e nome de perfil podem mudar noutras páginas (TopNav) — mantém sincronizado
  useEffect(() => {
    const sync = () => {
      setUserName(localStorage.getItem("sensus_user_name") || "Utilizador");
      setTodaySessions(getTodaySessions());
      setTotalSessions(getTotalSessions());
    };
    const interval = setInterval(sync, 1000);
    return () => clearInterval(interval);
  }, []);

  const quickActions = [
    {
      id: "assistente",
      label: t.aiAssistant,
      desc:
        lang === "en" ? "Generate a new visual environment" :
        lang === "es" ? "Generar un nuevo entorno visual" :
        lang === "fr" ? "Générer un nouvel environnement visuel" :
        "Gerar um novo ambiente visual",
      icon: Bot,
    },
    {
      id: "estatisticas",
      label: t.statistics,
      desc:
        lang === "en" ? "Review your sessions and trends" :
        lang === "es" ? "Revisar tus sesiones y tendencias" :
        lang === "fr" ? "Consulter vos sessions et tendances" :
        "Consultar as tuas sessões e tendências",
      icon: BarChart3,
    },
    {
      id: "dispositivos",
      label: t.devices,
      desc:
        lang === "en" ? "Manage connected sensors" :
        lang === "es" ? "Gestionar sensores conectados" :
        lang === "fr" ? "Gérer les capteurs connectés" :
        "Gerir os sensores ligados",
      icon: Cpu,
    },
    {
      id: "config",
      label: t.settings,
      desc:
        lang === "en" ? "Personalize the experience" :
        lang === "es" ? "Personalizar la experiencia" :
        lang === "fr" ? "Personnaliser l'expérience" :
        "Personalizar a experiência",
      icon: SettingsIcon,
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title={t.home} subtitle="sensus AI" />

      {/* Hero de boas-vindas */}
      <div data-tour="home-hero" className="relative overflow-hidden rounded-2xl border border-border bg-card panel-shadow">
        <div className="pointer-events-none absolute inset-0">
          <img src={heroImage} className="size-full object-cover opacity-50" alt="" aria-hidden />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/75 to-background/30" />
        </div>
        <div className="relative flex flex-col gap-5 p-6 sm:p-10">
          <h2 className="text-3xl leading-tight text-foreground sm:text-4xl">
            {lang === "en" ? "Welcome, " : lang === "es" ? "Bienvenido, " : lang === "fr" ? "Bienvenue, " : "Bem-vindo, "}
            <span className="text-primary glow-text-primary">{firstName}.</span>
          </h2>
          <p className="max-w-lg text-sm text-muted-foreground sm:text-base">
            {lang === "en"
              ? "Sensus AI Hub is your real-time sensory and emotional regulation platform — biometrics, generative visuals and bio-reactive music in one place."
              : lang === "es"
              ? "Sensus AI Hub es tu plataforma de regulación sensorial y emocional en tiempo real — biometría, visuales generativos y música bio-reactiva en un solo lugar."
              : lang === "fr"
              ? "Sensus AI Hub est votre plateforme de régulation sensorielle et émotionnelle en temps réel — biométrie, visuels génératifs et musique bio-réactive réunis."
              : "O Sensus AI Hub é a tua plataforma de regulação sensorial e emocional em tempo real — biometria, visuais generativos e música bio-reativa num só lugar."}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onNavigate("dashboard")}
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm text-primary-foreground glow-primary transition-colors hover:bg-primary/90"
            >
              <Play className="size-4" />
              {envStarted
                ? lang === "en" ? "Open Virtual Environment" : lang === "es" ? "Abrir Entorno Virtual" : lang === "fr" ? "Ouvrir l'Environnement Virtuel" : "Abrir Ambiente Virtual"
                : lang === "en" ? "Start Virtual Environment" : lang === "es" ? "Iniciar Entorno Virtual" : lang === "fr" ? "Démarrer l'Environnement Virtuel" : "Iniciar Ambiente Virtual"}
            </button>
            <button
              type="button"
              onClick={() => onNavigate("estatisticas")}
              className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-5 py-3 text-sm text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              {t.statistics}
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Cards de estado */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card panel-shadow p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Activity className="size-4 text-primary" />
            <span className="text-xs uppercase tracking-widest">
              {lang === "en" ? "Environment" : lang === "es" ? "Entorno" : lang === "fr" ? "Environnement" : "Ambiente Virtual"}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${envStarted ? "bg-positive" : "bg-muted-foreground"}`}
              style={envStarted ? { boxShadow: "0 0 8px var(--positive)" } : undefined}
            />
            <span className="text-foreground">
              {envStarted
                ? lang === "en" ? "Active" : lang === "es" ? "Activo" : lang === "fr" ? "Actif" : "Ativo"
                : lang === "en" ? "Idle" : lang === "es" ? "Inactivo" : lang === "fr" ? "Inactif" : "Em repouso"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("dashboard")}
            className="mt-4 inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80"
          >
            {lang === "en" ? "Go to environment" : lang === "es" ? "Ir al entorno" : lang === "fr" ? "Aller à l'environnement" : "Ir para o ambiente"}
            <ChevronRight className="size-3" />
          </button>
        </div>

        <div className="rounded-2xl border border-border bg-card panel-shadow p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarCheck className="size-4 text-primary" />
            <span className="text-xs uppercase tracking-widest">{t.activeSessions}</span>
          </div>
          <div className="mt-3 text-foreground" style={{ fontSize: "2rem", fontWeight: 700, lineHeight: 1 }}>
            {todaySessions}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {lang === "en"
              ? `${totalSessions} total sessions`
              : lang === "es"
              ? `${totalSessions} sesiones en total`
              : lang === "fr"
              ? `${totalSessions} sessions au total`
              : `${totalSessions} sessões no total`}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card panel-shadow p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Sparkles className="size-4 text-primary" />
            <span className="text-xs uppercase tracking-widest">
              {lang === "en" ? "Need help?" : lang === "es" ? "¿Necesitas ayuda?" : lang === "fr" ? "Besoin d'aide ?" : "Precisas de ajuda?"}
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-1.5">
            {SOCIAL_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                className="flex items-center gap-2 text-xs text-foreground/90 transition-colors hover:text-primary"
              >
                <link.icon className="size-3.5 text-muted-foreground" />
                {link.value}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Ações rápidas */}
      <div data-tour="home-quick-actions" className="rounded-2xl border border-border bg-card panel-shadow">
        <div className="border-b border-border p-5">
          <h3 className="text-foreground">
            {lang === "en" ? "Quick Actions" : lang === "es" ? "Acciones Rápidas" : lang === "fr" ? "Actions Rapides" : "Ações Rápidas"}
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          {quickActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => onNavigate(action.id)}
              className="group flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-4 text-left transition-colors hover:border-primary/40"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <action.icon className="size-5" />
              </div>
              <div className="flex-1">
                <div className="text-foreground">{action.label}</div>
                <div className="text-xs text-muted-foreground">{action.desc}</div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
