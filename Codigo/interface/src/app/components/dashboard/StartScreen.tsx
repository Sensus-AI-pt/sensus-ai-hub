import { useMemo, useState } from "react";
import { ArrowRight, Camera } from "lucide-react";
import { loadExhibitions } from "../../../exhibitions/loadExhibitions";
import { environmentImage } from "../../../exhibitions/environmentImages";
import { environmentSummary } from "../../../exhibitions/environmentSummary";
import type { ExhibitionFile } from "../../../exhibitions/types";
import { translations } from "./translations";

const CAMERA_CONSENT_KEY = "sensus-camera-consent";

export function StartScreen({
  onStart,
  lang = "pt",
}: {
  onStart: (exhibition: ExhibitionFile) => void;
  lang?: string;
}) {
  const t = translations[lang] ?? translations.pt;
  const exhibitions = useMemo(() => loadExhibitions(), []);
  const disponiveis = useMemo(() => exhibitions.filter((e) => e.available !== false), [exhibitions]);
  const [selectedId, setSelectedId] = useState(() => {
    const stored = localStorage.getItem("sensus-active-exhibition-id");
    return disponiveis.some((e) => e.id === stored)
      ? (stored as string)
      : (disponiveis[0]?.id ?? "");
  });
  const [showConsent, setShowConsent] = useState(false);

  const selected = disponiveis.find((e) => e.id === selectedId) ?? disponiveis[0];
  const image = environmentImage(selected?.thumbnail);
  const summary = selected ? environmentSummary(selected) : null;

  const handleSelect = (id: string) => {
    setSelectedId(id);
    localStorage.setItem("sensus-active-exhibition-id", id);
  };

  const handleStart = () => {
    if (!selected) return;
    if (localStorage.getItem(CAMERA_CONSENT_KEY) === "granted") {
      onStart(selected);
    } else {
      setShowConsent(true);
    }
  };

  const handleConsentAccept = () => {
    localStorage.setItem(CAMERA_CONSENT_KEY, "granted");
    setShowConsent(false);
    if (selected) onStart(selected);
  };

  return (
    <div
      className="sensus-brand relative z-10 flex min-h-0 flex-1 overflow-hidden"
      style={{ background: "var(--brand-bg)" }}
    >
      {/* Fundo: a imagem do ambiente selecionado, escurecida e desfocada. */}
      {image && (
        <img
          key={image}
          src={image}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full object-cover opacity-25 blur-2xl transition-opacity duration-700"
        />
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to right, var(--brand-bg) 20%, rgba(8,11,22,0.72) 60%, rgba(8,11,22,0.88))",
        }}
      />

      <div className="relative z-10 flex min-h-0 w-full gap-12 px-14 py-10">
        {/* ── Coluna esquerda: identidade e lista de ambientes ── */}
        <div className="flex w-[30%] min-w-[15rem] flex-col">
          <span
            className="text-sm tracking-tight"
            style={{ color: "var(--brand-text)", fontWeight: 500 }}
          >
            Sensus AI
          </span>

          <span
            className="mt-14 text-[11px]"
            style={{ color: "var(--brand-text-muted)", opacity: 0.7 }}
          >
            {t.envListTitle}
          </span>

          <nav className="mt-4 flex flex-col">
            {exhibitions.map((e) => {
              const indisponivel = e.available === false;
              const active = !indisponivel && e.id === selected?.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  disabled={indisponivel}
                  title={indisponivel ? "Ainda não disponível" : undefined}
                  onClick={() => handleSelect(e.id)}
                  className={`group flex items-center gap-3 py-2.5 text-left transition-colors ${
                    indisponivel ? "cursor-not-allowed" : ""
                  }`}
                >
                  <span
                    className="h-5 w-px shrink-0 transition-colors"
                    style={{
                      background: active ? "var(--brand-primary)" : "transparent",
                    }}
                  />
                  <span
                    className="text-[15px] leading-snug transition-colors"
                    style={{
                      color: active ? "var(--brand-text)" : "var(--brand-text-muted)",
                      fontWeight: active ? 500 : 400,
                      opacity: indisponivel ? 0.3 : active ? 1 : 0.65,
                    }}
                  >
                    {e.name}
                  </span>
                  {indisponivel && (
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--brand-text-muted)", opacity: 0.4 }}
                    >
                      brevemente
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* ── Coluna direita: imagem, descrição, ficha técnica, arranque ── */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="relative min-h-0 flex-1 overflow-hidden rounded-sm"
            style={{ background: "var(--brand-surface)" }}
          >
            {image ? (
              <img
                key={image}
                src={image}
                alt={selected?.name ?? ""}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center">
                <span
                  className="text-xs"
                  style={{ color: "var(--brand-text-muted)", opacity: 0.5 }}
                >
                  {t.envUndefined}
                </span>
              </div>
            )}
          </div>

          <div className="mt-6 flex shrink-0 items-end justify-between gap-10">
            <div className="flex max-w-xl flex-col">
              <h1
                className="text-[1.75rem] leading-tight"
                style={{ color: "var(--brand-text)", fontWeight: 500 }}
              >
                {selected?.name}
              </h1>
              {selected?.description && (
                <p
                  className="mt-2.5 text-sm leading-relaxed"
                  style={{ color: "var(--brand-text-muted)" }}
                >
                  {selected.description}
                </p>
              )}

              {summary && (
                <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3">
                  {[
                    [t.envEngine, summary.motor],
                    [t.envSensors, summary.sensores],
                    [t.envMusic, summary.musica],
                  ].map(([label, value]) => (
                    <div key={label} className="flex flex-col gap-1">
                      <dt
                        className="text-[10px]"
                        style={{ color: "var(--brand-text-muted)", opacity: 0.55 }}
                      >
                        {label}
                      </dt>
                      <dd className="text-xs" style={{ color: "var(--brand-text)" }}>
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            <button
              type="button"
              onClick={handleStart}
              disabled={!selected}
              className="flex shrink-0 items-center gap-2.5 rounded-sm px-7 py-3.5 text-sm transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{
                background: "var(--brand-primary)",
                color: "var(--brand-text)",
                fontWeight: 500,
              }}
            >
              {t.envStart}
              <ArrowRight className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {showConsent && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(4,6,12,0.8)", backdropFilter: "blur(8px)" }}
        >
          <div
            className="sensus-brand relative flex w-[27rem] flex-col gap-5 rounded-sm p-7"
            style={{
              background: "var(--brand-surface)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <div className="flex items-center gap-3">
              <Camera className="size-4" style={{ color: "var(--brand-primary)" }} />
              <div className="flex flex-col leading-tight">
                <span
                  className="text-sm"
                  style={{ color: "var(--brand-text)", fontWeight: 500 }}
                >
                  {lang === "en" ? "Camera consent" : "Consentimento para a câmara"}
                </span>
                <span className="text-xs" style={{ color: "var(--brand-text-muted)" }}>
                  {lang === "en"
                    ? "Required before activating biometric sensing"
                    : "Necessário antes de ativar a análise biométrica"}
                </span>
              </div>
            </div>

            <p
              className="text-xs leading-relaxed"
              style={{ color: "var(--brand-text-muted)" }}
            >
              {lang === "en"
                ? "Sensus AI will use the camera to estimate your heart rate (rPPG), facial expression and gaze direction, and adapt the visual and sound environment to your state. All processing happens locally on this computer — no image or video is sent to external servers. Biometric data is a special category of personal data under GDPR (Art. 9). You can withdraw this consent at any time by ending the virtual environment."
                : "O Sensus AI vai usar a câmara para estimar o teu batimento cardíaco (rPPG), expressão facial e direção do olhar, e adaptar o ambiente visual e sonoro ao teu estado. Todo o processamento é feito localmente neste computador — nenhuma imagem ou vídeo é enviada para servidores externos. Dados biométricos são uma categoria especial de dados pessoais ao abrigo do RGPD (artigo 9.º). Podes retirar este consentimento a qualquer momento encerrando o ambiente virtual."}
            </p>

            <div
              className="flex items-center justify-end gap-2 pt-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
            >
              <button
                type="button"
                onClick={() => setShowConsent(false)}
                className="rounded-sm px-4 py-2 text-xs transition-opacity hover:opacity-80"
                style={{ color: "var(--brand-text-muted)" }}
              >
                {lang === "en" ? "Cancel" : "Cancelar"}
              </button>
              <button
                type="button"
                onClick={handleConsentAccept}
                className="rounded-sm px-4 py-2 text-xs transition-opacity hover:opacity-90"
                style={{
                  background: "var(--brand-primary)",
                  color: "var(--brand-text)",
                  fontWeight: 500,
                }}
              >
                {lang === "en" ? "Accept and start" : "Aceito e quero continuar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
