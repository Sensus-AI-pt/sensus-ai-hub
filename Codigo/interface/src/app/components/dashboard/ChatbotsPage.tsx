import { useState } from "react";
import { Bot, Send, Plus, MessageSquare, Sparkles, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { Switch } from "../ui/switch";
import { PageHeader } from "./PageHeader";
import { chatbots, chatMessages } from "./data";
import { translations } from "./translations";

export function ChatbotsPage({ lang = "pt", searchQuery = "" }: { lang?: string; searchQuery?: string }) {
  const t = translations[lang] || translations.pt;
  const [bots, setBots] = useState(chatbots);
  // Anotado à mão: os dados iniciais só têm mensagens do bot, e sem isto o
  // TypeScript inferia `from: "bot"` como literal e rejeitava as do utilizador.
  const [messages, setMessages] = useState<{ id: string; from: "bot" | "user"; text: string }[]>(chatMessages);
  const [draft, setDraft] = useState("");

  const toggle = (id: string) =>
    setBots((prev) =>
      prev.map((b) =>
        b.id === id
          ? { ...b, estado: b.estado === "Ativo" ? "Inativo" : "Ativo" }
          : b,
      ),
    );

  const handleCreateChatbot = () => {
    const names = [
      "Assistente Emocional",
      "Analista de Telemetria",
      "Monitor de Foco",
      "Controlador de Calibração",
      "Mediador de Sessões",
    ];
    const descs = [
      "Especializado em classificar e mediar estados de ansiedade.",
      "Responsável por emitir relatórios rápidos de sinais vitais rPPG.",
      "Otimiza o estímulo de atenção e concentração em salas de aula.",
      "Ajusta parâmetros de denoising, steps e prompts do ambiente virtual.",
      "Orquestra os ciclos de estímulos nos jardins sensoriais coletivos.",
    ];
    const randomIndex = Math.floor(Math.random() * names.length);
    const newBot = {
      id: `bot-${Date.now()}`,
      nome: `${names[randomIndex]} #${bots.length + 1}`,
      descricao: descs[randomIndex],
      estado: "Ativo" as const,
      conversas: 0,
      precisao: 85 + Math.floor(Math.random() * 15),
    };
    setBots((prev) => [...prev, newBot]);
  };

  const handleSend = () => {
    if (!draft.trim()) return;
    const userMsg = {
      id: `u-${Date.now()}`,
      from: "user" as const,
      text: draft,
    };
    setMessages((prev) => [...prev, userMsg]);
    setDraft("");

    setTimeout(() => {
      const responses = [
        "A telemetria atual da sala indica que os batimentos cardíacos estão estáveis no intervalo ideal (65-75 BPM). O nível de foco médio é de 0.48.",
        "Calibração rPPG concluída com sucesso. A iluminação ambiente está em conformidade com as diretrizes do Jardim Sensorial.",
        "Detetei um ligeiro aumento no estímulo arousal (0.54) no canal Redmi. Recomendo ajustar as luzes de ambientação para tons violetas mais suaves.",
        "O monitoramento de fadiga está ativo. A atividade coletiva dos utilizadores revela um padrão de relaxamento profundo e interação social activa.",
      ];
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      setMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          from: "bot" as const,
          text: randomResponse,
        },
      ]);
    }, 1000);
  };

  const handleDeleteBot = (id: string) => {
    const confirmMsg = lang === "en" ? "Are you sure you want to delete this chatbot?" :
                       lang === "es" ? "¿Está seguro de que desea eliminar este chatbot?" :
                       lang === "fr" ? "Êtes-vous sûr de vouloir supprimer ce chatbot ?" :
                       "Tem a certeza de que deseja eliminar este chatbot?";
    if (confirm(confirmMsg)) {
      setBots((prev) => prev.filter((b) => b.id !== id));
    }
  };

  return (
    <div className="relative z-10 flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title={t.chatbots}
          subtitle={
            lang === "en" ? "Manage the platform's AI assistants" :
            lang === "es" ? "Administre los asistentes de IA de la plataforma" :
            lang === "fr" ? "Gérer les assistants d'IA de la plateforme" :
            "Gerencie os assistentes de IA da plataforma"
          }
        />
        <Button onClick={handleCreateChatbot} className="gap-2 bg-primary text-primary-foreground glow-primary hover:bg-primary/90">
          <Plus className="size-4" />
          {lang === "en" ? "New Chatbot" : lang === "es" ? "Nuevo Chatbot" : lang === "fr" ? "Nouveau Chatbot" : "Novo Chatbot"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Bot list */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {bots.filter(bot => 
              bot.nome.toLowerCase().includes(searchQuery.toLowerCase()) ||
              bot.descricao.toLowerCase().includes(searchQuery.toLowerCase())
            ).map((bot) => (
              <Card key={bot.id} className="border-border bg-card panel-shadow">
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary glow-text-primary">
                      <Bot className="size-5" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleDeleteBot(bot.id)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors"
                        title={t.delete}
                      >
                        <Trash2 className="size-4" />
                      </button>
                      <Switch
                        checked={bot.estado === "Ativo"}
                        onCheckedChange={() => toggle(bot.id)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="text-foreground">{bot.nome}</span>
                    <span className="text-xs text-muted-foreground">{bot.descricao}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={
                        bot.estado === "Ativo"
                          ? "border-positive/30 bg-positive/10 text-positive"
                          : "border-border bg-secondary text-muted-foreground"
                      }
                    >
                      {bot.estado}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {bot.conversas.toLocaleString("pt-PT")}{" "}
                      {lang === "en" ? "conversations" : lang === "es" ? "conversaciones" : lang === "fr" ? "conversations" : "conversas"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-3">
                    <span className="text-xs text-muted-foreground">
                      {lang === "en" ? "Accuracy" : lang === "es" ? "Precisión" : lang === "fr" ? "Précision" : "Precisão"}
                    </span>
                    <span className="text-sm text-cyan glow-text-cyan">{bot.precisao}%</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Chat preview */}
        <Card className="flex flex-col border-border bg-card panel-shadow self-start">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Sparkles className="size-4" />
            </div>
            <CardTitle className="text-foreground">
              {lang === "pt" ? "Assistente Sensorial" : lang === "en" ? "Sensory Assistant" : lang === "es" ? "Asistente Sensorial" : "Assistant Sensoriel"}
            </CardTitle>
            <Badge className="ml-auto border-positive/30 bg-positive/10 text-positive">
              Online
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto max-h-[350px] pr-1">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    m.from === "bot"
                      ? "self-start bg-secondary text-foreground"
                      : "self-end bg-primary text-primary-foreground glow-primary"
                  }`}
                >
                  {m.text}
                </div>
              ))}
            </div>
            <div className="relative mt-2">
              <MessageSquare className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder={
                  lang === "en" ? "Type your message..." :
                  lang === "es" ? "Escribe tu mensaje..." :
                  lang === "fr" ? "Écrivez votre message..." :
                  "Escreva uma mensagem..."
                }
                className="border-border bg-secondary pl-9 pr-10"
              />
              <button
                type="button"
                onClick={handleSend}
                className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/95 transition-colors"
              >
                <Send className="size-3.5" />
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
