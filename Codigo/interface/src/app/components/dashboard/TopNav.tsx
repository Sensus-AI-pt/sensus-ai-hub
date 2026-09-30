import { useState, useRef, useEffect } from "react";
import { Bell, Search, User, LogOut, X, Sparkles } from "lucide-react";
import { SidebarTrigger } from "../ui/sidebar";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Avatar, AvatarFallback } from "../ui/avatar";

import { translations } from "./translations";

export function TopNav({
  latestData,
  onLogout,
  envStarted,
  lang = "pt",
  searchQuery = "",
  onSearchChange = () => {},
  onNavigate = () => {},
}: {
  latestData?: any;
  onLogout?: () => void;
  envStarted?: boolean;
  lang?: string;
  searchQuery?: string;
  onSearchChange?: (val: string) => void;
  onNavigate?: (target: string) => void;
}) {
  // Alvos de navegação direta pesquisáveis (inclui páginas de definições)
  const NAV_TARGETS = [
    { key: "dashboard", label: "Painel Principal" },
    { key: "Análise", label: "Monitorização · Análise" },
    { key: "Gráficos", label: "Monitorização · Gráficos" },
    { key: "Mapa Emocional", label: "Monitorização · Mapa Emocional" },
    { key: "Vídeos", label: "Monitorização · Vídeos" },
    { key: "estatisticas", label: "Estatísticas" },
    { key: "dispositivos", label: "Dispositivos" },
    { key: "assistente", label: "Geração de Imagem" },
    { key: "chatbots", label: "Chatbots" },
    { key: "config", label: "Definições" },
  ];
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const navMatches = searchQuery.trim().length > 0
    ? NAV_TARGETS.filter((n) => n.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];
  const [showNotifications, setShowNotifications] = useState(false);
  const [now, setNow] = useState(new Date());
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [projectionOpen, setProjectionOpen] = useState(true);
  const t = translations[lang] || translations.pt;

  const [liveNotifs, setLiveNotifs] = useState<any[]>([]);

  // Relógio digital do sistema atualizado ao segundo
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadLiveNotifs = () => {
      const raw = localStorage.getItem("sensus-live-notifications") || "[]";
      try {
        setLiveNotifs(JSON.parse(raw));
      } catch (e) {
        setLiveNotifs([]);
      }
    };
    loadLiveNotifs();
    const interval = setInterval(loadLiveNotifs, 1000);
    return () => clearInterval(interval);
  }, []);

  // Apenas eventos estruturais de ciclo de vida do sistema. Telemetria contínua,
  // mudanças sensoriais, acentos de cor e micro-alterações biométricas/musicais
  // estão terminantemente proibidas neste feed.
  const [notifications, setNotifications] = useState([
    {
      id: 3,
      title: "Sincronização de Dispositivos",
      titleColor: "text-cyan",
      time: "há 15 min",
      text: "Dispositivos biométricos sincronizados com sucesso.",
    },
  ]);

  // User Profile State (persisted in localStorage)
  const [userName, setUserName] = useState(() => localStorage.getItem("sensus_user_name") || "Utilizador");
  const [userRole, setUserRole] = useState(() => localStorage.getItem("sensus_user_role") || "Utilizador");
  const [userPhoto, setUserPhoto] = useState(() => localStorage.getItem("sensus_user_photo") || "");
  const [userInitials, setUserInitials] = useState(() => {
    const name = localStorage.getItem("sensus_user_name") || "Utilizador";
    const parts = name.split(" ");
    return parts.map(p => p[0]).join("").substring(0, 2).toUpperCase() || "JC";
  });

  // Input states for modal
  const [editName, setEditName] = useState(userName);
  const [editRole, setEditRole] = useState(userRole);
  const [editPhoto, setEditPhoto] = useState(userPhoto);

  const notificationsRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  // Keep modal edit states in sync when modal opens
  useEffect(() => {
    if (showProfileModal) {
      setEditName(userName);
      setEditRole(userRole);
      setEditPhoto(userPhoto);
    }
  }, [showProfileModal, userName, userRole, userPhoto]);

  // Close menus on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        notificationsRef.current &&
        !notificationsRef.current.contains(event.target as Node)
      ) {
        setShowNotifications(false);
      }
      if (
        profileRef.current &&
        !profileRef.current.contains(event.target as Node)
      ) {
        setShowProfileMenu(false);
      }
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target as Node)
      ) {
        setShowSearchSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (window.electronAPI?.onProjectionClosed) {
      window.electronAPI.onProjectionClosed(() => {
        setProjectionOpen(false);
      });
    }
  }, []);

  useEffect(() => {
    if (envStarted) {
      setProjectionOpen(true);
    }
  }, [envStarted]);

  const handleSaveProfile = () => {
    setUserName(editName);
    setUserRole(editRole);
    setUserPhoto(editPhoto);
    localStorage.setItem("sensus_user_name", editName);
    localStorage.setItem("sensus_user_role", editRole);
    localStorage.setItem("sensus_user_photo", editPhoto);
    const parts = editName.split(" ");
    const initials = parts.map(p => p ? p[0] : "").join("").substring(0, 2).toUpperCase();
    setUserInitials(initials || "U");
    setShowProfileModal(false);
  };

  return (
    <>
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md md:px-6">
        <SidebarTrigger className="text-muted-foreground" />

        <h2 className="text-foreground">{t.dashboard}</h2>

        {/* Pulsing violet button 'Reabrir Projeção' next to the search bar */}
        {envStarted && !projectionOpen && (
          <Button
            size="sm"
            onClick={() => {
              window.electronAPI?.openProjection();
              setProjectionOpen(true);
            }}
            className="mov-toque bg-violet-600 hover:bg-violet-700 text-white rounded-full text-xs font-semibold px-3 py-1.5 shadow-[0_0_12px_rgba(124,58,237,0.7)] border border-violet-400/30 flex items-center gap-1.5"
          >
            <span className="mov-respira size-1.5 rounded-full bg-white" />
            {t.reopen}
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2 md:gap-3">
          {/* Relógio digital do sistema (atualizado ao segundo) */}
          <div className="hidden lg:flex flex-col items-end leading-none tabular-nums select-none pr-1">
            <span className="text-sm font-semibold text-foreground tracking-wide">
              {now.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span className="text-[10px] text-muted-foreground capitalize">
              {now.toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "short" })}
            </span>
          </div>

          <div className="relative hidden md:block" ref={searchRef}>
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={() => setShowSearchSuggestions(true)}
              placeholder={t.search}
              className="w-48 rounded-full border-border bg-secondary/60 pl-9"
            />
            {showSearchSuggestions && navMatches.length > 0 && (
              <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-border bg-[#0a0d1d] p-1.5 shadow-2xl z-50 flex flex-col gap-1 panel-shadow animate-in fade-in slide-in-from-top-2 duration-150">
                <span className="px-2 py-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Ir para
                </span>
                {navMatches.map((n) => (
                  <button
                    key={n.key}
                    type="button"
                    onClick={() => {
                      onNavigate(n.key);
                      setShowSearchSuggestions(false);
                      onSearchChange("");
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-secondary transition-colors"
                  >
                    <Search className="size-3.5 text-muted-foreground" />
                    <span>{n.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 🔔 Notifications Button */}
          <div className="relative" ref={notificationsRef}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowNotifications(!showNotifications)}
              className={`relative text-muted-foreground hover:bg-secondary/60 ${
                showNotifications ? "bg-secondary/60 text-primary" : ""
              }`}
            >
              <Bell className="size-5" />
              {(notifications.length > 0 || liveNotifs.length > 0) && (
                <span className="absolute right-2 top-2 size-2 rounded-full bg-primary" />
              )}
            </Button>

            {/* 🔔 Notifications Dropdown */}
            {showNotifications && (
              <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-border bg-[#0a0d1d] p-3 shadow-2xl z-50 flex flex-col gap-2 panel-shadow animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex items-center justify-between border-b border-border pb-2 px-1">
                  <span className="text-xs font-semibold text-foreground uppercase tracking-widest">
                    Notificações
                  </span>
                  <span
                    onClick={() => {
                      setNotifications([]);
                      setLiveNotifs([]);
                      localStorage.removeItem("sensus-live-notifications");
                    }}
                    className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    Limpar todas
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto pr-1">
                  {(notifications.length === 0 && liveNotifs.length === 0) ? (
                    <span className="text-xs text-muted-foreground text-center py-4">Sem notificações</span>
                  ) : (
                    [...liveNotifs, ...notifications].map((n) => {
                      const displayText = n.text;
                      return (
                        <div key={n.id} className="group relative flex flex-col gap-1 rounded-lg bg-secondary/40 p-2.5 border border-border/40 hover:bg-secondary/60 transition-colors">
                          <div className="flex items-center justify-between pr-5">
                            <span className={`text-xs font-bold ${n.titleColor}`}>{n.title}</span>
                            <span className="text-[9px] text-muted-foreground">{n.time}</span>
                          </div>
                          <span className="text-xs text-foreground/90 leading-normal">
                            {displayText}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              // Check if it's static or live
                              setNotifications(prev => prev.filter(item => item.id !== n.id));
                              const raw = localStorage.getItem("sensus-live-notifications") || "[]";
                              try {
                                const parsed = JSON.parse(raw);
                                const filtered = parsed.filter((item: any) => item.id !== n.id);
                                localStorage.setItem("sensus-live-notifications", JSON.stringify(filtered));
                                setLiveNotifs(filtered);
                              } catch (err) {}
                            }}
                            className="absolute right-2 top-2 text-muted-foreground hover:text-red-400 transition-colors opacity-70 group-hover:opacity-100"
                            title="Apagar"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="border-t border-border pt-2 mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNotifications(false);
                      setShowHistoryModal(true);
                    }}
                    className="w-full text-center text-xs font-semibold text-primary hover:text-primary/80 transition-colors py-1"
                  >
                    {lang === "en" ? "History" : lang === "es" ? "Historial" : lang === "fr" ? "Historique" : "Histórico"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 👤 User Profile Avatar Button */}
          <div className="relative" ref={profileRef}>
            <button
              type="button"
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className={`flex items-center gap-2.5 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-secondary/60 ${
                showProfileMenu ? "bg-secondary/60" : ""
              }`}
            >
              <div className="relative">
                <Avatar className="size-8">
                  {userPhoto ? (
                    <img src={userPhoto} className="size-full object-cover rounded-full" alt="Profile" />
                  ) : (
                    <AvatarFallback className="bg-primary/30 text-foreground text-xs font-semibold">
                      {userInitials}
                    </AvatarFallback>
                  )}
                </Avatar>
                <span
                  className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-positive"
                  style={{ boxShadow: "0 0 8px var(--positive)" }}
                />
              </div>
              <div className="hidden flex-col items-start leading-tight sm:flex">
                <span className="text-sm font-medium text-foreground">{userName}</span>
                <span className="text-xs text-muted-foreground">{userRole === "Utilizador" ? t.role : userRole}</span>
              </div>
            </button>

            {/* 👤 Profile Dropdown */}
            {showProfileMenu && (
              <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-border bg-[#0a0d1d] p-1.5 shadow-2xl z-50 flex flex-col gap-1 panel-shadow animate-in fade-in slide-in-from-top-2 duration-200">
                <button
                  type="button"
                  onClick={() => {
                    setShowProfileMenu(false);
                    setShowProfileModal(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-secondary transition-colors"
                >
                  <User className="size-4 text-muted-foreground" />
                  <span>{lang === "en" ? "Manage Profile" : lang === "es" ? "Gestionar Perfil" : lang === "fr" ? "Gérer le profil" : "Gerir Perfil"}</span>
                </button>
                <div className="h-px bg-border my-1" />
                <button
                  type="button"
                  onClick={onLogout}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut className="size-4" />
                  <span>{lang === "en" ? "Logout" : lang === "es" ? "Salir" : lang === "fr" ? "Se déconnecter" : "Sair"}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ⚙️ Manage Profile Modal (Fixed and outside of header) */}
      {showProfileModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
          <div style={{ position: 'relative', width: '24rem', borderRadius: '1rem', border: '1px solid rgba(255,255,255,0.08)', background: '#0a0d1d', padding: '1.5rem', boxShadow: '0 25px 60px rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <button
              type="button"
              onClick={() => setShowProfileModal(false)}
              className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-5" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary glow-text-primary">
                <Sparkles className="size-4" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-semibold text-foreground">Gerir Perfil</span>
                <span className="text-xs text-muted-foreground">Atualize os seus dados de conta</span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {/* Foto de Perfil Picker */}
              <div className="flex flex-col items-center gap-2 py-1 border-b border-border/40 pb-3 mb-1">
                <div className="relative group size-20 rounded-full border-2 border-primary/40 bg-primary/10 overflow-hidden flex items-center justify-center shadow-lg">
                  {editPhoto ? (
                    <img src={editPhoto} className="size-full object-cover" alt="Profile Edit" />
                  ) : (
                    <span className="text-xl font-bold text-foreground">{(editName || "").split(" ").map(p => p ? p[0] : "").join("").substring(0, 2).toUpperCase() || "JC"}</span>
                  )}
                  <label 
                    htmlFor="profile-photo-upload" 
                    className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white font-semibold cursor-pointer transition-opacity"
                  >
                    Alterar
                  </label>
                  <input 
                    type="file" 
                    id="profile-photo-upload" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setEditPhoto(reader.result as string);
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </div>
                {editPhoto && (
                  <button
                    type="button"
                    onClick={() => setEditPhoto("")}
                    className="text-[9px] text-red-400 hover:text-red-300 transition-colors uppercase font-bold tracking-wider"
                  >
                    Remover Foto
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Nome Completo
                </label>
                <Input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="bg-secondary/40 border-border text-xs rounded-xl"
                  placeholder="Nome do Utilizador"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Cargo / Categoria
                </label>
                <Input
                  type="text"
                  value={editRole}
                  onChange={e => setEditRole(e.target.value)}
                  className="bg-secondary/40 border-border text-xs rounded-xl"
                  placeholder="Ex: Terapeuta"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="ghost"
                onClick={() => setShowProfileModal(false)}
                className="text-xs rounded-xl border border-border hover:bg-secondary/60 text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSaveProfile}
                className="text-xs rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 glow-primary"
              >
                Guardar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 📜 History Modal (Fixed and outside of header) */}
      {showHistoryModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
          <div style={{ position: 'relative', width: '24rem', borderRadius: '1rem', border: '1px solid rgba(255,255,255,0.08)', background: '#0a0d1d', padding: '1.5rem', boxShadow: '0 25px 60px rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <button
              type="button"
              onClick={() => setShowHistoryModal(false)}
              className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-5" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary glow-text-primary">
                <Bell className="size-4" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-semibold text-foreground">Histórico de Notificações</span>
                <span className="text-xs text-muted-foreground">Registo de alertas arquivados</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
              <div className="flex flex-col gap-1 rounded-lg bg-secondary/40 p-2.5 border border-border/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground">Inicialização do Sistema</span>
                  <span className="text-[9px] text-muted-foreground">há 1 hora</span>
                </div>
                <span className="text-xs text-foreground/85">O core de processamento e rPPG foi iniciado com sucesso.</span>
              </div>
              <div className="flex flex-col gap-1 rounded-lg bg-secondary/40 p-2.5 border border-border/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground">Dispositivo Desconectado</span>
                  <span className="text-[9px] text-muted-foreground">há 2 horas</span>
                </div>
                <span className="text-xs text-foreground/85">Câmara secundária USB desconectada do barramento.</span>
              </div>
              <div className="flex flex-col gap-1 rounded-lg bg-secondary/40 p-2.5 border border-border/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground">Conexão Estabelecida</span>
                  <span className="text-[9px] text-muted-foreground">há 3 horas</span>
                </div>
                <span className="text-xs text-foreground/85">Interface websocket de TouchDesigner conectada com sucesso.</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                onClick={() => setShowHistoryModal(false)}
                className="text-xs rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 glow-primary"
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
