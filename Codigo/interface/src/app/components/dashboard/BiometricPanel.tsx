/**
 * Painel de valores biométricos, sobreposto ao feed de parâmetros.
 *
 * Até 2026-08-07 este painel era desenhado pelo motor Python dentro da própria
 * imagem, com cv2.putText. Para o texto sair nítido o frame tinha de ser
 * ampliado 2× antes do desenho, o que custava ~8 ms de desenho e obrigava a
 * codificar 1280×960 em vez de 640×480 — 16 ms contra 5 ms de JPEG, e cerca do
 * triplo dos bytes por frame na telemetria.
 *
 * Os valores já viajavam todos no JSON, por isso desenhá-los aqui não custa
 * nada ao motor e o texto fica vetorial, nítido a qualquer tamanho.
 */

/** Nomes das Action Units segundo o FACS (Ekman & Friesen, 1978). */
const AU_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["1", "Sobrancelha interna"],
  ["2", "Sobrancelha externa"],
  ["4", "Franzir sobrancelhas"],
  ["5", "Pálpebra superior"],
  ["6", "Bochechas"],
  ["9", "Franzir nariz"],
  ["12", "Sorriso"],
  ["15", "Cantos para baixo"],
  ["17", "Queixo elevado"],
  ["20", "Esticar lábios"],
  ["23", "Apertar lábios"],
  ["25", "Lábios abertos"],
  ["26", "Queixo caído"],
];

const CIANO = "#00e5ff";
const ROXO = "#7c67ff";

function num(v: any, omissao = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : omissao;
}

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: CIANO }}
    >
      {children}
    </div>
  );
}

function Linha({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 text-[10px] leading-[1.5] tabular-nums text-white/85">
      {children}
    </div>
  );
}

interface Props {
  latestData?: any;
  /** Toggles do separador Sensores: controlam que secções aparecem. */
  sensores?: Record<string, any>;
}

export function BiometricPanel({ latestData, sensores = {} }: Props) {
  // Sem rosto detetado não há o que mostrar — o painel desaparece em vez de
  // ficar com uma coluna de zeros, que se lê como medição e não como ausência.
  if (!latestData?.face) return null;

  const mostrarAus = sensores.aus !== false;
  const mostrarPose = sensores.pose !== false;
  const au = latestData.au ?? {};
  const pose = latestData.pose ?? {};
  const ear = Array.isArray(latestData.ear) ? latestData.ear : [0, 0];
  const gaze = Array.isArray(latestData.gaze) ? latestData.gaze : [0, 0];

  return (
    /* top-7 deixa passar a etiqueta do painel ("Parâmetros Biométricos"), que
       fica no canto superior esquerdo e ficaria tapada. */
    <div
      className="pointer-events-none absolute bottom-0 left-0 top-7 z-10 w-[172px] overflow-y-auto px-2.5 pb-2.5 pt-1.5"
      style={{
        background: "linear-gradient(90deg, rgba(9,6,5,0.80) 0%, rgba(9,6,5,0.66) 78%, rgba(9,6,5,0) 100%)",
      }}
    >
      {mostrarAus && (
        <section className="mb-3">
          <Titulo>Action Units (FACS)</Titulo>
          <div className="flex flex-col gap-[3px]">
            {AU_LABELS.map(([codigo, etiqueta]) => {
              const v = Math.min(1, Math.max(0, num(au[codigo])));
              return (
                <div key={codigo}>
                  <div className="flex justify-between gap-1.5 text-[9px] leading-tight">
                    <span className="truncate text-white/60">{`AU${codigo} ${etiqueta}`}</span>
                    <span className="tabular-nums text-white/90">{v.toFixed(2)}</span>
                  </div>
                  <div className="mt-[2px] h-[3px] w-full overflow-hidden rounded-full bg-white/12">
                    <div
                      className="h-full rounded-full transition-[width] duration-150"
                      style={{ width: `${v * 100}%`, background: v > 0.66 ? CIANO : ROXO }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {mostrarPose && (
        <section className="mb-3">
          <Titulo>Pose / Ocular</Titulo>
          <Linha>
            <span className="text-white/60">Pitch / Yaw / Roll</span>
          </Linha>
          <Linha>
            <span>
              {num(pose.p).toFixed(1)} / {num(pose.y).toFixed(1)} / {num(pose.r).toFixed(1)}
            </span>
          </Linha>
          <Linha>
            <span className="text-white/60">EAR E / D</span>
            <span>
              {num(ear[0]).toFixed(3)} / {num(ear[1]).toFixed(3)}
            </span>
          </Linha>
          <Linha>
            <span className="text-white/60">Íris (raio norm.)</span>
            <span>{num(latestData.iris_radius).toFixed(4)}</span>
          </Linha>
          <Linha>
            <span className="text-white/60">Olhar x / y</span>
            <span>
              {num(gaze[0]).toFixed(2)} / {num(gaze[1]).toFixed(2)}
            </span>
          </Linha>
          <Linha>
            <span className="text-white/60">Fixação</span>
            <span>{num(latestData.fixation).toFixed(0)} ms</span>
          </Linha>
          <Linha>
            <span className="text-white/60">Piscadelas</span>
            <span>{num(latestData.blinks).toFixed(0)}</span>
          </Linha>
        </section>
      )}

      <section>
        <Titulo>Vitais / Russell</Titulo>
        <Linha>
          <span className="text-white/60">BPM (rPPG)</span>
          <span>{num(latestData.bpm).toFixed(0)}</span>
        </Linha>
        <Linha>
          <span className="text-white/60">Valência</span>
          <span>{num(latestData.val).toFixed(2)}</span>
        </Linha>
        <Linha>
          <span className="text-white/60">Ativação</span>
          <span>{num(latestData.aro).toFixed(2)}</span>
        </Linha>
        <Linha>
          <span className="text-white/60">Simetria</span>
          <span>{num(latestData.sym).toFixed(2)}</span>
        </Linha>
        <Linha>
          <span className="text-white/60">FPS do motor</span>
          <span>{num(latestData.fps).toFixed(0)}</span>
        </Linha>
      </section>
    </div>
  );
}
