import { Hand } from "lucide-react";
import { translations } from "./translations";

/**
 * Ecrã de saudação da Regulação Sensorial: o visitante acena e a peça acorda.
 *
 * Só aparece enquanto o motor manda `saudacao.ativa` na telemetria. O motor é
 * a única fonte de verdade — o overlay não decide nada, só mostra o que está a
 * acontecer, incluindo o progresso do gesto para o gesto não parecer ignorado.
 *
 * A cor sólida que tapa a câmara perde opacidade ao ritmo do gesto: são cinco
 * acenos (`DetectorDeAceno.INVERSOES`) e cada um leva um quinto do que tapa,
 * até o quinto descobrir a pessoa. O desvanecer é o indicador, e é por isso que
 * já não há barra de progresso: quem acena vê-se a aparecer, que é a mesma
 * informação dita pela própria peça em vez de por um medidor ao lado.
 */
export function SaudacaoAceno({
  progresso = 0,
  lang = "pt",
}: {
  progresso?: number;
  lang?: string;
}) {
  const t = translations[lang] || translations.pt;
  const p = Math.max(0, Math.min(1, progresso));
  const passos = [t.saudacaoPasso1, t.saudacaoPasso2, t.saudacaoPasso3];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background backdrop-blur-sm transition-opacity duration-500"
      style={{ opacity: 1 - p, pointerEvents: p >= 1 ? "none" : undefined }}
      role="status"
      aria-live="polite"
    >
      <div className="mx-6 flex w-full max-w-xl flex-col items-center gap-8 text-center">
        {/* A mão acena sozinha: mostrar o gesto poupa metade da explicação. */}
        <div className="flex size-24 items-center justify-center rounded-full bg-primary/15 text-primary glow-primary">
          <Hand className="size-11 origin-bottom animate-[acenar_1.4s_ease-in-out_infinite]" />
        </div>

        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {t.saudacaoTitulo}
          </h1>
          <p className="text-base text-muted-foreground">{t.saudacaoSub}</p>
        </div>

        <ol className="w-full space-y-3 text-left">
          {passos.map((passo, i) => (
            <li key={i} className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-4">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <span className="text-sm text-foreground">{passo}</span>
            </li>
          ))}
        </ol>

        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{t.saudacaoNota}</p>

        <p className="text-xs text-muted-foreground">
          {p > 0 ? t.saudacaoReconhece : t.saudacaoProcura}
        </p>
      </div>

      <style>{`
        @keyframes acenar {
          0%, 100% { transform: rotate(-12deg); }
          50%      { transform: rotate(12deg); }
        }
      `}</style>
    </div>
  );
}
