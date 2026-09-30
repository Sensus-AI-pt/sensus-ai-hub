import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Activity,
  Bot,
  MessagesSquare,
  BarChart3,
  Cpu,
  Settings,
  ChevronRight,
  Sparkles,
  Leaf,
  Home,
  Lock,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";

import { translations } from "./translations";
import { getTodaySessions } from "./sessions";
import { hasAccess, PAGE_TIER, TIER_LABEL_KEY } from "./tierAccess";
import { useSettings } from "../../../context/SettingsContext";
import appIcon from "../../../imports/sensus-icon-sem-fundo.png";

export function AppSidebar({
  active,
  onNavigate,
  lang = "pt",
}: {
  active: string;
  onNavigate: (id: string) => void;
  lang?: string;
}) {
  const setActive = onNavigate;
  const t = translations[lang] || translations.pt;
  const { tier } = useSettings();
  const { state, setOpen } = useSidebar();
  const collapsed = state === "collapsed";
  const [monitorOpen, setMonitorOpen] = useState(true);

  // Colapsada: clicar num botão expande a barra e ativa/abre esse item
  const handleNav = (id: string) => {
    if (collapsed) setOpen(true);
    setActive(id);
  };

  // "Sessões ativas hoje" — contador diário com reset automático à meia-noite
  const [sessionsCount, setSessionsCount] = useState(() => getTodaySessions());

  useEffect(() => {
    const loadCount = () => setSessionsCount(getTodaySessions());
    loadCount();
    const interval = setInterval(loadCount, 1000);
    return () => clearInterval(interval);
  }, []);

  const monitorSub = [
    { id: "Análise", label: t.analysis },
    { id: "Relatórios", label: t.reports },
    { id: "Gráficos", label: t.graphs },
    { id: "Mapa Emocional", label: t.emoMap },
    { id: "Vídeos", label: t.videos },
  ];

  const mainNav = [
    { id: "assistente", label: t.aiAssistant, icon: Bot },
    { id: "chatbots", label: t.chatbots, icon: MessagesSquare },
    { id: "estatisticas", label: t.statistics, icon: BarChart3 },
    { id: "dispositivos", label: t.devices, icon: Cpu },
    { id: "config", label: t.settings, icon: Settings },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* Colapsada: o padding anima em sincronia com a largura (200ms ease-linear) e o texto
            fica em fluxo (nowrap + fade) — o logo desliza suavemente nos dois sentidos */}
        <button
          type="button"
          onClick={() => handleNav("home")}
          className="flex w-full items-center gap-2 overflow-hidden px-2 py-3 text-left transition-[padding] duration-200 ease-linear group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg overflow-hidden bg-transparent">
            <img src={appIcon} className="size-full object-contain" alt="sensus AI Logo" />
          </div>
          <div className="flex min-w-0 flex-col leading-tight whitespace-nowrap transition-opacity duration-200 group-data-[collapsible=icon]:opacity-0">
            <span className="text-foreground">sensus AI</span>
            <span className="text-xs text-muted-foreground">{t.activeSessions.slice(0, 16)}</span>
          </div>
        </button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t.home}
                isActive={active === "home"}
                onClick={() => handleNav("home")}
                data-tour="nav-home"
                className="data-[active=true]:border-l-2 data-[active=true]:border-primary data-[active=true]:text-primary data-[active=true]:glow-text-primary"
              >
                <Home />
                <span>{t.home}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t.dashboard}
                isActive={active === "dashboard"}
                onClick={() => handleNav("dashboard")}
                data-tour="nav-dashboard"
                className="data-[active=true]:border-l-2 data-[active=true]:border-primary data-[active=true]:text-primary data-[active=true]:glow-text-primary"
              >
                <LayoutDashboard />
                <span>{t.dashboard}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <Collapsible
              open={monitorOpen}
              onOpenChange={(o) => {
                // Colapsada: expandir a barra já com o submenu aberto (nunca fechar)
                if (collapsed) {
                  setOpen(true);
                  setMonitorOpen(true);
                } else {
                  setMonitorOpen(o);
                }
              }}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={t.monitoring} data-tour="nav-monitorizacao">
                    <Activity />
                    <span>{t.monitoring}</span>
                    <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {monitorSub.map((item) => (
                      <SidebarMenuSubItem key={item.id}>
                        <SidebarMenuSubButton
                          isActive={active === item.id}
                          onClick={() => setActive(item.id)}
                        >
                          <span>{item.label}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>

            {mainNav.map((item) => {
              const requiredTier = PAGE_TIER[item.id];
              const locked = !hasAccess(requiredTier, tier);
              return (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    tooltip={item.label}
                    isActive={active === item.id}
                    onClick={() => handleNav(item.id)}
                    data-tour={`nav-${item.id}`}
                    className="data-[active=true]:border-l-2 data-[active=true]:border-primary data-[active=true]:text-primary data-[active=true]:glow-text-primary"
                  >
                    <item.icon />
                    <span>{item.label}</span>
                    {locked && requiredTier && (
                      <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground opacity-70">
                        <Lock className="size-3" />
                        {t[TIER_LABEL_KEY[requiredTier]]}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="rounded-xl border border-border bg-gradient-to-br from-primary/25 to-transparent p-4 group-data-[collapsible=icon]:hidden animate-in fade-in duration-300">
          <div className="mb-2 flex items-center gap-2">
            <Leaf className="mov-respira size-4 text-primary" />
            <span className="text-sm text-foreground font-semibold">Regulação Emocional</span>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">{t.activeSessions}</p>
          <div className="text-foreground" style={{ fontSize: "2.5rem", fontWeight: 700, lineHeight: 1 }}>
            {sessionsCount}
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
