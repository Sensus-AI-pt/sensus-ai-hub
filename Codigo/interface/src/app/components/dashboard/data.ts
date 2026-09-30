// Centralized mock data for the Sensus AI dashboard (Portuguese labels).
// Factory reset state.

export type Spark = { i: number; v: number };

const spark = (vals: number[]): Spark[] => vals.map((v, i) => ({ i, v }));

export type Kpi = {
  id: string;
  label: string;
  value: string;
  delta: string;
  trend: "up" | "down";
  data: Spark[];
};

export const kpis: Kpi[] = [
  {
    id: "valencia",
    label: "Valência Média",
    value: "--%",
    delta: "0,0%",
    trend: "up",
    data: spark([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  },
  {
    id: "arousal",
    label: "Excitação Média (Arousal)",
    value: "0.00",
    delta: "0,0%",
    trend: "up",
    data: spark([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  },
  {
    id: "foco_ocular",
    label: "Foco Ocular Médio",
    value: "--%",
    delta: "0,0%",
    trend: "up",
    data: spark([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  },
];

export const kpisSecondary: Kpi[] = [
  {
    id: "simetria",
    label: "Simetria Facial Média",
    value: "--%",
    delta: "0,0%",
    trend: "up",
    data: spark([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  },
  {
    id: "bpm",
    label: "Frequência Cardíaca (BPM)",
    value: "-- BPM",
    delta: "0,0%",
    trend: "up",
    data: spark([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  },
];

export type BehaviorRow = {
  id: string;
  categoria: string;
  estado: string;
  valor: number;
};

export const behaviorRows: BehaviorRow[] = [
  { id: "b1", categoria: "Valência Positiva", estado: "Estável", valor: 0 },
  { id: "b2", categoria: "Excitação (Arousal)", estado: "Estável", valor: 0 },
  { id: "b3", categoria: "Foco Ocular", estado: "Estável", valor: 0 },
  { id: "b4", categoria: "Simetria Facial", estado: "Estável", valor: 0 },
  { id: "b5", categoria: "Taxa de Piscadas (Blink)", estado: "Estável", valor: 0 },
  { id: "b6", categoria: "Engajamento Sensorial", estado: "Estável", valor: 0 },
];

export type ActivityItem = {
  id: string;
  titulo: string;
  descricao: string;
  tempo: string;
};

// Factory reset: starts empty
export const recentActivity: ActivityItem[] = [];

export const gauge = { value: 0, label: "Engajamento Geral" };

// --- Chatbots ---
export type Chatbot = {
  id: string;
  nome: string;
  descricao: string;
  estado: "Ativo" | "Inativo";
  conversas: number;
  precisao: number;
};

export const chatbots: Chatbot[] = [
  { id: "c1", nome: "Assistente Sensorial", descricao: "Apoio emocional e regulação em tempo real", estado: "Ativo", conversas: 0, precisao: 96 },
  { id: "c2", nome: "Guia de Estilos", descricao: "Sugestões de ambientes e dinâmicas", estado: "Ativo", conversas: 0, precisao: 91 },
  { id: "c3", nome: "Monitor de Biometria", descricao: "Deteção de níveis elevados de stress/arousal", estado: "Ativo", conversas: 0, precisao: 88 },
  { id: "c4", nome: "Relatórios de Sessão", descricao: "Geração de resumos e ficheiros CSV", estado: "Inativo", conversas: 0, precisao: 82 },
];

export const chatMessages = [
  { id: "m1", from: "bot" as const, text: "Olá! Como posso ajudar na sessão de hoje?" },
];

// --- Dispositivos ---
export type Device = {
  id: string;
  nome: string;
  tipo: string;
  estado: "Online" | "Offline";
  bateria: number;
  sala: string;
};

export const devices: Device[] = [
  { id: "d1", nome: "Câmara rPPG Principal", tipo: "Câmara", estado: "Online", bateria: 100, sala: "Jardim Fluido" },
  { id: "d2", nome: "Rastreador Ocular O1", tipo: "Sensor", estado: "Online", bateria: 100, sala: "Geometria Abstrata" },
];

// --- Estatísticas ---
export const weeklyStats = [
  { name: "Seg", sessoes: 0, foco: 0 },
  { name: "Ter", sessoes: 0, foco: 0 },
  { name: "Qua", sessoes: 0, foco: 0 },
  { name: "Qui", sessoes: 0, foco: 0 },
  { name: "Sex", sessoes: 0, foco: 0 },
  { name: "Sáb", sessoes: 0, foco: 0 },
  { name: "Dom", sessoes: 0, foco: 0 },
];

export const emotionDistribution = [
  { name: "Valência Positiva", value: 0, fill: "#7b3fe2" },
  { name: "Excitação (Arousal)", value: 0, fill: "#00e5ff" },
  { name: "Foco Ocular", value: 0, fill: "#34e5a3" },
  { name: "Simetria Facial", value: 0, fill: "#f472b6" },
];
