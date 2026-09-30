import React, { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Tier } from "../app/components/dashboard/tierAccess";

interface ActiveSensors {
  rppg: boolean;
  gaze: boolean;
  blink: boolean;
  symmetry: boolean;
  // Camadas do overlay biométrico (feed de parâmetros)
  aus: boolean;
  pose: boolean;
  iris: boolean;
  // Sensores de sala (instalações interativas)
  flow: boolean;
  presence: boolean;
  gesture: boolean;
}

interface SettingsContextType {
  user: any;
  session: any;
  loading: boolean;
  hasPaid: boolean | null;
  tier: Tier | null;
  theme: string;
  accent: string;
  density: string;
  glow: boolean;
  lang: string;
  activeSensors: ActiveSensors;
  setTheme: (val: string) => void;
  setAccent: (val: string) => void;
  setDensity: (val: string) => void;
  setGlow: (val: boolean) => void;
  setLang: (val: string) => void;
  setActiveSensors: (val: ActiveSensors | ((prev: ActiveSensors) => ActiveSensors)) => void;
  logout: () => Promise<void>;
  checkLicense: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hasPaid, setHasPaid] = useState<boolean | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);

  // UI preferences states
  const [theme, setThemeState] = useState(() => localStorage.getItem("sensus-theme") || "dark");
  const [accent, setAccentState] = useState(() => localStorage.getItem("sensus-accent") || "#7b3fe2");
  const [density, setDensityState] = useState(() => localStorage.getItem("sensus-density") || "Confortável");
  const [glow, setGlowState] = useState(() => localStorage.getItem("sensus-setting-glow") !== "false");
  const [lang, setLangState] = useState(() => localStorage.getItem("sensus-lang") || "pt");

  // Ocular and biometric switches
  const [activeSensors, setActiveSensorsState] = useState<ActiveSensors>(() => {
    const defaults: ActiveSensors = {
      rppg: true,
      gaze: true,
      blink: true,
      symmetry: true,
      aus: true,
      pose: true,
      iris: true,
      // Espelham os defaults do engine (active_sensors)
      flow: true,
      presence: true,
      gesture: false,
    };
    const saved = localStorage.getItem("sensus-active-sensors");
    // Merge com defaults: sessões antigas não têm as chaves novas do overlay
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  });

  // Debounced accent color update
  const [debouncedAccent, setDebouncedAccent] = useState(accent);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedAccent(accent);
    }, 500); // 500ms debounce
    return () => clearTimeout(timer);
  }, [accent]);

  // Handle local DOM effects
  useEffect(() => {
    if (theme === "light") {
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark");
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--primary", accent);
  }, [accent]);

  useEffect(() => {
    if (glow) {
      document.documentElement.classList.remove("no-glow");
    } else {
      document.documentElement.classList.add("no-glow");
    }
  }, [glow]);

  useEffect(() => {
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

  // Auth initialization
  useEffect(() => {
    // Sem sessão persistida para ler (ver `persistSession: false` no cliente),
    // isto devolve sempre null ao arrancar. Fica na mesma, porque é também o
    // caminho que põe `loading` a falso e mostra o ecrã de entrada.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) {
        fetchPreferences(session.user.id);
        fetchTier(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session) {
        fetchPreferences(session.user.id);
        fetchTier(session.user.id);
      } else {
        setHasPaid(null);
        setTier(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch preferences and check license
  const fetchPreferences = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("has_paid, theme, accent_color, compact_mode, glow_effect, language, active_sensors")
        .eq("user_id", userId)
        .single();

      if (error || !data) {
        // Line does not exist, block access
        setHasPaid(false);
      } else {
        setHasPaid(!!data.has_paid);
        if (data.has_paid) {
          if (data.theme) setThemeState(data.theme);
          if (data.accent_color) setAccentState(data.accent_color);
          if (data.compact_mode) setDensityState(data.compact_mode);
          if (data.glow_effect !== undefined) setGlowState(!!data.glow_effect);
          if (data.language) setLangState(data.language);
          if (data.active_sensors) {
            setActiveSensorsState(data.active_sensors);
            localStorage.setItem("sensus-active-sensors", JSON.stringify(data.active_sensors));
            // Send to electron
            if (window.electronAPI?.sendRPPGCommand) {
              window.electronAPI.sendRPPGCommand(`SET_ACTIVE_SENSORS ${JSON.stringify(data.active_sensors)}`);
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
      setHasPaid(false);
    } finally {
      setLoading(false);
    }
  };

  const VALID_TIERS: Tier[] = ["personal", "creator", "commercial"];

  const fetchTier = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("plan")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data || !VALID_TIERS.includes(data.plan as Tier)) {
        setTier("personal");
      } else {
        setTier(data.plan as Tier);
      }
    } catch (err) {
      console.error("Tier fetch error:", err);
      setTier("personal");
    }
  };

  const checkLicense = async () => {
    if (user) {
      setLoading(true);
      await fetchPreferences(user.id);
      await fetchTier(user.id);
    }
  };

  // Push updates to Cloud (Supabase)
  const pushPreferences = async (updates: any) => {
    if (!user) return;
    try {
      await supabase.from("user_preferences").upsert({
        user_id: user.id,
        ...updates,
      });
    } catch (err) {
      console.error("Cloud sync error:", err);
    }
  };

  // Sync preferences triggers
  const setTheme = (val: string) => {
    setThemeState(val);
    localStorage.setItem("sensus-theme", val);
    pushPreferences({ theme: val });
  };

  const setAccent = (val: string) => {
    setAccentState(val);
    localStorage.setItem("sensus-accent", val);
  };

  // Push accent with debounce
  useEffect(() => {
    if (user && debouncedAccent) {
      pushPreferences({ accent_color: debouncedAccent });
    }
  }, [debouncedAccent]);

  const setDensity = (val: string) => {
    setDensityState(val);
    localStorage.setItem("sensus-density", val);
    pushPreferences({ compact_mode: val });
  };

  const setGlow = (val: boolean) => {
    setGlowState(val);
    localStorage.setItem("sensus-setting-glow", String(val));
    pushPreferences({ glow_effect: val });
  };

  const setLang = (val: string) => {
    setLangState(val);
    localStorage.setItem("sensus-lang", val);
    pushPreferences({ language: val });
  };

  const setActiveSensors = (val: ActiveSensors | ((prev: ActiveSensors) => ActiveSensors)) => {
    setActiveSensorsState((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      localStorage.setItem("sensus-active-sensors", JSON.stringify(next));
      pushPreferences({ active_sensors: next });
      // Send IPC command to Python
      if (window.electronAPI?.sendRPPGCommand) {
        window.electronAPI.sendRPPGCommand(`SET_ACTIVE_SENSORS ${JSON.stringify(next)}`);
      }
      return next;
    });
  };

  const logout = async () => {
    localStorage.removeItem("sensus_remembered");
    localStorage.removeItem("sensus_remembered_email");
    await supabase.auth.signOut();
    // reset to defaults
    setThemeState("dark");
    setAccentState("#7b3fe2");
    setDensityState("Confortável");
    setGlowState(true);
    setLangState("pt");
    setHasPaid(null);
    setTier(null);
    setUser(null);
    setSession(null);
  };

  return (
    <SettingsContext.Provider
      value={{
        user,
        session,
        loading,
        hasPaid,
        tier,
        theme,
        accent,
        density,
        glow,
        lang,
        activeSensors,
        setTheme,
        setAccent,
        setDensity,
        setGlow,
        setLang,
        setActiveSensors,
        logout,
        checkLicense,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
