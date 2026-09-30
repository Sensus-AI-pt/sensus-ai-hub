import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Secção de painel que abre e fecha para baixo.
 *
 * O painel de parâmetros cresceu ao ponto de precisar de scroll próprio; com as
 * secções fechadas vê-se a estrutura toda de uma vez e abre-se só o que se está
 * a usar. O estado é local a cada secção, de propósito: quem está a afinar uma
 * prompt não quer que abrir os sliders lhe feche o texto.
 */
export function SecaoColapsavel({
  titulo,
  dica,
  abertaPorOmissao = false,
  resumo,
  children,
}: {
  titulo: string;
  /** Ícone de ajuda já montado. Vem de fora porque o InfoTip vive no ProjectionView. */
  dica?: ReactNode;
  /** Aberta ao entrar. Usar só nas secções que se mexem em quase todas as sessões. */
  abertaPorOmissao?: boolean;
  /** Texto curto à direita, visível com a secção fechada (ex.: o valor atual). */
  resumo?: ReactNode;
  children: ReactNode;
}) {
  const [aberta, setAberta] = useState(abertaPorOmissao);
  // Altura do conteúdo, medida. É o que permite abrir e fechar com movimento
  // sem inventar um `max-height`: um palpite corta o conteúdo mais alto do que
  // ele. O observador mantém a medida certa enquanto a secção está aberta —
  // sem ele, um campo que apareça lá dentro (um erro, uma lista) ficava
  // cortado pela altura antiga.
  const conteudo = useRef<HTMLDivElement | null>(null);
  const [altura, setAltura] = useState(0);

  useEffect(() => {
    const el = conteudo.current;
    if (!el) return;
    const medir = () => setAltura(el.scrollHeight);
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  return (
    <div
      className="overflow-hidden rounded-xl transition-colors"
      style={{
        // O cinzento `bg-secondary` destoava do azul-noite do painel e deixava
        // as secções com ar de caixa avulsa. Aqui a superfície é a mesma família
        // de cor, e é a secção aberta que ganha contraste — não a fechada.
        background: aberta ? "rgba(255,255,255,0.032)" : "rgba(255,255,255,0.016)",
        border: `1px solid ${aberta ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.055)"}`,
        // O aberto marca-se com um fio roxo na margem, não com a caixa toda a
        // roxo: com quatro ou cinco secções abertas, quatro ou cinco molduras
        // acesas davam uma parede de contornos e nenhuma hierarquia.
        boxShadow: aberta ? "inset 2px 0 0 var(--brand-primary)" : "none",
      }}
    >
      <button
        type="button"
        onClick={() => setAberta((a) => !a)}
        aria-expanded={aberta}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <ChevronDown
          className="size-3 shrink-0 transition-transform"
          style={{
            transitionDuration: "var(--mov-normal)",
            transitionTimingFunction: "var(--mov-resposta)",
            transform: aberta ? "rotate(0deg)" : "rotate(-90deg)",
            color: aberta ? "var(--brand-primary)" : "rgba(255,255,255,0.32)",
          }}
        />
        <span
          className="text-[11px] font-semibold"
          style={{ color: aberta ? "var(--brand-text)" : "rgba(248,248,250,0.78)" }}
        >
          {titulo}
        </span>
        {dica}
        {resumo && !aberta && (
          <span
            className="ml-auto max-w-[55%] shrink-0 truncate pl-3 text-right text-[10px] tabular-nums"
            style={{ color: "rgba(201,206,218,0.62)" }}
          >
            {resumo}
          </span>
        )}
      </button>
      {/* Sempre montada, para poder abrir e fechar com movimento em vez de
          aparecer e desaparecer de golpe — abrir uma secção é uma ação, e o
          movimento é o que mostra o que mudou. A `.mov-abre` fecha-a com
          `visibility: hidden` no fim da transição, por isso o que está fechado
          também sai do caminho do Tab e da árvore de acessibilidade. */}
      <div
        className="mov-abre"
        data-aberta={aberta}
        style={{ maxHeight: aberta ? altura : 0 }}
      >
        <div ref={conteudo} className="px-3.5 pb-3.5 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.055)" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
