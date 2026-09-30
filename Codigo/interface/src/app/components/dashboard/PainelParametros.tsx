import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, Maximize2, Minus, Sliders } from "lucide-react";

/**
 * Contentor do painel de parâmetros: ancorado ao fundo da janela, colapsável e
 * redimensionável em altura.
 *
 * Já foi um painel flutuante e arrastável. Não servia: por mais que se
 * arrastasse, ficava sempre por cima de uma das duas vistas de câmara, que são
 * o conteúdo principal desta janela. Agora **ocupa o seu próprio espaço** — as
 * câmaras ficam com a altura que sobra e nada se tapa. O que se afina é quanto
 * do ecrã cada um leva, pela pega de altura.
 *
 * A altura e o estado colapsado ficam no localStorage por ambiente: quem afinou
 * o painel para uma instalação não o quer voltar a afinar a cada arranque.
 */

interface Separador {
  chave: string;
  rotulo: string;
  /** Contagem opcional mostrada junto ao rótulo (ex.: nº de nodes). */
  emblema?: string | number;
}

interface Props {
  separadores: ReadonlyArray<Separador>;
  ativo: string;
  onAtivo: (chave: string) => void;
  /** Identificador do ambiente — separa a altura guardada entre ambientes. */
  idPersistencia: string;
  /** Nome do ambiente, mostrado no cabeçalho. */
  titulo?: string;
  /** Conteúdo à direita no cabeçalho (estado do motor, avisos). */
  estado?: ReactNode;
  children: ReactNode;
}

interface Estado {
  altura: number;
  colapsado: boolean;
}

const ALTURA_MIN = 160;
/** Espaço mínimo que fica para as câmaras. O painel nunca passa daqui. */
const ESPACO_CAMARAS_MIN = 220;

function estadoInicial(): Estado {
  return { altura: 340, colapsado: false };
}

/**
 * Quanto o corpo do painel ainda pode crescer (ou tem de encolher, se der
 * negativo) sem tirar às câmaras o mínimo.
 *
 * O irmão anterior é a grelha das câmaras: o único elemento flexível da coluna,
 * e portanto o que encolhe quando o painel cresce. Medir a folga assim evita
 * somar constantes para a barra do topo e para o cabeçalho — que mudam de
 * altura quando quebram de linha em janelas estreitas.
 */
function folgaDasCamaras(el: HTMLElement | null): number {
  const camaras = el?.previousElementSibling as HTMLElement | null;
  return camaras ? camaras.offsetHeight - ESPACO_CAMARAS_MIN : 0;
}

function prender(altura: number, maximo: number): number {
  return Math.min(Math.max(ALTURA_MIN, altura), Math.max(ALTURA_MIN, maximo));
}

