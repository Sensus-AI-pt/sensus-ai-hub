import { useEffect, useRef, useState } from "react";

/**
 * Legenda do estado sobre a imagem gerada, na janela de projeção.
 *
 * O modelo é dimensional: o motor decide o quadrante do circumplexo de Russell
 * (1980) — valência × ativação — e é esse quadrante que escolhe a frase. As
 * frases dizem a posição medida, não diagnosticam uma emoção discreta: "low
 * activation, and the tone is pleasant" é o que o sinal sustenta; "you are
 * happy" não é. Quem decide o quadrante continua a ser o motor, com histerese
 * e tempo mínimo de permanência — aqui só se lê o que ele já decidiu.
 *
 * Inglês fixo, independente da língua da interface: é a língua do público das
 * exposições. O Piper lê-as com o modelo `en_US-amy-medium`.
 */

/**
 * Frases por quadrante. As chaves têm de bater certo com `_QUADRANTES` do motor.
 *
 * Quarenta por quadrante, sorteadas sem reposição (ver `proximaFrase`). Eram
 * quatro em ciclo fixo: um visitante de dez minutos ouvia a mesma sequência
 * dez vezes e a peça passava a soar a gravação. A 15 s cada, quarenta frases
 * sem repetir dão dez minutos de legenda antes de a primeira voltar — mais do
 * que a permanência típica de um visitante.
 *
 * Todas dizem a mesma coisa por vias diferentes: onde está a leitura nos dois
 * eixos. Nenhuma nomeia uma emoção discreta, nenhuma promete um efeito.
 */
