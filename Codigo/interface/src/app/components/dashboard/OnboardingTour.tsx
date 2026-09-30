import { useEffect, useState } from "react";
import { X, ChevronRight, ChevronLeft } from "lucide-react";
import { TOUR_STEPS } from "./onboarding";

type Rect = { top: number; left: number; width: number; height: number };

export function OnboardingTour({
  lang = "pt",
  active,
  onNavigate,
  onClose,
}: {
  lang?: string;
  active: string;
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = TOUR_STEPS[stepIndex];
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  // Cada passo navega para a página certa (se ainda não lá estivermos) antes de medir o alvo.
  useEffect(() => {
    if (step.page !== active) {
      onNavigate(step.page);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  // Localiza o elemento-alvo via data-tour, com retries (a página pode ainda estar a montar).
  useEffect(() => {
    if (!step.target) {
      setRect(null);
      return;
    }
    let cancelled = false;
    let frame = 0;

    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        return;
      }
      frame += 1;
      if (frame < 30) {
        requestAnimationFrame(measure);
      } else {
        setRect(null);
      }
    };
    measure();

    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
    };
  }, [stepIndex, active, step.target]);

  const title = step.title[lang] || step.title.pt;
  const description = step.description[lang] || step.description.pt;
  const skipLabel = lang === "en" ? "Skip tutorial" : lang === "es" ? "Saltar tutorial" : lang === "fr" ? "Passer le tutoriel" : "Saltar tutorial";
  const nextLabel = lang === "en" ? "Next" : lang === "es" ? "Siguiente" : lang === "fr" ? "Suivant" : "Seguinte";
  const prevLabel = lang === "en" ? "Back" : lang === "es" ? "Anterior" : lang === "fr" ? "Précédent" : "Anterior";
  const finishLabel = lang === "en" ? "Finish" : lang === "es" ? "Finalizar" : lang === "fr" ? "Terminer" : "Concluir";

  const padding = 10;
  const spotlightStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        top: rect.top - padding,
        left: rect.left - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
        borderRadius: 16,
        boxShadow: "0 0 0 9999px rgba(3, 4, 12, 0.78)",
        border: "2px solid var(--primary)",
        pointerEvents: "none",
        transition: "top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease",
        zIndex: 10000,
      }
    : {
        position: "fixed",
        inset: 0,
        background: "rgba(3, 4, 12, 0.78)",
        pointerEvents: "none",
        zIndex: 10000,
      };

  const tooltipTop = rect
    ? rect.top + rect.height + padding + 16 > window.innerHeight - 220
      ? Math.max(16, rect.top - padding - 16 - 200)
      : rect.top + rect.height + padding + 16
    : undefined;
  const tooltipLeft = rect ? Math.min(Math.max(16, rect.left), window.innerWidth - 336) : undefined;

  const tooltipStyle: React.CSSProperties = rect
    ? { position: "fixed", top: tooltipTop, left: tooltipLeft, zIndex: 10001 }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 10001 };

  return (
    <>
      <div style={spotlightStyle} />
      <div
        style={tooltipStyle}
        className="w-80 rounded-2xl border border-border bg-[#0a0d1d] p-5 shadow-2xl flex flex-col gap-3"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">
            {stepIndex + 1} / {TOUR_STEPS.length}
          </span>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <h3 className="text-foreground text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        <div className="flex items-center gap-1.5 py-1">
          {TOUR_STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === stepIndex ? "w-5 bg-primary" : "w-1.5 bg-border"}`}
            />
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
            {skipLabel}
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs text-foreground hover:bg-secondary/60"
              >
                <ChevronLeft className="size-3.5" />
                {prevLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? onClose() : setStepIndex((i) => i + 1))}
              className="flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs text-primary-foreground glow-primary hover:bg-primary/90"
            >
              {isLast ? finishLabel : nextLabel}
              {!isLast && <ChevronRight className="size-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