export function PainelParametros({
  separadores,
  ativo,
  onAtivo,
  idPersistencia,
  titulo,
  estado,
  children,
}: Props) {
  const chaveGuardada = `sensus-painel-${idPersistencia}`;
  const raiz = useRef<HTMLDivElement | null>(null);
  const corpo = useRef<HTMLDivElement | null>(null);

  /** Altura máxima do corpo neste momento: o que ele mede, mais a folga. */
  const tetoAtual = (alturaCorrente: number) =>
    (corpo.current?.offsetHeight ?? alturaCorrente) + folgaDasCamaras(raiz.current);

  const [pos, setPos] = useState<Estado>(() => {
    try {
      const guardado = localStorage.getItem(chaveGuardada);
      // `altura`/`colapsado` apenas: as chaves antigas traziam também x e y, do
      // tempo em que o painel flutuava. Descartadas por omissão ao ler só estas.
      // O teto é aplicado no efeito de arranque — aqui ainda não há DOM a medir.
      if (guardado) {
        const { altura, colapsado } = JSON.parse(guardado) as Partial<Estado>;
        return {
          altura: Math.max(ALTURA_MIN, typeof altura === "number" ? altura : estadoInicial().altura),
          colapsado: !!colapsado,
        };
      }
    } catch {
      // Ignorado — cai no estado inicial.
    }
    return estadoInicial();
  });

  const redimensiona = useRef<{ y0: number; h0: number; max: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(chaveGuardada, JSON.stringify(pos));
    } catch {
      // Ignorado — a persistência é conveniência, não requisito.
    }
  }, [pos, chaveGuardada]);

  // Encolher com a janela: numa janela baixa, uma altura guardada de um ecrã
  // grande deixaria as câmaras sem espaço nenhum. A primeira passagem corre no
  // arranque porque no `useState` ainda não havia DOM para medir o cromo.
  useEffect(() => {
    const aoRedimensionar = () =>
      setPos((p) => ({ ...p, altura: prender(p.altura, tetoAtual(p.altura)) }));
    aoRedimensionar();
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, []);

  // O movimento é seguido na janela, e não na pega: com o rato a sair do
  // elemento a meio de um arrasto rápido, a altura ficava para trás.
  useEffect(() => {
    const aoMover = (e: PointerEvent) => {
      const arrasto = redimensiona.current;
      if (!arrasto) return;
      // A altura alvo calcula-se AQUI e não dentro do `setPos`: o React só corre
      // o updater mais tarde, e num arrasto rápido o `pointerup` já limpou a ref
      // nessa altura — o updater rebentava com "Cannot read properties of null".
      // O teto é o do início do arrasto, não o de agora: medi-lo a cada
      // movimento leria um DOM uma imagem atrasada e o painel tremia no limite.
      const alvo = prender(arrasto.h0 + (arrasto.y0 - e.clientY), arrasto.max);
      setPos((p) => ({ ...p, altura: alvo }));
    };
    const aoLargar = () => {
      redimensiona.current = null;
    };
    window.addEventListener("pointermove", aoMover);
    window.addEventListener("pointerup", aoLargar);
    return () => {
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("pointerup", aoLargar);
    };
  }, []);

  // ── Separador ativo: realce que desliza e conteúdo que entra de lado ──
  // O índice serve as duas coisas: dá a posição do realce e o sentido da
  // entrada. Sem sentido, mudar de "Musical" para "Geração visual" entrava do
  // mesmo lado que o caminho inverso e o gesto deixava de dizer onde se está.
  const botoes = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicador, setIndicador] = useState<{ x: number; w: number } | null>(null);
  const indice = Math.max(0, separadores.findIndex((s) => s.chave === ativo));
  const indiceAnterior = useRef(indice);
  const paraADireita = indice >= indiceAnterior.current;
  useEffect(() => {
    indiceAnterior.current = indice;
  }, [indice]);

  // `useLayoutEffect` e não `useEffect`: medido depois da pintura, o realce
  // aparecia uma imagem atrasada e via-se a saltar no primeiro clique.
  useLayoutEffect(() => {
    const medir = () => {
      const el = botoes.current[ativo];
      setIndicador(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    medir();
    // Cada separador tem o seu conteúdo; herdar o scroll do anterior deixava o
    // novo a meio, com o topo cortado sem razão visível.
    if (corpo.current) corpo.current.scrollTop = 0;
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [ativo, separadores]);

  return (
    <div
      ref={raiz}
      className="painel-sensus relative z-30 w-full shrink-0 select-none overflow-hidden"
      style={{
        background: "linear-gradient(180deg, rgba(21,27,44,0.97) 0%, rgba(9,12,22,0.99) 100%)",
        borderTop: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 -18px 40px -24px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      {/* Pega de altura no topo do painel: é ela que reparte o ecrã entre as
          câmaras e os controlos. Fica antes do cabeçalho para o alvo de arrasto
          ficar na fronteira entre os dois. */}
      <div
        onPointerDown={(e) => {
          redimensiona.current = { y0: e.clientY, h0: pos.altura, max: tetoAtual(pos.altura) };
        }}
        title="Arrastar para repartir o espaço entre as câmaras e os controlos"
        className={`group flex h-2.5 items-center justify-center ${
          pos.colapsado ? "pointer-events-none opacity-0" : "cursor-ns-resize"
        }`}
      >
        <span className="h-[3px] w-12 rounded-full bg-white/10 transition-colors group-hover:bg-white/30" />
      </div>

      {/* ── Cabeçalho + separadores ── */}
      <div
        className="flex items-center gap-3 px-3.5 pb-2.5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
        <span className="flex shrink-0 items-center gap-2">
          <Sliders className="size-3.5" style={{ color: "rgba(255,255,255,0.20)" }} />
          <span
            className="hidden max-w-[12rem] truncate text-[10px] font-medium uppercase tracking-[0.16em] sm:inline"
            style={{ color: "rgba(255,255,255,0.32)" }}
          >
            {titulo || "Parâmetros"}
          </span>
        </span>

        {/* O carril acompanha os separadores em vez de esticar até ao fim da
            barra: esticado, ficava uma calha vazia ao lado do último separador.
            `relative` porque o realce do separador ativo é um único elemento
            posicionado por cima dele. */}
        <div
          className="relative flex min-w-0 shrink items-center gap-0.5 overflow-x-auto rounded-[10px] p-1"
          style={{ background: "rgba(0,0,0,0.22)", border: "1px solid rgba(255,255,255,0.045)" }}
        >
          {/* Um realce que desliza lê-se como um objeto a mudar de sítio; quatro
              fundos a acender e a apagar leem-se como quatro coisas a piscar.
              Daí um só elemento, e daí também o gradiente e o halo terem saído:
              a posição já diz qual é o separador ativo, a cor não precisa de
              gritar por cima. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 top-1 rounded-[7px]"
            style={{
              height: "calc(100% - 8px)",
              width: indicador?.w ?? 0,
              transform: `translateX(${indicador?.x ?? 0}px)`,
              opacity: indicador ? 1 : 0,
              background: "rgba(124,103,255,0.20)",
              border: "1px solid rgba(124,103,255,0.34)",
              transition:
                "transform 260ms cubic-bezier(0.22,1,0.36,1), width 260ms cubic-bezier(0.22,1,0.36,1), opacity 160ms linear",
            }}
          />
          {separadores.map(({ chave, rotulo, emblema }) => {
            const sel = chave === ativo;
            return (
              <button
                key={chave}
                type="button"
                ref={(el) => {
                  botoes.current[chave] = el;
                }}
                onClick={() => onAtivo(chave)}
                aria-pressed={sel}
                className="relative z-10 flex shrink-0 items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[11px] transition-colors duration-150"
                style={{
                  color: sel ? "#ffffff" : "var(--brand-text-muted)",
                  fontWeight: sel ? 600 : 400,
                }}
              >
                {rotulo}
                {emblema !== undefined && emblema !== "" && (
                  <span
                    className="rounded-full px-1.5 py-[1px] text-[9px] tabular-nums"
                    style={{
                      background: sel ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)",
                      color: sel ? "#ffffff" : "var(--brand-text-muted)",
                    }}
                  >
                    {emblema}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {estado}
          <span className="mx-0.5 h-5 w-px" style={{ background: "rgba(255,255,255,0.08)" }} />
          <button
            type="button"
            title={pos.colapsado ? "Mostrar os controlos" : "Recolher os controlos"}
            onClick={() => setPos((p) => ({ ...p, colapsado: !p.colapsado }))}
            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            {pos.colapsado ? <Maximize2 className="size-3" /> : <Minus className="size-3" />}
          </button>
        </div>
      </div>

      {!pos.colapsado && (
        /* `overflow-x-hidden`: as dicas (`InfoTip`) são caixas absolutas de
           224 px que saem para fora da última coluna e davam ao painel uma
           barra horizontal permanente, mesmo invisíveis. O contentor já as
           corta na mesma (a raiz do painel tem `overflow-hidden`), por isso
           isto só tira a barra.

           `height` fixa e não `maxHeight`: o painel reserva o espaço que a pega
           lhe deu, mesmo com pouco conteúdo. Assim as câmaras não mudam de
           tamanho de cada vez que se abre ou fecha uma secção. */
        <div
          ref={corpo}
          className="painel-sensus-scroll overflow-y-auto overflow-x-hidden px-4 pb-4 pt-3"
          style={{ height: pos.altura }}
        >
          {/* A `key` é que faz a animação correr: com ela o conteúdo do separador
              é um elemento novo a cada troca e a entrada volta a disparar. O
              sentido acompanha o do realce lá em cima — os dois contam a mesma
              deslocação. */}
          <div key={ativo} className={paraADireita ? "painel-sensus-entra-dir" : "painel-sensus-entra-esq"}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Grupo dentro de um separador. Abre e fecha para baixo, com resumo do valor
 * atual quando fechado.
 */
export function GrupoPainel({
  titulo,
  resumo,
  dica,
  abertoPorOmissao = false,
  children,
}: {
  titulo: string;
  resumo?: ReactNode;
  dica?: ReactNode;
  abertoPorOmissao?: boolean;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(abertoPorOmissao);
  return (
    <div
      className="mt-2.5 overflow-hidden rounded-lg"
      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
      >
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200"
          style={{ transform: aberto ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
        <span className="text-[11px] font-semibold" style={{ color: "#c9bfff" }}>
          {titulo}
        </span>
        {dica}
        {resumo && !aberto && (
          <span className="ml-auto truncate pl-2 text-[10px] text-muted-foreground/70">{resumo}</span>
        )}
      </button>
      {aberto && (
        <div className="px-3 pb-3 pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          {children}
        </div>
      )}
    </div>
  );
}