const FRASES: Record<string, string[]> = {
  calmo_positivo: [
    "Your body has settled. Low activation, and the tone of it is pleasant.",
    "A slow heart and an open face. This is rest, and it seems to suit you.",
    "Nothing here is asking for effort from you right now.",
    "Low arousal, positive valence. The image slows down with you.",
    "Your pulse is unhurried. The reading is calm, and the tone is warm.",
    "You are still, and the stillness reads as comfortable.",
    "Little movement, and what there is of it is easy.",
    "The measurement says rest. It also says the rest is welcome.",
    "Your face is loose. Nothing in it is holding on.",
    "Slow breath, slow heart. The room can stay like this.",
    "This is the quiet corner of the map, on the pleasant side.",
    "You are settled enough that the music has room to move.",
    "Low activation, positive tone. Two readings that agree with each other.",
    "Your heart has found a pace it can keep.",
    "There is no urgency in what the camera is reading.",
    "Ease, measured rather than performed.",
    "The signal is steady. Steady, here, is not the same as flat.",
    "Your body is asking for nothing. The image answers in kind.",
    "A calm reading, and the colour of it is warm.",
    "You have stopped bracing. The measurement can tell.",
    "Whatever the day did, your pulse is no longer carrying it.",
    "Low arousal. The tone is open rather than closed.",
    "You are resting, and resting seems to be going well.",
    "The numbers are quiet. So is the room.",
    "Your face is soft and your heart is slow. That is the whole reading.",
    "Nothing sharp in the signal. Nothing heavy either.",
    "This is rest with the lights on. Awake, and unhurried.",
    "Your pulse is long. The image lengthens with it.",
    "The reading is low and pleasant. Stay as long as you like.",
    "You are not in a hurry, and neither is anything here.",
    "Calm, with something agreeable in it.",
    "Your body has let go of the last few minutes.",
    "Low activation, warm tone. The sound will keep you company.",
    "An open face over a slow heart. That combination is rare.",
    "The environment is following you rather than leading.",
    "You are quiet, and the quiet is comfortable.",
    "Rest is what the sensors are reading, plainly.",
    "There is space in this reading, and nothing is filling it.",
    "Your heart is slow and your expression is easy.",
    "Low arousal, positive valence. The safest corner of the map.",
  ],
  calmo_negativo: [
    "You are quiet, but the tone is heavy. Low activation, little pleasure.",
    "Your body has slowed without quite letting go.",
    "Low arousal, negative valence. This is the tired corner of the map.",
    "Little movement, little lift. The sound will come to meet you.",
    "Your pulse is slow, and the face above it is not open.",
    "Stillness without ease. The reading separates the two.",
    "Low energy, and the tone of it is not warm.",
    "You are still, but something is still weighing.",
    "The signal is quiet and a little grey.",
    "Slow heart, closed expression. That is what is being measured.",
    "This is rest that does not feel like rest.",
    "Low activation with a heavy tone. The music will lift before you do.",
    "There is not much moving, and what moves is downward.",
    "Your body has stopped, but it has not softened.",
    "The reading is flat. Flat is a state, not a verdict.",
    "Little arousal, little pleasure. The tired quadrant.",
    "You are withdrawn from the room rather than resting in it.",
    "Your face is doing very little. The sensors read that as low tone.",
    "Quiet, and the quiet is not comfortable yet.",
    "The signal says slow. It also says heavy.",
    "Low energy. The environment will bring some of its own.",
    "You are not braced, but you are not open either.",
    "Your heart is unhurried and your expression is dim.",
    "Something is settled and something is not.",
    "This corner is slow and unbright. It usually passes.",
    "Little lift in the face, little speed in the pulse.",
    "The sound is going to grow. Let it do the work.",
    "Low arousal, negative valence. Nothing here is asking you to perform.",
    "You are running quiet, and a little low.",
    "Stillness with weight in it. That is the measurement.",
    "Your face is not holding tension, only absence.",
    "The tone is down. The activation is down with it.",
    "This is the corner where the music comes to fetch you.",
    "Your pulse is slow, and the reading is not a bright one.",
    "Low energy and low colour. The image will add some.",
    "You have gone quiet. The room is going to answer.",
    "There is little in the signal to hold on to right now.",
    "Slow and heavy is a place, and you are in it.",
    "Neither effort nor ease. Something in between, and low.",
    "Low activation, dim tone. The environment will lead for a while.",
  ],
  ativado_positivo: [
    "Your heart has lifted and the tone is bright. Activation, and it is welcome.",
    "Something here is holding your attention, and you seem to be enjoying it.",
    "High arousal, positive valence. The image quickens with you.",
    "You are awake and open. The music moves the other way, towards calm.",
    "Your pulse is up and your face is open. Those usually go together here.",
    "Alert, and the alertness reads as pleasant.",
    "Energy with a warm tone. The bright corner of the map.",
    "You are engaged. The sensors read speed and openness at once.",
    "High activation, and nothing tense in it.",
    "Your heart is quick and your expression is lifted.",
    "This is interest, measured as movement and warmth.",
    "Awake, bright, and going somewhere.",
    "The signal is fast and the tone is up.",
    "You are lit up. The music will hold a slower line underneath.",
    "Activation with pleasure in it. That is the reading.",
    "Your body is up and your face agrees with it.",
    "Quick pulse, open face. Nothing here is defensive.",
    "Excitement is a reasonable word for this reading.",
    "High arousal, warm valence. The environment takes the other side.",
    "You are moving with the room rather than against it.",
    "Energy is high. The music will lend you some calm.",
    "Your heart is fast, and the reason seems to be a good one.",
    "Bright and quick. The image can keep up.",
    "Activation without tension is a specific thing, and it is what you read as.",
    "You are attentive and warm at the same time.",
    "The pulse is high, the tone is high. Both.",
    "Something is happening for you, and the sensors like the shape of it.",
    "Fast and open. The music will slow the room around you.",
    "This corner of the map is loud and pleasant.",
    "Your face is doing a lot, and none of it is guarded.",
    "High energy, positive tone. The peak of the bright side.",
    "You are carrying momentum. The sound will not add to it.",
    "Quick, bright, engaged. Three ways of saying the same reading.",
    "The measurement is high and the colour of it is warm.",
    "There is a lot in the signal, and it is going upward.",
    "You are activated, and it is the good kind.",
    "Fast heart, easy face. That pairing is what puts you here.",
    "The image speeds up. The music slows down. That is deliberate.",
    "High arousal with a pleasant tone. Enjoy it, and then let it settle.",
    "You are at the top of the map, on the warm side of it.",
  ],
  ativado_negativo: [
    "Your body is alert and the tone is tense. High activation, little pleasure.",
    "Your heart is quick. Whatever this is, it is not comfortable yet.",
    "High arousal, negative valence. Let the sound slow you down.",
    "You are braced. Breathe out, and the environment will follow.",
    "Fast pulse, tight face. That is what puts you in this corner.",
    "Energy is high and the tone of it is not warm.",
    "You are holding something. The sensors read it as tension.",
    "Quick heart, closed expression. The music is going the other way.",
    "High activation without pleasure. The sharp corner of the map.",
    "Your body is ready for something. Nothing here requires it.",
    "Tension is the shortest word for this reading.",
    "You are fast and guarded at the same time.",
    "The signal is high and the colour is cold.",
    "Your face is working. Let it stop for a moment.",
    "High arousal, dim tone. The sound will lower the room.",
    "There is effort in your expression that nothing here is asking for.",
    "Your pulse is up and the tone is down. That combination is this corner.",
    "Alert, and not at ease. The measurement separates the two.",
    "Something has your body ready. The music will not rush you.",
    "Quick and tight. The environment is about to slow.",
    "High energy, low tone. It usually softens within a minute.",
    "You are braced against something. Let the image carry it instead.",
    "The reading is fast and the face above it is not open.",
    "Tension with speed. The sound is deliberately slower than you are.",
    "Your heart is ahead of the room. The room will wait.",
    "High activation, negative valence. Breathe out longer than you breathe in.",
    "Your jaw and your pulse are telling the same story.",
    "Fast, and not enjoying it. That is the reading, plainly.",
    "You are alert in the way that costs something.",
    "The music is slowing on purpose. Let it take the lead.",
    "High arousal with a hard edge. The environment softens from here.",
    "Your body is doing more than this room needs.",
    "Speed without warmth. The sensors read both.",
    "You are wound up. Nothing here is going to wind you further.",
    "Quick pulse, held face. Unclench and watch it change.",
    "The signal is loud and the tone is cold.",
    "You are tense, and the measurement says so without judging it.",
    "Activation is high. Pleasure is low. The room will address the first.",
    "The image will not chase you. It is already slowing.",
    "High arousal, negative valence. This is the corner the piece was built for.",
  ],
};

