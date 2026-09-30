export type TourStep = {
  page: string;
  target: string | null;
  title: Record<string, string>;
  description: Record<string, string>;
};

const SEEN_KEY_PREFIX = "sensus_onboarding_seen_";

export function hasSeenOnboarding(userId: string): boolean {
  return localStorage.getItem(SEEN_KEY_PREFIX + userId) === "true";
}

export function markOnboardingSeen(userId: string): void {
  localStorage.setItem(SEEN_KEY_PREFIX + userId, "true");
}

export const TOUR_STEPS: TourStep[] = [
  {
    page: "home",
    target: null,
    title: {
      pt: "Bem-vindo ao Sensus AI Hub",
      en: "Welcome to Sensus AI Hub",
      es: "Bienvenido a Sensus AI Hub",
      fr: "Bienvenue sur Sensus AI Hub",
    },
    description: {
      pt: "Vamos fazer um tour rápido pelas principais secções da aplicação. Podes saltar a qualquer momento.",
      en: "Let's take a quick tour through the app's main sections. You can skip at any time.",
      es: "Hagamos un recorrido rápido por las secciones principales de la aplicación. Puedes saltar en cualquier momento.",
      fr: "Faisons un tour rapide des principales sections de l'application. Vous pouvez passer à tout moment.",
    },
  },
  {
    page: "home",
    target: "home-hero",
    title: {
      pt: "A tua Home",
      en: "Your Home",
      es: "Tu Inicio",
      fr: "Votre Accueil",
    },
    description: {
      pt: "Aqui vês o estado do Ambiente Virtual, as tuas sessões de hoje e atalhos rápidos para o resto da app.",
      en: "Here you see the Virtual Environment status, today's sessions, and quick shortcuts to the rest of the app.",
      es: "Aquí ves el estado del Entorno Virtual, tus sesiones de hoy y accesos rápidos al resto de la app.",
      fr: "Ici, vous voyez l'état de l'Environnement Virtuel, vos sessions du jour et des raccourcis vers le reste de l'application.",
    },
  },
  {
    page: "dashboard",
    target: "nav-dashboard",
    title: {
      pt: "Ambiente Virtual",
      en: "Virtual Environment",
      es: "Entorno Virtual",
      fr: "Environnement Virtuel",
    },
    description: {
      pt: "Aqui inicias a sessão biométrica e visual em tempo real — batimento cardíaco, estado emocional e projeção generativa.",
      en: "This is where you start the real-time biometric and visual session — heart rate, emotional state, and generative projection.",
      es: "Aquí inicias la sesión biométrica y visual en tiempo real: ritmo cardíaco, estado emocional y proyección generativa.",
      fr: "C'est ici que vous démarrez la session biométrique et visuelle en temps réel — fréquence cardiaque, état émotionnel et projection générative.",
    },
  },
  {
    page: "Análise",
    target: "nav-monitorizacao",
    title: {
      pt: "Monitorização",
      en: "Monitoring",
      es: "Monitorización",
      fr: "Surveillance",
    },
    description: {
      pt: "Análise, relatórios, gráficos, mapa emocional e vídeos das tuas sessões, tudo agrupado aqui.",
      en: "Analysis, reports, graphs, emotional map, and session videos, all grouped here.",
      es: "Análisis, informes, gráficos, mapa emocional y vídeos de tus sesiones, todo agrupado aquí.",
      fr: "Analyse, rapports, graphiques, carte émotionnelle et vidéos de vos sessions, tout regroupé ici.",
    },
  },
  {
    page: "assistente",
    target: "nav-assistente",
    title: {
      pt: "Assistente IA",
      en: "AI Assistant",
      es: "Asistente IA",
      fr: "Assistant IA",
    },
    description: {
      pt: "Conversa com o assistente para gerar novos ambientes visuais e tirar dúvidas sobre a tua sessão.",
      en: "Talk to the assistant to generate new visual environments and ask questions about your session.",
      es: "Habla con el asistente para generar nuevos entornos visuales y resolver dudas sobre tu sesión.",
      fr: "Discutez avec l'assistant pour générer de nouveaux environnements visuels et poser des questions sur votre session.",
    },
  },
  {
    page: "chatbots",
    target: "nav-chatbots",
    title: {
      pt: "Chatbots",
      en: "Chatbots",
      es: "Chatbots",
      fr: "Chatbots",
    },
    description: {
      pt: "Gere os chatbots disponíveis para interação durante as sessões.",
      en: "Manage the chatbots available for interaction during sessions.",
      es: "Gestiona los chatbots disponibles para interactuar durante las sesiones.",
      fr: "Gérez les chatbots disponibles pour l'interaction pendant les sessions.",
    },
  },
  {
    page: "estatisticas",
    target: "nav-estatisticas",
    title: {
      pt: "Estatísticas",
      en: "Statistics",
      es: "Estadísticas",
      fr: "Statistiques",
    },
    description: {
      pt: "Consulta tendências e histórico das tuas sessões ao longo do tempo.",
      en: "Review trends and history of your sessions over time.",
      es: "Consulta tendencias e historial de tus sesiones a lo largo del tiempo.",
      fr: "Consultez les tendances et l'historique de vos sessions au fil du temps.",
    },
  },
  {
    page: "dispositivos",
    target: "nav-dispositivos",
    title: {
      pt: "Dispositivos",
      en: "Devices",
      es: "Dispositivos",
      fr: "Appareils",
    },
    description: {
      pt: "Gere os sensores e dispositivos biométricos ligados à app.",
      en: "Manage the biometric sensors and devices connected to the app.",
      es: "Gestiona los sensores y dispositivos biométricos conectados a la app.",
      fr: "Gérez les capteurs et appareils biométriques connectés à l'application.",
    },
  },
  {
    page: "config",
    target: "nav-config",
    title: {
      pt: "Definições",
      en: "Settings",
      es: "Configuración",
      fr: "Paramètres",
    },
    description: {
      pt: "Personaliza tema, idioma, segurança e integrações. Podes rever este tour aqui sempre que quiseres.",
      en: "Customize theme, language, security, and integrations. You can replay this tour here anytime.",
      es: "Personaliza tema, idioma, seguridad e integraciones. Puedes volver a ver este tour aquí cuando quieras.",
      fr: "Personnalisez le thème, la langue, la sécurité et les intégrations. Vous pouvez revoir ce tour ici à tout moment.",
    },
  },
  {
    page: "home",
    target: "home-quick-actions",
    title: {
      pt: "Pronto a começar",
      en: "Ready to start",
      es: "Listo para empezar",
      fr: "Prêt à commencer",
    },
    description: {
      pt: "Já conheces o essencial do Sensus AI Hub. Usa estes atalhos para ires diretamente onde precisares.",
      en: "You now know the essentials of Sensus AI Hub. Use these shortcuts to jump straight where you need.",
      es: "Ya conoces lo esencial de Sensus AI Hub. Usa estos accesos directos para ir directamente a donde necesites.",
      fr: "Vous connaissez maintenant l'essentiel de Sensus AI Hub. Utilisez ces raccourcis pour aller directement où vous en avez besoin.",
    },
  },
];
