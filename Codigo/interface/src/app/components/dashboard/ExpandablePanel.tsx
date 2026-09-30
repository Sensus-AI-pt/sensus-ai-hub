import { Maximize2, Minimize2 } from "lucide-react";

export function ExpandablePanel({
  label,
  expanded,
  onToggle,
  children,
  className = "",
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative flex items-center justify-center overflow-hidden ${className}`}>
      {children}

      <span
        className="absolute left-3 top-3 rounded-sm px-2 py-0.5 text-[10px] backdrop-blur-sm"
        style={{
          background: "rgba(8,11,22,0.55)",
          color: "var(--brand-text-muted)",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {label}
      </span>

      {/* Voltou a `top-3`: a barra de ações da janela deixou de flutuar sobre o
          vídeo e passou a ter a sua própria faixa ancorada, por isso este botão
          já não fica por baixo dela. O afastamento para `top-16` existia só por
          causa dessa sobreposição. */}
      <button
        type="button"
        onClick={onToggle}
        title={expanded ? "Reduzir" : "Expandir"}
        aria-label={expanded ? "Reduzir" : "Expandir"}
        className="absolute right-3 top-3 z-30 flex size-7 items-center justify-center rounded-sm backdrop-blur-sm transition-opacity hover:opacity-80"
        style={{
          background: "rgba(8,11,22,0.55)",
          color: "var(--brand-text-muted)",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </button>
    </div>
  );
}
