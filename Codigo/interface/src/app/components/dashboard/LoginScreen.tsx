import { useState } from "react";
import {
  Globe,
  User,
  Lock,
  Eye,
  EyeOff,
  LogIn,
  ChevronDown,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import loginBg from "../../../imports/ChatGPT_Image_13_07_2026__16_21_33.png";
import { translations } from "./translations";
import { supabase } from "@/lib/supabaseClient";

// Vidro estilo Apple: blur alto + saturação, gradiente de luz subtil e realce
// interior de 1px no topo — funde o painel com o fundo sem o tornar chamativo.
const glassPanelStyle: React.CSSProperties = {
  background:
    "linear-gradient(135deg, rgba(255,255,255,0.09), rgba(255,255,255,0.035) 45%, rgba(123,63,226,0.05))",
  backdropFilter: "blur(28px) saturate(150%)",
  WebkitBackdropFilter: "blur(28px) saturate(150%)",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.16), inset 0 0 0 0.5px rgba(255,255,255,0.04), 0 24px 70px -30px rgba(0,0,0,0.7), 0 0 60px -20px rgba(123,63,226,0.35)",
};

export function LoginScreen({
  onLogin,
  lang = "pt",
  onLangChange,
}: {
  onLogin: () => void;
  lang?: string;
  onLangChange?: (val: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  // "Lembrar acesso neste dispositivo": guarda o email para o pré-preencher e
  // mostra o cartão da sessão guardada. NÃO mantém a sessão aberta entre
  // arranques — o token nunca sai da memória da janela (ver `supabaseClient`),
  // e cada vez que a aplicação abre volta a pedir credenciais.
  const [rememberMe, setRememberMe] = useState(false);
  const [remembered, setRemembered] = useState(() => localStorage.getItem("sensus_remembered") === "true");
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [signupSuccessMessage, setSignupSuccessMessage] = useState("");
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);

  const t = translations[lang] || translations.pt;

  const rememberedName = localStorage.getItem("sensus_user_name") || "Utilizador";
  const rememberedRole = localStorage.getItem("sensus_user_role") || "Utilizador";
  const rememberedPhoto = localStorage.getItem("sensus_user_photo") || "";
  const rememberedEmail = localStorage.getItem("sensus_remembered_email") || "";

  const validate = () => {
    const next: { email?: string; password?: string } = {};
    const value = email.trim();

    if (!value) {
      next.email = t.emailRequired;
    } else if (!value.includes("@") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      next.email = t.emailInvalid;
    }
    if (!password) {
      next.password = t.passwordRequired;
    } else if (password.length < 6) {
      next.password = t.passwordTooShort;
    }
    return next;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length === 0) {
      setIsLoading(true);
      setLoginError("");
      setSignupSuccessMessage("");
      try {
        const trimmedEmail = email.trim();
        if (isSignUp) {
          const { error } = await supabase.auth.signUp({
            email: trimmedEmail,
            password,
          });
          if (error) {
            setLoginError(error.message);
            setIsLoading(false);
            return;
          }
          setSignupSuccessMessage(t.signupSuccess || "Conta criada com sucesso! Verifique o seu email.");
          setIsSignUp(false);
          setIsLoading(false);
        } else {
          const { error } = await supabase.auth.signInWithPassword({
            email: trimmedEmail,
            password,
          });
          if (error) {
            // Mensagem única. Antes perguntava-se ao `email_exists` se a conta
            // existia, para distinguir "não existe" de "palavra-passe errada" —
            // o que dizia a qualquer pessoa quais os emails registados. A RPC
            // foi fechada ao papel `anon` do lado da base de dados.
            setLoginError(t.invalidCredentials);
            setIsLoading(false);
            return;
          }
          if (rememberMe) {
            localStorage.setItem("sensus_remembered", "true");
            localStorage.setItem("sensus_remembered_email", trimmedEmail);
            localStorage.setItem("sensus_user_name", trimmedEmail.split("@")[0]);
            localStorage.setItem("sensus_user_role", "Utilizador");
          } else {
            localStorage.removeItem("sensus_remembered");
            localStorage.removeItem("sensus_remembered_email");
          }
          onLogin();
        }
      } catch (err: any) {
        setLoginError(err.message || "Erro desconhecido");
        setIsLoading(false);
      }
    }
  };

  /**
   * O cartão da sessão guardada diz quem usou a aplicação por último e
   * pré-preenche o email — a palavra-passe continua a ser pedida.
   */
  const handleAccessSavedSession = () => {
    setEmail(rememberedEmail);
    localStorage.removeItem("sensus_remembered");
    setRemembered(false);
  };

  return (
    <div className="dark relative flex min-h-svh overflow-hidden bg-background text-white">
      {/* Full-bleed background image + identity gradient (spans both columns) */}
      <div className="mov-hero absolute inset-0 z-0">
        <img
          src={loginBg}
          alt=""
          aria-hidden
          className="size-full object-cover"
        />
        {/* Fade the image into the identity background towards the right (form side) */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-background/70 to-background" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background/70" />
      </div>
      {/* Ambient identity glow behind the form */}
      <div className="pointer-events-none absolute right-0 top-1/2 z-0 size-[32rem] -translate-y-1/2 translate-x-1/4 rounded-full bg-primary/15 blur-[140px]" />

      {/* Left Column - Branding */}
      <div className="relative z-10 hidden w-1/2 flex-col justify-between p-12 lg:flex">
        {/* Content Overlay - logo on the darker right side */}
        <div
          className="mov-hero-fade flex flex-1 flex-col items-end justify-center pr-4 text-right"
          style={{ ["--mov-atraso" as string]: "var(--mov-rapido)" }}
        >
          <div className="flex items-baseline space-x-2">
            <span className="text-6xl font-medium tracking-tight">sensus</span>
            <span className="bg-gradient-to-r from-primary to-[#a78bfa] bg-clip-text text-6xl font-medium text-transparent">
              AI
            </span>
          </div>
        </div>
      </div>

      {/* Right Column - Login Form */}
      <div
        className="mov-hero-fade relative z-10 flex w-full flex-col justify-center px-6 py-10 sm:px-16 lg:w-1/2 lg:px-24"
        style={{
          ["--mov-atraso" as string]: "var(--mov-normal)",
          ["--mov-duracao" as string]: "var(--mov-medio)",
        }}
      >
        {/* Custom Language Selector Dropdown */}
        <div className="absolute right-8 top-8 z-30">
          <button
            type="button"
            onClick={() => setLangDropdownOpen(!langDropdownOpen)}
            className="flex items-center space-x-2 text-xs text-gray-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 px-3 py-2 rounded-xl transition-all duration-300 backdrop-blur-md shadow-lg outline-none cursor-pointer font-semibold uppercase"
          >
            <Globe size={14} className="text-primary glow-text-primary" />
            <span>{lang}</span>
            <ChevronDown size={12} className={`text-gray-500 transition-transform duration-300 ${langDropdownOpen ? "rotate-180" : ""}`} />
          </button>

          {langDropdownOpen && (
            <>
              {/* Overlay transparent click-away */}
              <div 
                className="fixed inset-0 z-10" 
                onClick={() => setLangDropdownOpen(false)} 
              />
              <div className="mov-entra absolute right-0 mt-2 w-28 rounded-xl border border-white/10 bg-[#070a18]/95 p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl z-20">
                {(["pt", "en", "es", "fr"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => {
                      onLangChange && onLangChange(l);
                      setLangDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer uppercase font-medium flex items-center justify-between ${
                      lang === l 
                        ? "bg-primary text-white font-semibold" 
                        : "text-gray-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span>{l}</span>
                    {lang === l && <span className="size-1.5 rounded-full bg-white" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Glass panel that blends into the identity background */}
        {remembered ? (
          <div className="mx-auto w-full max-w-md rounded-3xl border border-white/[0.14] p-8 sm:p-10 flex flex-col items-center gap-6" style={glassPanelStyle}>
            <div className="text-center">
              <p className="mb-2 text-sm text-primary glow-text-primary">{t.savedSession}</p>
              <h2 className="text-2xl font-medium">{t.reenter}</h2>
            </div>
             {/* Profile Card */}
            <div 
              onClick={handleAccessSavedSession}
              className="w-full flex flex-col items-center gap-3 p-5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-primary/40 cursor-pointer transition-all duration-300 group hover:shadow-[0_0_20px_rgba(123,63,226,0.2)] animate-in fade-in zoom-in-95 duration-300"
            >
              <div className="relative size-16 rounded-full border border-primary/40 bg-primary/10 overflow-hidden flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform duration-300">
                {rememberedPhoto ? (
                  <img src={rememberedPhoto} className="size-full object-cover" alt="Profile" />
                ) : (
                  <span className="text-xl font-bold text-foreground">
                    {(rememberedName || "").split(" ").map(p => p ? p[0] : "").join("").substring(0, 2).toUpperCase() || "JC"}
                  </span>
                )}
              </div>
              
              <div className="flex flex-col items-center leading-tight text-center">
                <span className="text-base font-semibold text-white group-hover:text-primary transition-colors">{rememberedName}</span>
                <span className="text-xs text-gray-400 mt-0.5">{rememberedRole}</span>
                <span className="text-[10px] text-gray-500 font-mono mt-0.5">{rememberedEmail}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleAccessSavedSession}
              className="flex w-full items-center justify-center space-x-2 rounded-xl bg-primary py-3 font-medium text-white glow-primary transition-all hover:bg-primary/90"
            >
              <span>{t.accessConsole}</span>
              <ArrowRight size={18} />
            </button>

            <button
              type="button"
              onClick={() => {
                localStorage.removeItem("sensus_remembered");
                setRemembered(false);
              }}
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              {t.otherAccount}
            </button>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-md rounded-3xl border border-white/[0.14] p-8 sm:p-10" style={glassPanelStyle}>
            <div className="mb-10">
              <p className="mb-2 text-sm text-primary glow-text-primary">
                {isSignUp ? t.createAccount : t.welcomeBack}
              </p>
              <h2 className="text-3xl font-medium">
                {isSignUp ? (
                  <span>{t.signupPrompt}</span>
                ) : (
                  <>
                    {t.loginPrompt.split(" ").slice(0, 3).join(" ")}
                    <br />
                    {t.loginPrompt.split(" ").slice(3).join(" ")}
                  </>
                )}
              </h2>
            </div>

            <form onSubmit={handleLogin} noValidate className="flex flex-col gap-5">
              {signupSuccessMessage && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300 backdrop-blur-md">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{signupSuccessMessage}</span>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-gray-400">
                  {isSignUp ? t.emailLabel : `${t.emailLabel} / ID`}
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-gray-500">
                    <User size={18} />
                  </div>
                  <input
                    type="text"
                    placeholder="seu@email.com"
                    aria-invalid={!!errors.email}
                    className={`w-full rounded-xl border bg-white/5 py-3 pl-11 pr-4 text-white placeholder-gray-600 transition-all focus:bg-white/10 focus:outline-none ${
                      errors.email
                        ? "border-rose-400/60 focus:border-rose-400"
                        : "border-white/10 focus:border-primary/50"
                    }`}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
                    }}
                  />
                </div>
                {errors.email && <FieldError message={errors.email} />}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-gray-400">
                  {t.passwordLabel}
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-gray-500">
                    <Lock size={18} />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="********"
                    aria-invalid={!!errors.password}
                    className={`w-full rounded-xl border bg-white/5 py-3 pl-11 pr-11 tracking-widest text-white placeholder-gray-600 transition-all focus:bg-white/10 focus:outline-none ${
                      errors.password
                        ? "border-rose-400/60 focus:border-rose-400"
                        : "border-white/10 focus:border-primary/50"
                    }`}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute inset-y-0 right-0 flex cursor-pointer items-center pr-4 text-gray-500 hover:text-gray-300"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.password && <FieldError message={errors.password} />}
              </div>

              {!isSignUp && (
                <div className="flex items-center justify-between mt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-400 select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded border-white/10 bg-white/5 text-primary focus:ring-0 focus:ring-offset-0 size-4 cursor-pointer"
                    />
                    {t.rememberMe}
                  </label>
                  <a href="#" className="text-xs text-primary transition-colors hover:text-primary/80">
                    {t.forgotPassword}
                  </a>
                </div>
              )}

              {loginError && <FieldError message={loginError} />}

              <button
                type="submit"
                disabled={isLoading}
                className="flex w-full items-center justify-center space-x-2 rounded-xl border border-white/25 py-3.5 font-medium text-white transition-all mt-2 disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110"
                style={{
                  background: "linear-gradient(135deg, rgba(123,63,226,0.85), rgba(123,63,226,0.65) 60%, rgba(167,139,250,0.55))",
                  backdropFilter: "blur(18px) saturate(160%)",
                  WebkitBackdropFilter: "blur(18px) saturate(160%)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.15), 0 10px 32px -10px rgba(123,63,226,0.65)",
                }}
              >
                {isLoading ? (
                  <div className="size-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>{isSignUp ? t.signUpButton : t.loginButton}</span>
                    <ArrowRight size={20} />
                  </>
                )}
              </button>
            </form>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => {
                setIsSignUp(!isSignUp);
                setLoginError("");
                setSignupSuccessMessage("");
              }}
              className="mt-4 text-xs text-primary hover:text-primary/80 transition-colors text-center w-full block font-medium"
            >
              {isSignUp ? t.backToLogin : t.noAccount}
            </button>

            <div className="my-6 flex items-center">
              <div className="flex-1 border-t border-white/10" />
              <span className="px-4 text-xs uppercase tracking-widest text-gray-500">{t.orLabel}</span>
              <div className="flex-1 border-t border-white/10" />
            </div>

            <button
              type="button"
              disabled={isLoading}
              onClick={onLogin}
              className="flex w-full items-center justify-center space-x-3 rounded-xl border border-white/10 bg-transparent py-3.5 font-medium text-white transition-all hover:bg-white/5 disabled:opacity-50"
            >
              <LogIn size={18} className="text-gray-400" />
              <span>{t.ssoButton}</span>
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="absolute inset-x-8 bottom-8 flex items-center justify-between text-xs text-gray-500">
          <p>© 2025 Sensus AI. Todos os direitos reservados.</p>
          <div className="flex space-x-4">
            <a href="#" className="transition-colors hover:text-gray-300">
              Privacidade
            </a>
            <span>•</span>
            <a href="#" className="transition-colors hover:text-gray-300">
              Termos de Utilização
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-300 backdrop-blur-md">
      <AlertCircle size={14} className="shrink-0" />
      <span>{message}</span>
    </div>
  );
}