/** De quanto em quanto tempo aparece uma frase nova. */
const INTERVALO_MS = 15000;
/** Quanto tempo fica no ecrã. A locução do Piper dura ~4 s nestas frases. */
const DURACAO_MS = 9000;

/** Baralha uma cópia da lista (Fisher-Yates). */
function baralhar<T>(lista: T[]): T[] {
  const copia = lista.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/** Saco por quadrante, do qual se tira sem repor. */
const sacos: Record<string, string[]> = {};

/**
 * Sorteio sem reposição.
 *
 * Aleatório puro repetiria a frase anterior uma vez em quarenta — pouco, mas o
 * suficiente para alguém numa sala silenciosa dar por isso. O saco garante que
 * as quarenta saem todas antes de qualquer uma voltar, e ao reencher troca a
 * primeira se calhar ser a última já dita: a costura entre sacos é o único
 * sítio onde a repetição imediata ainda cabia.
 */
function proximaFrase(quadrante: string, ultima: string): string | null {
  const lista = FRASES[quadrante];
  if (!lista?.length) return null;
  let saco = sacos[quadrante];
  if (!saco?.length) {
    saco = baralhar(lista);
    // `pop()` tira do fim, por isso a próxima a sair é a última do saco.
    const fim = saco.length - 1;
    if (saco.length > 1 && saco[fim] === ultima) {
      [saco[fim], saco[0]] = [saco[0], saco[fim]];
    }
    sacos[quadrante] = saco;
  }
  return saco.pop() ?? null;
}

/**
 * Lê a frase em voz alta pelo Piper inglês. Falhar continua a ser silencioso no
 * ecrã — uma sala sem voz continua a ser a peça; uma sala com um erro projetado
 * não — mas deixou de ser silencioso no log. Cada ramo diz porque se calou: o
 * processo principal encaminha a consola desta janela para o log da aplicação, e
 * sem isso uma legenda muda era indistinguível de uma legenda a funcionar.
 */
function falar(texto: string) {
  const api = window.electronAPI;
  if (!api?.speakText) {
    console.error("[legenda] sem electronAPI.speakText — a locução fica muda");
    return;
  }
  api
    .speakText(texto, "en")
    .then((res: any) => {
      if (!res?.success || !res.wav) {
        console.error("[legenda] Piper não sintetizou:", res?.error ?? "resposta sem WAV");
        return;
      }
      const audio = new Audio(res.wav);
      // Mesmo volume do assistente — o controlo já existe no painel.
      audio.volume = Number(localStorage.getItem("sensus.voiceVolume") ?? 0.7);
      // Rejeita com NotAllowedError se a autoplay policy do Chromium estiver a
      // exigir interação do utilizador nesta janela (ver o switch no main.js).
      audio.play().catch((e: any) => console.error("[legenda] o áudio não tocou:", e?.name ?? e));
    })
    .catch((e: any) => console.error("[legenda] speakText falhou:", e?.message ?? e));
}

export function LegendaEstado({ quadrante }: { quadrante?: string }) {
  const [frase, setFrase] = useState<string | null>(null);
  // O quadrante chega a cada frame; lê-se por ref para o ciclo de 15 s não
  // reiniciar a cada telemetria. O intervalo tem de ser estável — a frase é que
  // segue o estado no instante em que é dita.
  const quadranteRef = useRef(quadrante);
  quadranteRef.current = quadrante;
  // Guarda o texto para ele poder desvanecer em vez de desaparecer de repente,
  // e serve de referência ao saco para não repetir na mudança de quadrante.
  const ultima = useRef("");
  if (frase) ultima.current = frase;

  useEffect(() => {
    let saida: number | undefined;
    const dizer = () => {
      const nova = proximaFrase(quadranteRef.current || "", ultima.current);
      if (!nova) return; // sem estado medido não há nada a dizer
      setFrase(nova);
      falar(nova);
      window.clearTimeout(saida);
      saida = window.setTimeout(() => setFrase(null), DURACAO_MS);
    };
    const ciclo = window.setInterval(dizer, INTERVALO_MS);
    return () => {
      window.clearInterval(ciclo);
      window.clearTimeout(saida);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-[6vw] pb-[7vh]">
      <p
        className="max-w-[46rem] text-center leading-snug text-white transition-opacity duration-1000"
        style={{
          opacity: frase ? 1 : 0,
          fontFamily: "Poppins, system-ui, sans-serif",
          fontSize: "clamp(1rem, 2.1vw, 2rem)",
          fontWeight: 500,
          // A imagem gerada por baixo muda de luminância a cada frame; sem a
          // sombra, uma frase branca desaparecia sobre um fundo claro.
          textShadow: "0 2px 18px rgba(0,0,0,0.85), 0 0 4px rgba(0,0,0,0.9)",
        }}
      >
        {ultima.current}
      </p>
    </div>
  );
}
