import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Sliders, RefreshCw, Lock, Unlock, Minus, Plus, Settings, Maximize, Minimize, Volume2, VolumeX, Music, X, Loader2, Info, Check, Send, Image as ImageIcon, Layers, Eraser, Hand, Undo2, FlipHorizontal, Wand2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Slider } from "../ui/slider";
import { useSettings } from "../../../context/SettingsContext";
import { SaudacaoAceno } from "./SaudacaoAceno";
import { LegendaEstado } from "./LegendaEstado";
import { NodeGraphEditor } from "./NodeGraphEditor";
import { ExpandablePanel } from "./ExpandablePanel";
import { RussellPlot } from "./RussellPlot";
import { SecaoColapsavel } from "./SecaoColapsavel";
import { PainelParametros } from "./PainelParametros";
import { BiometricPanel } from "./BiometricPanel";
import { DepthVisualizer } from "./DepthVisualizer";
import { cameraDeArranque, guardarCamera } from "./cameraSource";
import { FluidSimulation } from "./FluidSimulation";
import { FLUID_PRESETS, PRESET_POR_OMISSAO } from "./fluidPresets";
import type { FluidPhysics } from "./fluidPresets";
import { DEPTH_TECHNIQUES } from "../../../exhibitions/nodeRegistry";
import type { NodeGraph, ExhibitionFile } from "../../../exhibitions/types";

const DEPTH_COLOR_MODES = ["Grayscale", "Rainbow", "Contour", "Normal", "Hologram", "Tint"];

/**
 * Nome legível de cada técnica. O identificador vai para o motor; o que aparece
 * na lista é isto — um painel que oferece "instanced_cubes" obriga a
 * experimentar às cegas para saber o que cada opção faz.
 */
const NOMES_TECNICA: Record<string, string> = {
  point_cloud: "Nuvem de pontos",
  wireframe: "Malha de arame",
  particles: "Partículas",
  instanced_cubes: "Cubos",
  topographic_laser: "Laser topográfico",
  relighting: "Reiluminação",
  z_masking: "Máscara em Z",
};

/** Paleta rápida do Air Painting — cores da marca mais um vermelho de contraste. */
const PALETA_PINTURA = ["#7c67ff", "#8ab8ff", "#a6e8d9", "#ffd166", "#ff5c8a", "#f8f8fa"];

/**
 * Quadrantes do modelo circumplexo de Russell (1980), na ordem em que aparecem
 * no painel. As chaves têm de bater certo com `_QUADRANTES` do motor.
 */
const QUADRANTES_RUSSELL = [
  { chave: "ativado_negativo", rotulo: "Ativado · negativo", nota: "tensão, alerta" },
  { chave: "ativado_positivo", rotulo: "Ativado · positivo", nota: "entusiasmo, alegria" },
  { chave: "calmo_negativo", rotulo: "Calmo · negativo", nota: "desânimo, fadiga" },
  { chave: "calmo_positivo", rotulo: "Calmo · positivo", nota: "serenidade, contentamento" },
] as const;

// ── Pauta minimalista em tempo real (sem barras de compasso, tipografia Poppins) ──
function noteToStaffY(name: string): number {
  const NOTE_ORDER: Record<string, number> = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
  const m = name.match(/^([A-G]#?)(\d)$/);
  if (!m) return 50;
  const semis = NOTE_ORDER[m[1]] ?? 0;
  const octave = parseInt(m[2], 10);
  const midi = (octave + 1) * 12 + semis; // C4 = 60
  // Mapear C4(60)..C6(84) para 90%..10% da altura (mais agudo = mais alto)
  const clamped = Math.max(60, Math.min(84, midi));
  return 90 - ((clamped - 60) / 24) * 80;
}

function SensusStaff({ note, noteId }: { note?: string; noteId?: number }) {
  const [notes, setNotes] = useState<{ id: number; name: string; y: number }[]>([]);
  const lastIdRef = useRef(-1);
  useEffect(() => {
    if (typeof noteId === "number" && noteId !== lastIdRef.current && note) {
      lastIdRef.current = noteId;
      setNotes((prev) => [...prev, { id: noteId, name: note, y: noteToStaffY(note) }].slice(-18));
    }
  }, [noteId, note]);

  return (
    <div
      className="relative w-full h-20 rounded-xl overflow-hidden"
      style={{ background: "rgba(6,8,16,0.72)", backdropFilter: "blur(8px)", fontFamily: "Poppins, system-ui, sans-serif" }}
    >
      {/* 5 linhas da pauta */}
      {[20, 35, 50, 65, 80].map((top) => (
        <div key={top} className="absolute left-0 right-0" style={{ top: `${top}%`, height: 1, background: "rgba(255,255,255,0.55)" }} />
      ))}
      {/* Clave estilizada */}
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/90 font-bold text-2xl">𝄞</span>
      {/* Notas a fluir da esquerda para a direita */}
      {notes.map((n, i) => (
        <div
          key={n.id}
          className="absolute flex flex-col items-center transition-all duration-500 ease-linear"
          style={{ left: `${8 + (i / 18) * 88}%`, top: `${n.y}%`, transform: "translate(-50%,-50%)" }}
        >
          <span className="rounded-full" style={{ width: 10, height: 10, background: i === notes.length - 1 ? "#00e5ff" : "#ffffff", boxShadow: i === notes.length - 1 ? "0 0 10px #00e5ff" : "none" }} />
          <span className="mt-0.5 text-[8px] font-semibold text-white/70">{n.name}</span>
        </div>
      ))}
      <span className="absolute right-3 top-2 text-[9px] uppercase tracking-widest text-white/50 font-semibold">Pauta · Melodia</span>
    </div>
  );
}

// ── Ícone "i" com descrição do controlo ao passar o rato ──
function InfoTip({ text }: { text: string }) {
  return (
    <span className="group/tip relative inline-flex shrink-0 align-middle">
      <Info className="size-3 cursor-help text-muted-foreground/50 transition-colors group-hover/tip:text-primary" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-56 -translate-x-1/2 rounded-lg border border-border/60 bg-[#0a0d1d]/95 px-2.5 py-1.5 text-[9px] font-normal normal-case leading-relaxed tracking-normal text-foreground/90 opacity-0 shadow-xl backdrop-blur-md transition-opacity duration-150 group-hover/tip:opacity-100">
        {text}
      </span>
    </span>
  );
}

// ── Barra viva: mostra um valor do motor a mexer em tempo real ──
function LiveBar({ label, value, min, max, unit, tip }: { label: string; value: number; min: number; max: number; unit?: string; tip?: string }) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {label}
        {tip && <InfoTip text={tip} />}
        <b className="ml-auto font-medium tabular-nums text-foreground">{Math.round(value)}{unit || ""}</b>
      </span>
      <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.09)" }}>
        <div
          className="h-full rounded-full transition-all duration-300 ease-out"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--brand-primary) 0%, var(--brand-tertiary) 100%)",
          }}
        />
      </div>
    </div>
  );
}

// ── Rótulo compacto de slider com tooltip ──
// O valor tem `valor` próprio em vez de ir entre parênteses no fim do rótulo: em
// parênteses, cada campo da grelha tinha um comprimento diferente e os números
// ficavam espalhados por onde calhasse a linha acabar. Encostados à direita e em
// `tabular-nums`, alinham numa coluna e lêem-se de relance, que é o que se quer
// de valores que mudam a meio de uma sessão.
function SliderLabel({
  children,
  tip,
  valor,
}: {
  children: React.ReactNode;
  tip: string;
  valor?: React.ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-start gap-x-2 text-[11px] leading-tight text-muted-foreground">
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {children}
        <InfoTip text={tip} />
      </span>
      {valor !== undefined && (
        <b className="shrink-0 font-medium tabular-nums text-foreground">{valor}</b>
      )}
    </span>
  );
}

// As treze escalas do motor. Sem entrada aqui a escala ativa aparecia como "—",
// que é indistinguível de não haver leitura nenhuma.
const SCALE_LABELS: Record<string, string> = {
  minor: "Menor", major_pent: "Pentatónica maior", lydian: "Lídia",
  major: "Maior", dorian: "Dórica", phrygian: "Frígia", mixolydian: "Mixolídia",
  harmonic_minor: "Menor harmónica", minor_pent: "Pentatónica menor",
  blues: "Blues", hirajoshi: "Hirajoshi", pelog: "Pelog", whole_tone: "Tons inteiros",
  "": "—",
};

// ═══════════════════════════════════════════════════════════════════
// PAINEL DE CONTROLO — câmaras lado a lado + controlos por separadores
// ═══════════════════════════════════════════════════════════════════
/**
 * Último mapa de profundidade recebido, já em data-URI.
 *
 * O motor só põe a chave `depth_map` na telemetria quando o mapa é novo: ele é
 * calculado a ~10 Hz e o ciclo corre a mais do dobro disso, pelo que reenviá-lo
 * a cada frame era repetir dezenas de KB de base64 por nada. A maioria dos
 * frames chega, portanto, sem a chave — e sem esta memória a projeção piscava
 * entre a cena 3D e o ecrã de "a carregar o modelo de profundidade".
 */
function useMapaProfundidade(bruto?: string) {
  const ref = useRef<string | undefined>(undefined);
  if (bruto) ref.current = bruto.startsWith("data:") ? bruto : `data:image/jpeg;base64,${bruto}`;
  return ref.current;
}

export function ProjectionAIView({ latestData }: { latestData?: any }) {
  const { activeSensors, setActiveSensors, lang } = useSettings();
  const [layers, setLayers] = useState<Record<string, { vol: number; on: boolean }>>({
    melodia: { vol: 0.85, on: true },
    piano: { vol: 0.70, on: true },
    coro: { vol: 0.55, on: true },
    tabla: { vol: 0.50, on: true },
    percussao: { vol: 0.45, on: true },
  });
  const [tab, setTab] = useState<"visual" | "musica" | "config" | "nodes" | "pintura" | "fluido">("visual");
  const activeExhibition = useMemo<ExhibitionFile | null>(() => {
    try {
      const raw = localStorage.getItem("sensus-active-exhibition");
      if (raw) return JSON.parse(raw) as ExhibitionFile;
    } catch {
      // Ignorado — cai para null (assume StreamDiffusion, como a Regulação Sensorial).
    }
    return null;
  }, []);
  // O motor conta o quinto aceno e deixa de mandar `saudacao` no mesmo frame,
  // por isso o overlay nunca chega a receber progresso 1. Sem segurá-lo mais um
  // instante a 1, a cor desaparecia de repente com um quinto ainda por levantar,
  // em vez de acabar de se abrir sobre a pessoa.
  const saudacaoAtiva = !!latestData?.saudacao?.ativa;
  const [saudacaoVisivel, setSaudacaoVisivel] = useState(saudacaoAtiva);
  useEffect(() => {
    if (saudacaoAtiva) {
      setSaudacaoVisivel(true);
      return;
    }
    const t = setTimeout(() => setSaudacaoVisivel(false), 600);
    return () => clearTimeout(t);
  }, [saudacaoAtiva]);

  const usesStreamDiffusion = activeExhibition?.engine.streamdiffusion.enabled ?? true;
  const usesDepthMap = activeExhibition?.engine.depthMap.enabled ?? false;
  const usesAirPainting = activeExhibition?.engine.airPainting?.enabled ?? false;
  const usesFluid = activeExhibition?.engine.fluid?.enabled ?? false;
  // O plano de Russell existe só na Regulação Sensorial, onde fica no separador
  // de geração visual ao lado das prompts por quadrante que ele comanda. Os
  // outros ambientes não leem valência nem ativação (Air Painting e Fluid AI
  // não usam rosto), por isso não mostram o plano em sítio nenhum.
  const russellNoPainel = !usesAirPainting && !usesFluid && !usesDepthMap;
  const depthDefaults = activeExhibition?.defaults.depthViz;
  const [graph, setGraph] = useState<NodeGraph>(() => activeExhibition?.graph ?? { nodes: [], connections: [] });
  const [depthTechnique, setDepthTechnique] = useState(depthDefaults?.technique ?? "point_cloud");
  const [depthColorMode, setDepthColorMode] = useState(depthDefaults?.colorMode ?? "Rainbow");
  const [depthBaseColor, setDepthBaseColor] = useState(depthDefaults?.baseColor ?? "#00f0ff");
  const [depthAmplitude, setDepthAmplitude] = useState(depthDefaults?.amplitude ?? 3.0);
  const [depthContrast, setDepthContrast] = useState(depthDefaults?.contrast ?? 1.5);
  const [depthThreshold, setDepthThreshold] = useState(depthDefaults?.threshold ?? 0.05);
  const [depthPointSize, setDepthPointSize] = useState(depthDefaults?.pointSize ?? 3.0);
  const [depthResolution, setDepthResolution] = useState(depthDefaults?.resolution ?? 256);
  const [depthWaveSize, setDepthWaveSize] = useState(depthDefaults?.waveSize ?? 0.0);
  const [depthWaveSpeed, setDepthWaveSpeed] = useState(depthDefaults?.waveSpeed ?? 1.0);
  const [depthGlow, setDepthGlow] = useState(depthDefaults?.glow ?? 0.8);
  const [depthSlices, setDepthSlices] = useState(depthDefaults?.slices ?? 0);
  const [depthOrbit, setDepthOrbit] = useState(false);
  const [depthOrbitSpeed, setDepthOrbitSpeed] = useState(0.6);
  const [depthCamDist, setDepthCamDist] = useState(12);
  const [promptDraft, setPromptDraft] = useState("blue rose in a purple room");
  const [promptApplied, setPromptApplied] = useState(false);
  const [negPrompt, setNegPrompt] = useState("");
  // Arranca com as prompts que o ambiente traz, para o painel mostrar o que o
  // motor está mesmo a usar. O motor lê-as do mesmo sítio ao carregar a
  // exposição; escrever aqui sobrepõe-nas via SET_PROMPT_QUADRANT.
  const [promptsQuadrante, setPromptsQuadrante] = useState<Record<string, string>>(
    () => ({ ...(activeExhibition?.engine.streamdiffusion.quadrantPrompts ?? {}) }),
  );
  const [showNegPrompt, setShowNegPrompt] = useState(false);
  // Os parâmetros de geração vêm do ficheiro do ambiente, que é de onde o motor
  // também os lê ao carregar a exposição. Estavam aqui em duro: mudar o
  // `.sen` movia o motor e deixava o painel a mostrar outro número, sem que
  // nada avisasse qual dos dois estava a valer.
  const genDefaults = activeExhibition?.defaults;
  const [seed, setSeed] = useState(genDefaults?.seed ?? 2252004);
  const [lockSeed, setLockSeed] = useState(true);
  const [cfg, setCfg] = useState(genDefaults?.cfg ?? 1.0);
  const [denoising, setDenoising] = useState(genDefaults?.denoising ?? 0.65);
  const [steps, setSteps] = useState(genDefaults?.steps ?? 1);
  // Air Painting. Os valores iniciais espelham os do AirPainter no engine; o
  // limiar é o único que costuma precisar de ajuste, porque o mapa de
  // profundidade é relativo e renormalizado a cada frame.
  const [paintThreshold, setPaintThreshold] = useState(140);
  const [paintSmoothing, setPaintSmoothing] = useState(0.45);
  const [paintColor, setPaintColor] = useState("#7c67ff");
  const [paintEraser, setPaintEraser] = useState(false);
  const [paintColor2, setPaintColor2] = useState("#ffd166");
  const [paintMirror, setPaintMirror] = useState(true);
  const [paintSwapHands, setPaintSwapHands] = useState(false);
  const [paintRequireDepth, setPaintRequireDepth] = useState(false);
  const [paintGestureWidth, setPaintGestureWidth] = useState(true);
  const [paintWidthMin, setPaintWidthMin] = useState(2);
  const [paintWidthMax, setPaintWidthMax] = useState(34);
  /** Guarda o feed composto (câmara + tela) como PNG no Ambiente de Trabalho. */
  const guardarPintura = useCallback(async () => {
    const src = latestData?.image;
    if (!src || !window.electronAPI) return;
    const dataUrl = src.startsWith("data:") ? src : `data:image/jpeg;base64,${src}`;
    const base64 = dataUrl.split(",")[1];
    const destino = await window.electronAPI.showSaveDialog?.({
      defaultPath: "air-painting.jpg",
      filters: [{ name: "Imagem", extensions: ["jpg"] }],
    });
    const caminho = typeof destino === "string" ? destino : destino?.filePath;
    if (caminho) await window.electronAPI.writeBinaryFile?.(caminho, base64);
  }, [latestData]);

  // Fluid AI. A física vive aqui, é enviada à janela de projeção pelo processo
  // principal, e a prompt correspondente segue para o motor no mesmo clique.
  const [fluidPresetId, setFluidPresetId] = useState(PRESET_POR_OMISSAO.id);
  const [fluidPhysics, setFluidPhysics] = useState<FluidPhysics>(PRESET_POR_OMISSAO.physics);
  const [fluidClearSignal, setFluidClearSignal] = useState(0);
  /** Desligado = só a simulação; o StreamDiffusion não recebe nem devolve nada. */
  const [fluidGerar, setFluidGerar] = useState(true);
  const [fluidForca, setFluidForca] = useState(100);
  const [fluidCorrente, setFluidCorrente] = useState(100);
  const pushFluid = useCallback(
    (physics: FluidPhysics, limpar: number, extra?: Partial<{ gerar: boolean; forca: number; corrente: number }>) => {
      window.electronAPI?.setProjectionFluid?.({
        physics,
        limparSinal: limpar,
        gerar: extra?.gerar ?? fluidGerar,
        forca: extra?.forca ?? fluidForca,
        corrente: extra?.corrente ?? fluidCorrente,
      });
    },
    [fluidGerar, fluidForca, fluidCorrente],
  );
  const aplicarPresetFluido = useCallback(
    (preset: (typeof FLUID_PRESETS)[number]) => {
      setFluidPresetId(preset.id);
      setFluidPhysics(preset.physics);
      pushFluid(preset.physics, fluidClearSignal);
      if (window.electronAPI?.sendRPPGCommand) {
        window.electronAPI.sendRPPGCommand(`SET_PROMPT ${preset.prompt}`);
      }
    },
    [pushFluid, fluidClearSignal],
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Expansão de um dos painéis de câmara dentro da janela. Distinto do fullscreen
  // do sistema (tecla F / IPC toggle-fullscreen), que se mantém.
  const [expandedPanel, setExpandedPanel] = useState<null | "left" | "right">(null);

  // O seletor de cor nativo dispara onChange a cada movimento do rato dentro do
  // picker. Sem travão, arrastar enviava centenas de comandos pelo stdin do
  // engine, que não os consome a esse ritmo — o resultado parecia não responder.
  // O estado local muda de imediato (UI fluida); o comando sai ao fim de 120 ms
  // sem alterações.
  const colorCommandTimer = useRef<any>(null);
  const sendColorCommandDebounced = useCallback((cmd: string) => {
    if (colorCommandTimer.current) clearTimeout(colorCommandTimer.current);
    colorCommandTimer.current = setTimeout(() => {
      if (window.electronAPI?.sendRPPGCommand) window.electronAPI.sendRPPGCommand(cmd);
    }, 120);
  }, []);
  useEffect(() => () => { if (colorCommandTimer.current) clearTimeout(colorCommandTimer.current); }, []);

  // Cenário da janela de projeção. A imagem é reduzida antes de seguir por IPC:
  // um ficheiro de câmara moderno passa dos 10 MB e não vale a pena atravessar
  // processos com esse peso só para servir de fundo.
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [bgEnabled, setBgEnabled] = useState(false);
  const [bgName, setBgName] = useState<string>("");
  // "atras" = imagem so como cenario · "efeito" = as ferramentas 3D aplicam-se a imagem
  const [bgMode, setBgMode] = useState<"atras" | "efeito">("atras");
  // Espelhamento da janela de projecao (retroprojecao, espelho, etc.)
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  // Espelho da CÂMARA (≠ espelho da projeção): afeta o que o motor analisa e mostra.
  const [cameraMirror, setCameraMirror] = useState(true);
  // Pós-processamento da imagem gerada, feito na GPU. Os valores iniciais são os
  // mesmos do `upscale_cfg` no motor: 1× (sem ampliar) e nitidez a 0,35.
  const [upscaleFator, setUpscaleFator] = useState(1.0);
  const [upscaleNitidez, setUpscaleNitidez] = useState(0.35);
  const pushFlip = useCallback((h: boolean, v: boolean) => {
    window.electronAPI?.setProjectionFlip?.({ h, v });
  }, []);
  const [calibDistance, setCalibDistance] = useState("60");
  // Calibração por tabuleiro — opcional, recolhida por omissão.
  const [showChessCalib, setShowChessCalib] = useState(false);
  const [chessCols, setChessCols] = useState("9");
  const [chessRows, setChessRows] = useState("6");
  const chessState = latestData?.chess_calib as
    | { estado: string; capturadas: number; alvo: number; mensagem: string }
    | undefined;

  const pushBackground = useCallback((url: string | null, enabled: boolean, modo: "atras" | "efeito") => {
    window.electronAPI?.setProjectionBackground?.({ url, enabled, modo });
  }, []);

  // Reduz para uma dada largura e devolve o data URL JPEG.
  const reduzirImagem = (img: HTMLImageElement, maxW: number, q: number) => {
    const escala = Math.min(1, maxW / img.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", q);
  };

  const handleBackgroundFile = useCallback((file?: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const url = reduzirImagem(img, 1920, 0.85);
        if (!url) return;
        setBgUrl(url);
        setBgName(file.name);
        setBgEnabled(true);
        pushBackground(url, true, bgMode);

        // Para o modo "com efeito" o engine precisa da imagem, mas basta-lhe
        // uma versão pequena: o mapa de profundidade é de baixa resolução e
        // enviar 1920px pelo stdin não traz nada.
        const pequena = reduzirImagem(img, 640, 0.7);
        if (pequena) {
          const semPrefixo = pequena.replace(/^data:image\/\w+;base64,/, "");
          sendCommand(`SET_BG_IMAGE ${semPrefixo}`);
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }, [pushBackground, bgMode]);

  const handleBackgroundToggle = useCallback(() => {
    setBgEnabled((prev) => {
      const next = !prev;
      pushBackground(bgUrl, next, bgMode);
      return next;
    });
  }, [bgUrl, bgMode, pushBackground]);

  const handleBackgroundClear = useCallback(() => {
    setBgUrl(null);
    setBgName("");
    setBgEnabled(false);
    pushBackground(null, false, bgMode);
    sendCommand("CLEAR_BG_IMAGE");
  }, [pushBackground]);
  // No Depth Map Tools não há sensores nem geração musical — só visual e nodes.
  // Isto esconde os separadores; desligá-los no engine é trabalho do Bloco B.
  type TabKey = "visual" | "musica" | "config" | "nodes" | "pintura" | "fluido";
  // Organização pedida: cada ambiente mostra só o que lhe diz respeito, sempre
  // com Configurações e Nodes no fim.
  const separadores = useMemo(
    () =>
      usesAirPainting
        ? [
            { chave: "pintura", rotulo: "Ferramentas" },
            { chave: "config", rotulo: "Configurações" },
            { chave: "nodes", rotulo: "Nodes", emblema: graph.nodes.length },
          ]
        : usesFluid
        ? [
            { chave: "fluido", rotulo: "Visual" },
            { chave: "config", rotulo: "Configurações" },
            { chave: "nodes", rotulo: "Nodes", emblema: graph.nodes.length },
          ]
        : usesDepthMap
        ? [
            { chave: "visual", rotulo: "Visual" },
            { chave: "config", rotulo: "Configurações" },
            { chave: "nodes", rotulo: "Nodes", emblema: graph.nodes.length },
          ]
        : [
            { chave: "visual", rotulo: "Geração visual" },
            { chave: "musica", rotulo: "Musical" },
            { chave: "config", rotulo: "Configurações" },
            { chave: "nodes", rotulo: "Nodes", emblema: graph.nodes.length },
          ],
    [usesAirPainting, usesFluid, usesDepthMap, graph.nodes.length],
  );
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.6);
  const [synthBaseF0, setSynthBaseF0] = useState(130.8);
  const [musicScale, setMusicScale] = useState("auto");
  const [tempoMult, setTempoMult] = useState(1.0);
  const [brightness, setBrightness] = useState(1.0);
  const [voiceAnalysis, setVoiceAnalysis] = useState(true);
  const [voiceVolume, setVoiceVolume] = useState(() => Number(localStorage.getItem("sensus.voiceVolume") ?? 0.7));
  const [showControls, setShowControls] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const logsRef = useRef<any[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const drawIntervalRef = useRef<any>(null);
  const currentImageRef = useRef<string | null>(null);
  const promptFlashTimer = useRef<any>(null);
  // Arranca na fonte de arranque (sempre uma câmara do PC) e não no valor cru
  // do localStorage: "pc" sozinho não corresponde a nenhum `id` da lista
  // (`pc:0`, `phone:<serial>`), e o `<select>` ficava a mostrar uma opção que
  // não era a que estava a valer.
  const [cameraSource, setCameraSource] = useState(cameraDeArranque);
  const [cameraDevices, setCameraDevices] = useState<{ id: string; label: string }[]>([]);
  const [loadingCameras, setLoadingCameras] = useState(true);

  const refreshCameraDevices = useCallback(() => {
    if (!window.electronAPI?.listCameraDevices) {
      setLoadingCameras(false);
      return;
    }
    setLoadingCameras(true);
    window.electronAPI.listCameraDevices().then((res: any) => {
      setCameraDevices(res?.cameras || []);
      setLoadingCameras(false);
    });
  }, []);

  useEffect(() => {
    refreshCameraDevices();
  }, [refreshCameraDevices]);
  // Overlay do feed de parâmetros: sensores biométricos ou mapa de profundidade
  const [overlayMode, setOverlayMode] = useState<"sensors" | "depth">("sensors");

  type SensorKey = "rppg" | "gaze" | "blink" | "symmetry" | "aus" | "pose" | "iris" | "flow" | "presence" | "gesture";
  const toggleSensor = (sensorKey: SensorKey) => {
    setActiveSensors((prev: any) => ({ ...prev, [sensorKey]: !prev[sensorKey] }));
  };

  useEffect(() => {
    // Se o separador ativo não existir neste ambiente, cai no primeiro que existe.
    if (!separadores.some((s) => s.chave === tab)) setTab(separadores[0].chave as TabKey);
  }, [separadores, tab]);

  // Física inicial para a janela de projeção. O processo principal reenvia-a
  // quando essa janela acaba de carregar, por isso basta empurrar uma vez.
  useEffect(() => {
    if (usesFluid) pushFluid(PRESET_POR_OMISSAO.physics, 0);
  }, [usesFluid, pushFluid]);

  useEffect(() => {
    let interval: any = null;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingTime((t) => t + 1);
      }, 1000);
    } else {
      setRecordingTime(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  useEffect(() => {
    if (isRecording && latestData) {
      const timestamp = new Date().toISOString();
      const snapshot = {
        timestamp,
        bpm: latestData.bpm || 0,
        valence: latestData.val || 0,
        arousal: latestData.aro || 0,
        symmetry: latestData.sym !== undefined ? latestData.sym : 1.0,
        blinks: latestData.blinks || 0,
        gaze: latestData.gaze ? `${latestData.gaze[0].toFixed(2)};${latestData.gaze[1].toFixed(2)}` : "0;0",
      };
      logsRef.current.push(snapshot);
    }
  }, [isRecording, latestData]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Mantém a última imagem (IA ou câmara) para capturar no vídeo
  useEffect(() => {
    const src = latestData?.image_ia || latestData?.image;
    currentImageRef.current = src ? (src.startsWith("data:") ? src : `data:image/jpeg;base64,${src}`) : null;
  }, [latestData]);

  // Captura de vídeo da projeção via canvas.captureStream + MediaRecorder
  const startVideoCapture = () => {
    try {
      if (typeof MediaRecorder === "undefined") return;
      const canvas = document.createElement("canvas");
      canvas.width = 640; canvas.height = 640;
      const ctx = canvas.getContext("2d");
      const img = new Image();
      drawIntervalRef.current = setInterval(() => {
        const src = currentImageRef.current;
        if (src && ctx) { img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height); img.src = src; }
      }, 66);
      const stream = canvas.captureStream(15);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
      const mr = new MediaRecorder(stream, { mimeType: mime });
      videoChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) videoChunksRef.current.push(e.data); };
      mr.onstop = () => { void saveVideoToDesktop(); };
      mr.start();
      mediaRecorderRef.current = mr;
    } catch (e) {
      console.error("Falha ao iniciar captura de vídeo:", e);
    }
  };

  const saveVideoToDesktop = async () => {
    if (drawIntervalRef.current) { clearInterval(drawIntervalRef.current); drawIntervalRef.current = null; }
    if (videoChunksRef.current.length === 0) return;
    const blob = new Blob(videoChunksRef.current, { type: "video/webm" });
    const base64 = await new Promise<string>((res) => { const r = new FileReader(); r.onloadend = () => res(r.result as string); r.readAsDataURL(blob); });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `Sensus_Session_${ts}.webm`;
    if (window.electronAPI?.getDesktopPath && window.electronAPI?.writeBinaryFile) {
      try {
        const desktop = await window.electronAPI.getDesktopPath();
        const filePath = `${desktop}\\${fileName}`;
        await window.electronAPI.writeBinaryFile(filePath, base64);
        // Regista na lista de vídeos da monitorização
        const raw = localStorage.getItem("sensus-recorded-videos") || "[]";
        const list = JSON.parse(raw);
        list.unshift({ id: Date.now(), name: fileName, path: filePath, date: new Date().toISOString() });
        localStorage.setItem("sensus-recorded-videos", JSON.stringify(list));
      } catch (e) { console.error("Falha ao guardar vídeo:", e); }
    }
  };

  const handleToggleRecord = async () => {
    if (!isRecording) {
      logsRef.current = [];
      setIsRecording(true);
      startVideoCapture();
    } else {
      setIsRecording(false);
      // Para a captura de vídeo (o vídeo é guardado no Desktop no evento onstop)
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      // Guarda o registo biométrico CSV automaticamente no Desktop
      if (logsRef.current.length > 0 && window.electronAPI?.getDesktopPath) {
        try {
          const headers = "Timestamp,BPM,Valence,Arousal,Symmetry,Blinks,Gaze\n";
          const rows = logsRef.current
            .map((log) => `${log.timestamp},${log.bpm},${log.valence},${log.arousal},${log.symmetry},${log.blinks},${log.gaze}`)
            .join("\n");
          const desktop = await window.electronAPI.getDesktopPath();
          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          window.electronAPI.writeCSV(`${desktop}\\Sensus_Session_${ts}.csv`, headers + rows);
        } catch (err) {
          console.error(err);
        }
      }
    }
  };

  const handleToggleOverlayMode = () => {
    const next = overlayMode === "depth" ? "sensors" : "depth";
    setOverlayMode(next);
    sendCommand(`SET_OVERLAY_MODE ${next}`);
  };

  // A fonte que o MOTOR está mesmo a usar, e o porquê se não for a pedida. O
  // motor recorre sozinho à câmara do PC quando o telemóvel não entrega imagem
  // (autorização de espelhamento recusada, ecrã bloqueado, cabo solto), e sem
  // isto o painel continuava a mostrar o telemóvel escolhido enquanto a imagem
  // vinha de outro sítio — a única pista era uma linha de stderr que ninguém lê.
  const cameraEmUso: string | undefined = latestData?.camera?.fonte || undefined;
  const cameraErro: string | undefined = latestData?.camera?.erro || undefined;
  useEffect(() => {
    if (cameraEmUso && cameraEmUso !== "simulacao") setCameraSource(cameraEmUso);
  }, [cameraEmUso]);

  const handleCameraSourceChange = (source: string) => {
    setCameraSource(source);
    // Só as câmaras do PC ficam memorizadas — ver `cameraSource.ts`. Escolher o
    // telemóvel vale para esta sessão; o arranque seguinte volta ao PC.
    guardarCamera(source);
    sendCommand(`SET_CAMERA_SOURCE ${source}`);
  };

  // Derive image sources — handle both raw base64 and data-URI prefixed strings
  const cameraImage = latestData?.image
    ? (latestData.image.startsWith("data:") ? latestData.image : `data:image/jpeg;base64,${latestData.image}`)
    : null;
  const rawImage = latestData?.image_raw
    ? (latestData.image_raw.startsWith("data:") ? latestData.image_raw : `data:image/jpeg;base64,${latestData.image_raw}`)
    : null;
  const depthMapUrl = useMapaProfundidade(latestData?.depth_map);
  const music = latestData?.music || {};
  // Leitura ao vivo do Air Painting (posição do dedo, profundidade amostrada,
  // se está a pintar). Ausente nos ambientes que não o usam.
  const paintInfo = latestData?.paint;
  // Quadrante de Russell decidido pelo MOTOR, e não recalculado aqui. O motor
  // aplica histerese e um tempo mínimo de permanência (ver quadrante_russell),
  // por isso repetir as fronteiras nuas nesta ponta realçava um quadrante
  // diferente daquele cuja prompt estava efetivamente a alimentar a geração.
  // O cálculo local fica só como recurso para telemetria antiga, sem o campo.
  const quadranteAtivo: string =
    latestData?.quadrante ||
    ((latestData?.aro ?? 0.5) >= 0.5
      ? (latestData?.val ?? 0) >= 0
        ? "ativado_positivo"
        : "ativado_negativo"
      : (latestData?.val ?? 0) >= 0
      ? "calmo_positivo"
      : "calmo_negativo");
  const rotuloQuadranteAtivo =
    QUADRANTES_RUSSELL.find((q) => q.chave === quadranteAtivo)?.rotulo ?? "—";

  // Sync state values to Python process using window.electronAPI
  const sendCommand = (cmd: string) => {
    if (window.electronAPI) {
      window.electronAPI.sendRPPGCommand(cmd);
    }
  };

  // Prompt: aplica-se explicitamente (Enter ou botão) com confirmação visual
  const handlePromptSubmit = () => {
    sendCommand(`SET_PROMPT ${promptDraft}`);
    setPromptApplied(true);
    if (promptFlashTimer.current) clearTimeout(promptFlashTimer.current);
    promptFlashTimer.current = setTimeout(() => setPromptApplied(false), 1800);
  };

  const handleNegPromptChange = (val: string) => {
    setNegPrompt(val);
    sendCommand(`SET_NEGATIVE_PROMPT ${val}`);
  };

  const handleRandomizeSeed = () => {
    if (!lockSeed) {
      const newSeed = Math.floor(Math.random() * 9999999);
      setSeed(newSeed);
      sendCommand(`SET_SEED ${newSeed}`);
    }
  };

  const handleToggleSeedLock = () => {
    const next = !lockSeed;
    setLockSeed(next);
    if (!next) {
      const newSeed = Math.floor(Math.random() * 9999999);
      setSeed(newSeed);
      sendCommand(`SET_SEED ${newSeed}`);
    }
  };

  // Parâmetros SD: estado local durante o drag, comando só no fim (onValueCommit)
  const handleCfgChange = (val: number[]) => setCfg(val[0]);
  const handleCfgCommit = (val: number[]) => sendCommand(`SET_CFG ${val[0].toFixed(2)}`);
  const handleDenoisingChange = (val: number[]) => setDenoising(val[0]);
  const handleDenoisingCommit = (val: number[]) => sendCommand(`SET_DENOISING ${val[0].toFixed(2)}`);
  const handleStepsChange = (val: number[]) => setSteps(val[0]);
  const handleStepsCommit = (val: number[]) => sendCommand(`SET_STEPS ${val[0]}`);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (window.electronAPI) {
      window.electronAPI.toggleFullscreen();
    } else {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
    setIsFullscreen((p) => !p);
  }, []);

  useEffect(() => {
    const onFSChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFSChange);
    return () => document.removeEventListener("fullscreenchange", onFSChange);
  }, []);

  // Mute explícito do utilizador — o stream de áudio continua vivo no engine
  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    sendCommand(`SET_SYNTH_ACTIVE ${next ? 1 : 0}`);
  };

  const handleVolumeChange = (val: number[]) => {
    const v = val[0];
    setSoundVolume(v);
    sendCommand(`SET_SYNTH_VOLUME ${v.toFixed(2)}`);
  };

  const handleSynthBaseF0Change = (val: number[]) => {
    const v = val[0];
    setSynthBaseF0(v);
    sendCommand(`SET_SYNTH_BASE_F0 ${v.toFixed(1)}`);
  };

  const handleScaleChange = (v: string) => {
    setMusicScale(v);
    sendCommand(`SET_SCALE ${v}`);
  };

  const handleTempoChange = (val: number[]) => {
    const v = val[0];
    setTempoMult(v);
    sendCommand(`SET_TEMPO ${v.toFixed(2)}`);
  };

  const handleBrightnessChange = (val: number[]) => {
    const v = val[0];
    setBrightness(v);
    sendCommand(`SET_BRIGHTNESS ${v.toFixed(2)}`);
  };

  const handleVoiceAnalysisToggle = () => {
    const next = !voiceAnalysis;
    setVoiceAnalysis(next);
    sendCommand(`SET_VOICE_ANALYSIS ${next ? 1 : 0}`);
  };

  const handleVoiceVolumeChange = (val: number[]) => {
    const v = val[0];
    setVoiceVolume(v);
    // O TTS toca no renderer (Piper → <audio> no AssistantPage), não no motor Python,
    // por isso o volume viaja por localStorage e não por comando de stdin.
    localStorage.setItem("sensus.voiceVolume", String(v));
  };

  // ── Controlo isolado das 5 camadas do motor generativo multicamada ──
  const setLayerVol = (key: string, v: number) => {
    setLayers((p) => ({ ...p, [key]: { ...p[key], vol: v } }));
    sendCommand(`SET_VOLUME_${key.toUpperCase()} ${v.toFixed(2)}`);
  };
  const toggleLayer = (key: string) => {
    setLayers((p) => {
      const on = !p[key].on;
      sendCommand(`TOGGLE_${key.toUpperCase()} ${on ? 1 : 0}`);
      return { ...p, [key]: { ...p[key], on } };
    });
  };
  const LAYER_LABELS: Record<string, string> = {
    melodia: "Melodia", piano: "Piano", coro: "Coro", tabla: "Tabla", percussao: "Percussão",
  };

  // Keyboard: F for fullscreen, H to toggle controls, M for mute
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "f" || e.key === "F") toggleFullscreen();
      if (e.key === "h" || e.key === "H") setShowControls((p) => !p);
      if (e.key === "m" || e.key === "M") handleToggleSound();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen, soundEnabled]);

  const sdStatus = latestData?.sd_status;
  // Mensagem da falha de carregamento do motor de geracao. Sem ela, um erro
  // era indistinguivel de um carregamento lento: os dois mostravam so um
  // rodopio e a palavra "a carregar".
  const sdErro: string | undefined = latestData?.sd_erro;
  const SENSOR_DEFS: { key: SensorKey; label: string; tip: string }[] = [
    { key: "rppg", label: "rPPG / BPM", tip: "Frequência cardíaca estimada por fotopletismografia remota (variações de cor da pele na câmara)." },
    { key: "gaze", label: "Gaze Tracking", tip: "Direção do olhar e tempo de fixação por quadrante, a partir dos landmarks oculares." },
    { key: "blink", label: "Piscadas (EAR)", tip: "Deteção de piscadas pelo Eye Aspect Ratio; conta piscadas ao longo da sessão." },
    { key: "symmetry", label: "Simetria Facial", tip: "Índice de simetria entre os dois lados do rosto (0–1)." },
    { key: "aus", label: "Action Units", tip: "Painel com as 13 Action Units (FACS) desenhado no feed de parâmetros — barras e valores em tempo real." },
    { key: "pose", label: "Pose / Ocular", tip: "Secção com pitch/yaw/roll da cabeça, EAR, raio da íris, gaze e fixação no feed de parâmetros." },
    { key: "iris", label: "Íris + Vetor Gaze", tip: "Círculos nos centros das íris e seta com a direção do olhar desenhados sobre o rosto." },
    { key: "flow", label: "Fluxo Ótico da Sala", tip: "Energia e direção dominante do movimento coletivo no espaço, por fluxo ótico global — funciona sem rosto detetado." },
    { key: "presence", label: "Presença Multi-Pessoa", tip: "Contagem e posição (x,y) de visitantes; o tamanho da face detetada serve de proxy de proximidade." },
    { key: "gesture", label: "Gestos de Corpo", tip: "Braços abertos e agachamento via pose corporal (1 pessoa). Custo de CPU adicional — desligado por defeito." },
  ];

  return (
    /* Coluna: câmaras em cima, painel de parâmetros em baixo. Antes as câmaras
       ocupavam o ecrã inteiro e o painel flutuava por cima delas — arrastá-lo
       para o lado nenhum resolvia, tapava sempre uma das duas. Agora cada um
       tem o seu espaço e a pega do painel decide como se reparte. */
    <div className="sensus-brand relative flex h-screen w-screen flex-col overflow-hidden text-foreground dark select-none" style={{ background: "var(--brand-bg)" }}>
      {/* Saudação: enquanto o motor espera pelo aceno, tapa tudo. Sai sozinha
          quando a telemetria deixar de a mandar — quem decide é o motor. */}
      {saudacaoVisivel && (
        <SaudacaoAceno
          progresso={saudacaoAtiva ? latestData?.saudacao?.progresso ?? 0 : 1}
          lang={lang}
        />
      )}
      {/* Barra ancorada no topo. Era um par de grupos absolutos por cima do
          vídeo; agora ocupa a sua própria faixa, para nada da interface ficar
          em cima das câmaras. */}
      <div
        className="relative z-20 flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-2.5"
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "linear-gradient(180deg, rgba(21,27,44,0.97) 0%, rgba(9,12,22,0.99) 100%)",
        }}
      >
        {/* Telemetria ao vivo */}
        <div className="flex min-w-0 items-center gap-3">
          {latestData && (
            <div className="flex items-center gap-2.5 rounded-lg bg-background/50 border border-border/40 px-3 py-1.5 backdrop-blur-xl">
              <span className="relative inline-flex size-2 rounded-full bg-positive" />
              <span className="text-[10px] font-bold text-foreground tracking-wider uppercase">
                {latestData.bpm > 0 ? `${Math.round(latestData.bpm)} BPM` : "-- BPM"}
              </span>
              <span className="text-[9px] text-muted-foreground">
                {latestData.dom && latestData.dom !== "—" ? latestData.dom : "Neutro"}
              </span>
              <span className="text-[9px] text-muted-foreground">
                {latestData.fps || 0} FPS
              </span>
            </div>
          )}
        </div>
        {/* Ações: Record + Som + Volume + Fullscreen + Painel + Fechar */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleRecord}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 backdrop-blur-xl text-xs transition-all ${
              isRecording
                ? "bg-rose-500/25 border-rose-500/50 text-rose-200 glow-rose-500 hover:bg-rose-500/30"
                : "bg-background/50 border-border/40 text-muted-foreground hover:text-foreground hover:bg-background/70"
            }`}
            title={isRecording ? "Parar Gravação" : "Iniciar Gravação da Sessão"}
          >
            <span className={`size-2 rounded-full bg-rose-500 ${isRecording ? "mov-respira" : ""}`} />
            <span className="text-[9px] font-medium uppercase tracking-wider">
              {isRecording ? `REC ${formatTime(recordingTime)}` : "Record"}
            </span>
          </button>

          {!usesDepthMap && (
            <button
              onClick={handleToggleOverlayMode}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 backdrop-blur-xl text-xs transition-all ${
                overlayMode === "depth"
                  ? "bg-primary/25 border-primary/50 text-white hover:bg-primary/30"
                  : "bg-background/50 border-border/40 text-muted-foreground hover:text-foreground hover:bg-background/70"
              }`}
              title={overlayMode === "depth" ? "Voltar ao overlay de sensores" : "Ver mapa de profundidade (Depth Anything V2)"}
            >
              <Layers className={`size-3.5 ${overlayMode === "depth" ? "text-primary" : ""}`} />
              <span className="text-[9px] font-medium uppercase tracking-wider">
                {overlayMode === "depth" ? "Sensores" : "Depth"}
              </span>
            </button>
          )}

          <button
            onClick={handleToggleSound}
            className="flex items-center gap-1.5 rounded-lg bg-background/50 border border-border/40 px-2.5 py-1.5 backdrop-blur-xl text-xs text-muted-foreground hover:text-foreground hover:bg-background/70 transition-all"
            title={soundEnabled ? "Silenciar Som (M)" : "Ativar Som (M)"}
          >
            {soundEnabled ? <Volume2 className="size-3.5 text-primary" /> : <VolumeX className="size-3.5" />}
            <span className="text-[9px] font-medium uppercase tracking-wider">{soundEnabled ? "Som" : "Mudo"}</span>
          </button>

          {soundEnabled && (
            <div className="flex items-center gap-1.5 rounded-lg bg-background/50 border border-border/40 px-2.5 py-1.5 backdrop-blur-xl w-28">
              <Music className="size-3 text-primary/70 shrink-0" />
              <Slider
                value={[soundVolume]}
                onValueChange={handleVolumeChange}
                min={0}
                max={1}
                step={0.05}
                className="py-0 cursor-pointer"
              />
            </div>
          )}

          <button
            onClick={toggleFullscreen}
            className="flex items-center gap-1.5 rounded-lg bg-background/50 border border-border/40 px-2.5 py-1.5 backdrop-blur-xl text-xs text-muted-foreground hover:text-foreground hover:bg-background/70 transition-all"
            title={isFullscreen ? "Sair de Ecrã Inteiro (F)" : "Ecrã Inteiro (F)"}
          >
            {isFullscreen ? <Minimize className="size-3.5" /> : <Maximize className="size-3.5" />}
            <span className="text-[9px] font-medium uppercase tracking-wider">{isFullscreen ? "Sair" : "Ecrã Inteiro"}</span>
          </button>

          <button
            onClick={() => setShowControls((p) => !p)}
            className="flex items-center gap-1.5 rounded-lg bg-background/50 border border-border/40 px-2.5 py-1.5 backdrop-blur-xl text-xs text-muted-foreground hover:text-foreground hover:bg-background/70 transition-all"
            title="Mostrar/Esconder Controlos (H)"
          >
            <Sliders className="size-3.5" />
            <span className="text-[9px] font-medium uppercase tracking-wider">{showControls ? "Esconder" : "Mostrar"}</span>
          </button>

          <button
            onClick={() => window.close()}
            className="flex items-center gap-1.5 rounded-lg bg-rose-500/20 border border-rose-500/40 px-2.5 py-1.5 backdrop-blur-xl text-xs text-rose-200 hover:bg-rose-500/30 hover:text-white transition-all"
            title="Fechar Ambiente Virtual"
          >
            <X className="size-3.5" />
            <span className="text-[9px] font-medium uppercase tracking-wider">Fechar</span>
          </button>
        </div>
      </div>

      {/* Câmara original + câmara de parâmetros, lado a lado */}
      <div
        className={`relative z-0 grid min-h-0 flex-1 ${expandedPanel ? "grid-cols-1" : "grid-cols-2"}`}
        style={{ background: "var(--brand-bg)" }}
      >
        {expandedPanel !== "right" && (
          <ExpandablePanel
            label="Câmara Original"
            expanded={expandedPanel === "left"}
            onToggle={() => setExpandedPanel((p) => (p === "left" ? null : "left"))}
            className="border-r border-white/10"
          >
            {rawImage ? (
              <img src={rawImage} alt="Câmara original" className="h-full w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-3 px-4 text-center">
                <span className="relative flex size-3">
                  <span className="relative inline-flex size-3 rounded-full bg-rose-500" />
                </span>
                <span className="text-xs" style={{ color: "var(--brand-text-muted)" }}>
                  A aguardar sinal de vídeo
                </span>
              </div>
            )}

          </ExpandablePanel>
        )}

        {expandedPanel !== "left" && (
          <ExpandablePanel
            label={
              usesDepthMap
                ? "Depth Map Tools"
                : overlayMode === "depth"
                ? "Mapa de Profundidade"
                : "Parâmetros Biométricos"
            }
            expanded={expandedPanel === "right"}
            onToggle={() => setExpandedPanel((p) => (p === "right" ? null : "right"))}
          >
            {usesDepthMap ? (
              /* Depth Map Tools: aqui mostra-se o mapa de profundidade da câmara
                 (Depth Anything V2). As ferramentas 3D vivem na segunda janela. */
              depthMapUrl ? (
                <img
                  src={depthMapUrl}
                  alt="Mapa de profundidade"
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 px-4 text-center">
                  <Loader2 className="size-4 animate-spin" style={{ color: "var(--brand-primary)" }} />
                  <span className="text-xs" style={{ color: "var(--brand-text-muted)" }}>
                    A carregar o modelo de profundidade
                  </span>
                  <span
                    className="text-[10px]"
                    style={{ color: "var(--brand-text-muted)", opacity: 0.6 }}
                  >
                    Demora cerca de 30 segundos na primeira vez
                  </span>
                </div>
              )
            ) : cameraImage ? (
              <>
                <img
                  src={cameraImage}
                  alt={overlayMode === "depth" ? "Mapa de profundidade" : "Parâmetros biométricos"}
                  className="h-full w-full object-contain"
                />
                {/* Os valores deixaram de ser gravados na imagem pelo motor e passaram
                    a ser desenhados aqui, a partir da mesma telemetria. No modo
                    profundidade o feed é o mapa, onde não fazem sentido. */}
                {overlayMode !== "depth" && (
                  <BiometricPanel latestData={latestData} sensores={activeSensors} />
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 px-4 text-center">
                <span className="text-xs" style={{ color: "var(--brand-text-muted)" }}>
                  Parâmetros Biométricos
                </span>
                <span
                  className="text-[10px]"
                  style={{ color: "var(--brand-text-muted)", opacity: 0.6 }}
                >
                  AUs, pose, EAR, íris e gaze em tempo real
                </span>
              </div>
            )}

            {(usesDepthMap || overlayMode === "depth") &&
              latestData?.depth_status &&
              latestData.depth_status !== "ready" && (
                <span
                  className="absolute right-14 top-3 flex items-center gap-1.5 rounded-sm px-2 py-1 text-[10px] backdrop-blur-sm"
                  style={{
                    background: "rgba(8,11,22,0.55)",
                    color: "var(--brand-text-muted)",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  {latestData.depth_status === "erro" ? (
                    <>Depth indisponível</>
                  ) : (
                    <>
                      <Loader2 className="size-2.5 animate-spin text-amber-400" /> A carregar modelo
                    </>
                  )}
                </span>
              )}
          </ExpandablePanel>
        )}
      </div>

      {/* Painel de parâmetros — arrastável, colapsável, por ambiente */}
      {showControls && (
        <PainelParametros
          separadores={separadores}
          ativo={tab}
          onAtivo={(k) => setTab(k as TabKey)}
          idPersistencia={activeExhibition?.id ?? "omissao"}
          titulo={activeExhibition?.name}
          estado={
            sdStatus && usesStreamDiffusion ? (
              <span
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[9px]"
                title={sdErro ? `Motor de geração: ${sdErro}` : undefined}
                style={{
                  background:
                    sdStatus === "ready"
                      ? "rgba(166,232,217,0.10)"
                      : sdStatus === "erro"
                      ? "rgba(244,63,94,0.14)"
                      : "rgba(255,255,255,0.05)",
                  border: `1px solid ${
                    sdStatus === "ready"
                      ? "rgba(166,232,217,0.28)"
                      : sdStatus === "erro"
                      ? "rgba(244,63,94,0.38)"
                      : "rgba(255,255,255,0.08)"
                  }`,
                  color: sdStatus === "erro" ? "#ffb4bf" : "var(--brand-text-muted)",
                }}
              >
                {sdStatus === "ready" ? (
                  <span className="size-1.5 rounded-full bg-positive" />
                ) : sdStatus === "erro" ? (
                  <span className="size-1.5 rounded-full bg-rose-500" />
                ) : (
                  <Loader2 className="size-2.5 animate-spin text-amber-400" />
                )}
                {sdStatus === "ready" ? "Motor IA pronto" : sdStatus === "erro" ? "Motor IA indisponível" : "Motor IA a carregar"}
              </span>
            ) : null
          }
        >
          <div>
            {/* ── Separador: GERAÇÃO VISUAL ── */}
            {tab === "visual" && (
              <div className="flex flex-col gap-2.5">
                {/* Espelhamento do ecrã de projeção — comum aos dois ambientes.
                    Necessário em retroprojeção ou projeção contra espelho, onde a
                    imagem chega invertida ao público. Fechado por omissão: acerta-se
                    uma vez na montagem da sala e não se volta lá durante a peça. */}
                <SecaoColapsavel
                  titulo="Projeção e câmara"
                  resumo={`projeção ${flipH || flipV ? "espelhada" : "direta"} · câmara ${cameraMirror ? "espelhada" : "direta"}`}
                  dica={<InfoTip text="Como a imagem chega ao público e como a câmara se vê a si própria. Nenhum dos dois altera a análise biométrica." />}
                >
                  <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                    <div className="flex flex-col gap-1.5">
                      <SliderLabel tip="Inverte o ecrã de projeção. Usa-se em retroprojeção (projetar por trás de uma tela) ou quando se projeta contra um espelho, situações em que a imagem chega invertida ao público. Não afeta a análise biométrica nem o mapa de profundidade.">
                        Espelhar projeção
                      </SliderLabel>
                      <div className="flex items-center gap-2">
                        {([
                          ["h", "Horizontal", flipH, setFlipH] as const,
                          ["v", "Vertical", flipV, setFlipV] as const,
                        ]).map(([eixo, label, valor, setter]) => (
                          <button
                            key={eixo}
                            type="button"
                            onClick={() => {
                              const novo = !valor;
                              setter(novo);
                              pushFlip(eixo === "h" ? novo : flipH, eixo === "v" ? novo : flipV);
                            }}
                            className="flex h-8 items-center gap-2 rounded-lg border px-3 text-[11px] transition-colors"
                            style={{
                              borderColor: valor ? "rgba(124,103,255,0.55)" : "rgba(255,255,255,0.10)",
                              color: valor ? "var(--brand-text)" : "var(--brand-text-muted)",
                              background: valor ? "rgba(124,103,255,0.14)" : "transparent",
                            }}
                          >
                            <span
                              className="size-1.5 rounded-full"
                              style={{ background: valor ? "var(--brand-primary)" : "rgba(255,255,255,0.22)" }}
                            />
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Espelho da CÂMARA — coisa diferente do espelho da projeção acima:
                        este muda o feed que o motor analisa e mostra, não o ecrã. */}
                    <div className="flex flex-col gap-1.5">
                      <SliderLabel tip="A webcam entrega a cena como a vê, não como um espelho. Espelhada, quem está à frente vê-se como num espelho — é o que se quer na maioria das sessões. Desligar quando a câmara filma o público de frente.">
                        Espelhar câmara
                      </SliderLabel>
                      <button
                        type="button"
                        onClick={() => {
                          const novo = !cameraMirror;
                          setCameraMirror(novo);
                          sendCommand(`SET_CAMERA_MIRROR ${novo ? 1 : 0}`);
                        }}
                        className="flex h-8 items-center gap-2 rounded-lg border px-3 text-[11px] transition-colors"
                        style={{
                          borderColor: cameraMirror ? "rgba(124,103,255,0.55)" : "rgba(255,255,255,0.10)",
                          color: cameraMirror ? "var(--brand-text)" : "var(--brand-text-muted)",
                          background: cameraMirror ? "rgba(124,103,255,0.14)" : "transparent",
                        }}
                      >
                        <FlipHorizontal className="size-3.5" />
                        {cameraMirror ? "Espelhada" : "Direta"}
                      </button>
                    </div>
                  </div>
                </SecaoColapsavel>


              {usesStreamDiffusion ? (
              <>
                <SecaoColapsavel
                  titulo="Prompt"
                  abertaPorOmissao
                  resumo={promptDraft.slice(0, 42) + (promptDraft.length > 42 ? "…" : "")}
                  dica={<InfoTip text="Descrição do ambiente visual gerado e termos a evitar." />}
                >
                <div className="flex flex-col gap-1.5">
                  <SliderLabel tip="Descrição do ambiente visual gerado (StreamDiffusion img2img). O BPM medido é injetado automaticamente no prompt. Enter ou o botão aplicam a nova prompt.">
                    Prompt Ativo
                  </SliderLabel>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Input
                        value={promptDraft}
                        onChange={(e) => setPromptDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handlePromptSubmit(); }}
                        className="w-full rounded-xl border-border/80 bg-secondary/40 text-xs py-2 pr-9"
                        placeholder="Descrição da imagem que deseja gerar... (Enter para aplicar)"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNegPrompt(!showNegPrompt)}
                        title="Prompt negativo"
                        className={`absolute right-2.5 top-1/2 -translate-y-1/2 flex size-5 items-center justify-center rounded-md transition-colors ${
                          showNegPrompt ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-secondary/80"
                        }`}
                      >
                        {showNegPrompt ? <Minus className="size-3" /> : <Plus className="size-3" />}
                      </button>
                    </div>
                    {/* Indicador visual de submissão da prompt */}
                    <Button
                      onClick={handlePromptSubmit}
                      className={`h-9 rounded-xl px-3.5 text-xs transition-all ${
                        promptApplied
                          ? "bg-emerald-500/90 hover:bg-emerald-500 text-white"
                          : "bg-primary hover:bg-primary/90 text-white"
                      }`}
                    >
                      {promptApplied ? (
                        <span className="flex items-center gap-1.5"><Check className="size-3.5" /> Aplicada</span>
                      ) : (
                        <span className="flex items-center gap-1.5"><Send className="size-3.5" /> Aplicar</span>
                      )}
                    </Button>
                  </div>
                </div>

                {showNegPrompt && (
                  <div className="flex flex-col gap-1.5 animate-in slide-in-from-top-1 duration-150">
                    <span className="text-[11px] text-red-400/90 font-semibold">
                      Prompt Negativo (-)
                    </span>
                    <Input
                      value={negPrompt}
                      onChange={(e) => handleNegPromptChange(e.target.value)}
                      className="w-full rounded-xl border-red-500/20 bg-secondary/40 text-xs py-1.5"
                      placeholder="Evitar estes termos (ex: blur, low quality, distortion)..."
                    />
                  </div>
                )}
                </SecaoColapsavel>

                {/* O plano de Russell estava sobreposto ao feed da câmara, a tapar
                    justamente a parte que se quer ver. Passou para aqui, encostado
                    às prompts que ele comanda: o quadrante realçado no plano é o
                    mesmo que está a alimentar a geração. */}
                <SecaoColapsavel
                  titulo="Estado emocional e prompts por quadrante"
                  abertaPorOmissao={russellNoPainel}
                  resumo={`${rotuloQuadranteAtivo} · ${Object.values(promptsQuadrante).filter(Boolean).length}/4 preenchidas`}
                  dica={<InfoTip text="Plano circumplexo de Russell (1980) com o estado medido em tempo real, e uma prompt por quadrante. Assim que o estado entra num quadrante, a geração passa a usar a prompt desse quadrante. Deixar em branco = usa a prompt única acima." />}
                >
                  {/* Flex com largura fixa no plano, e não um grid com `lg:`: o
                      painel tem largura própria (até 1024 px) e não acompanha a
                      do ecrã, por isso um breakpoint de viewport punha o plano a
                      ocupar a linha inteira em janelas estreitas — um quadrado
                      gigante com as legendas a condizer. */}
                  <div className="flex flex-wrap items-start gap-4">
                    {russellNoPainel && (
                      <div className="w-full max-w-[212px] shrink-0 sm:w-[212px]">
                        <RussellPlot
                          val={latestData?.val}
                          aro={latestData?.aro}
                          variante="painel"
                          quadranteAtivo={quadranteAtivo}
                          componentes={latestData?.aro_comp}
                        />
                      </div>
                    )}

                    <div className="flex min-w-[260px] flex-1 flex-col gap-2.5">
                      <p className="text-[11px] leading-relaxed" style={{ color: "var(--brand-text-muted)" }}>
                        O quadrante ativo está assinalado. Em branco, cai na prompt única.
                      </p>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {QUADRANTES_RUSSELL.map(({ chave, rotulo, nota }) => {
                          const ativo = quadranteAtivo === chave;
                          return (
                            <div
                              key={chave}
                              className="flex flex-col gap-1.5 rounded-lg p-2.5 transition-colors"
                              style={{
                                background: ativo ? "rgba(124,103,255,0.10)" : "rgba(255,255,255,0.025)",
                                border: `1px solid ${ativo ? "rgba(124,103,255,0.42)" : "rgba(255,255,255,0.06)"}`,
                              }}
                            >
                              <span className="flex items-center gap-1.5 text-[11px] leading-tight">
                                <span
                                  className="size-1.5 shrink-0 rounded-full"
                                  style={{
                                    background: ativo ? "#7c67ff" : "rgba(255,255,255,0.2)",
                                    boxShadow: ativo ? "0 0 8px rgba(124,103,255,0.8)" : "none",
                                  }}
                                />
                                <strong style={{ color: ativo ? "#c9bfff" : "var(--brand-text)" }}>{rotulo}</strong>
                                <span className="truncate" style={{ color: "var(--brand-text-muted)" }}>
                                  — {nota}
                                </span>
                              </span>
                              <Input
                                value={promptsQuadrante[chave] ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setPromptsQuadrante((p) => ({ ...p, [chave]: v }));
                                }}
                                onBlur={(e) => sendCommand(`SET_PROMPT_QUADRANT ${chave} ${e.target.value}`)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    sendCommand(`SET_PROMPT_QUADRANT ${chave} ${(e.target as HTMLInputElement).value}`);
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                placeholder="Em branco = prompt única"
                                className="w-full text-xs"
                                style={{ borderColor: ativo ? "rgba(124,103,255,0.55)" : undefined }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </SecaoColapsavel>

                <SecaoColapsavel
                  titulo="Parâmetros de geração"
                  resumo={`${steps} ${steps === 1 ? "passo" : "passos"} · guidance ${cfg.toFixed(1)} · seed ${seed}`}
                  dica={<InfoTip text="Passos, guidance, denoising e semente do StreamDiffusion." />}
                >
                <div className="painel-sensus-campos">
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Passos de denoising por frame. Mais passos = mais detalhe, menos fluidez (o custo cresce de forma proporcional). O SD-Turbo foi desenhado para poucos passos." valor={steps}>
                      Steps
                    </SliderLabel>
                    <Slider
                      value={[steps]}
                      onValueChange={handleStepsChange}
                      onValueCommit={handleStepsCommit}
                      min={1}
                      max={2}
                      step={1}
                      className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Força com que a imagem segue o prompt (CFG). Perto de 1 = mais natural; valores altos saturam a imagem em modelos Turbo." valor={cfg.toFixed(1)}>
                      Guidance
                    </SliderLabel>
                    <Slider
                      value={[cfg]}
                      onValueChange={handleCfgChange}
                      onValueCommit={handleCfgCommit}
                      min={1.0}
                      max={15.0}
                      step={0.1}
                      className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Quanto da imagem da câmara é transformada. Baixo = fiel à câmara; alto = mais abstrato/criativo." valor={denoising.toFixed(2)}>
                      Denoising
                    </SliderLabel>
                    <Slider
                      value={[denoising]}
                      onValueChange={handleDenoisingChange}
                      onValueCommit={handleDenoisingCommit}
                      min={0.05}
                      max={1.0}
                      step={0.05}
                      className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Semente do ruído inicial — fixa a identidade visual da geração. Bloqueada mantém o padrão estável; o dado gera uma nova." valor={seed}>
                      Seed
                    </SliderLabel>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        disabled={lockSeed}
                        value={seed}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          setSeed(val);
                          sendCommand(`SET_SEED ${val}`);
                        }}
                        className="h-7 text-[11px] rounded-lg border-border/80 bg-secondary/30 w-full"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleToggleSeedLock}
                        className="h-7 w-7 rounded-lg border border-border/80 text-muted-foreground"
                      >
                        {lockSeed ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={lockSeed}
                        onClick={handleRandomizeSeed}
                        className="h-7 w-7 rounded-lg border border-border/80 text-muted-foreground"
                      >
                        <RefreshCw className="size-3" />
                      </Button>
                    </div>
                  </div>
                </div>
                </SecaoColapsavel>

                <SecaoColapsavel
                  titulo="Resolução e nitidez"
                  resumo={`${Math.round(512 * upscaleFator)}px · nitidez ${upscaleNitidez.toFixed(2)}`}
                  dica={<InfoTip text="Ampliação e realce de contorno aplicados à imagem gerada, ainda dentro da GPU." />}
                >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="A geração é sempre a 512×512 — este fator amplia o resultado antes de o enviar. Medido nesta máquina, por imagem gerada: 0,31 ms a 512², 1,30 ms a 1024², 4,11 ms a 1536² e 6,61 ms a 2048², mais 0,4 a 6,5 ms de compressão. Desde 2026-09-17 a imagem é comprimida uma vez por geração, e não uma vez por frame, e por isso o teto subiu a 4×. 1× continua a ser o valor de fábrica." valor={<>{upscaleFator.toFixed(2)}× → {Math.round(512 * upscaleFator)}px</>}>
                      Ampliação
                    </SliderLabel>
                    <Slider
                      value={[upscaleFator]}
                      onValueChange={(v: number[]) => setUpscaleFator(v[0])}
                      onValueCommit={(v: number[]) => sendCommand(`SET_UPSCALE ${v[0].toFixed(2)} ${upscaleNitidez.toFixed(2)}`)}
                      min={1}
                      max={4}
                      step={0.25}
                      className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Máscara de nitidez (unsharp) sobre a imagem gerada, feita na GPU. É grátis em tempo de frame e devolve o contorno que a difusão e a ampliação lavam. A zero, a imagem sai como o modelo a produziu." valor={upscaleNitidez.toFixed(2)}>
                      Nitidez
                    </SliderLabel>
                    <Slider
                      value={[upscaleNitidez]}
                      onValueChange={(v: number[]) => setUpscaleNitidez(v[0])}
                      onValueCommit={(v: number[]) => sendCommand(`SET_UPSCALE ${upscaleFator.toFixed(2)} ${v[0].toFixed(2)}`)}
                      min={0}
                      max={1}
                      step={0.05}
                      className="py-1 cursor-pointer"
                    />
                  </div>
                  <p className="text-[11px] leading-relaxed" style={{ color: "var(--brand-text-muted)" }}>
                    <Wand2 className="mr-1 inline size-3" />
                    Tudo isto acontece na VRAM, sobre o tensor que sai do StreamDiffusion — a imagem
                    só passa para a memória do sistema depois, já ampliada. A ampliação é bicúbica,
                    não um modelo de super-resolução: a GPU já está ocupada com a própria geração.
                  </p>
                </div>
                </SecaoColapsavel>
              </>
              ) : usesDepthMap ? (
              <>
                <SecaoColapsavel
                  titulo="Técnica e cor"
                  abertaPorOmissao
                  resumo={`${NOMES_TECNICA[depthTechnique] ?? depthTechnique} · ${depthColorMode}`}
                  dica={<InfoTip text="Técnica de visualização 3D e modo de cor aplicados ao mapa de profundidade." />}
                >
                <div className="painel-sensus-campos">
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Técnica de visualização 3D aplicada ao mapa de profundidade da câmara.">
                      Técnica
                    </SliderLabel>
                    <select
                      value={depthTechnique}
                      onChange={(e) => { setDepthTechnique(e.target.value); sendCommand(`SET_DEPTH_TECHNIQUE ${e.target.value}`); }}
                      className="w-full min-w-0"
                    >
                      {DEPTH_TECHNIQUES.map((t) => <option key={t} value={t}>{NOMES_TECNICA[t] ?? t}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Modo de cor da técnica ativa. Vale no Point Cloud, na Malha de Arame, nas Partículas e nos Cubos.">
                      Modo de Cor
                    </SliderLabel>
                    <select
                      value={depthColorMode}
                      onChange={(e) => { setDepthColorMode(e.target.value); sendCommand(`SET_DEPTH_COLORMODE ${e.target.value}`); }}
                      className="w-full min-w-0"
                    >
                      {DEPTH_COLOR_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Cor base do modo Tint e do laser topográfico.">
                      Cor Base
                    </SliderLabel>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={depthBaseColor}
                        onChange={(e) => { setDepthBaseColor(e.target.value); sendColorCommandDebounced(`SET_DEPTH_BASECOLOR ${e.target.value}`); }}
                        className="h-8 w-12 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-white/[0.04]"
                      />
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {depthBaseColor.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Resolução da malha (pontos por lado). Mais alto = mais detalhe, mais custo." valor={depthResolution}>
                      Resolução
                    </SliderLabel>
                    <select
                      value={depthResolution}
                      onChange={(e) => { const v = parseInt(e.target.value); setDepthResolution(v); sendCommand(`SET_DEPTH_RESOLUTION ${v}`); }}
                      className="w-full min-w-0"
                    >
                      {[128, 256, 512, 1024].map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                </SecaoColapsavel>

                {/* Distância estimada câmara-rosto. Estimativa por semelhança de
                    triângulos com largura facial assumida — nunca apresentar
                    como medição exata. */}
                <SecaoColapsavel
                  titulo="Distância e calibração"
                  resumo={calibDistance ? `${calibDistance} cm` : "por calibrar"}
                  dica={<InfoTip text="Estimativa da distância câmara-rosto e calibração intrínseca por tabuleiro de xadrez." />}
                >
                <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Estimativa da distância entre a câmara e o rosto, por semelhança de triângulos, assumindo uma largura facial de 14,3 cm. É uma estimativa, não uma medição: a largura facial varia entre pessoas e a cabeça rodada sobrestima a distância.">
                      Distância estimada
                    </SliderLabel>
                    <div className="flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-secondary/40 px-3">
                      <span className="text-sm tabular-nums text-foreground">
                        {typeof latestData?.dist_cm === "number"
                          ? `≈ ${latestData.dist_cm} cm`
                          : "—"}
                      </span>
                      <span
                        className="text-[10px]"
                        style={{ color: "var(--brand-text-muted)", opacity: 0.6 }}
                      >
                        {latestData?.dist_calibrada
                          ? latestData?.dist_fonte === "tabuleiro"
                            ? "focal medida (tabuleiro)"
                            : "focal derivada (rosto)"
                          : "focal suposta (FOV 60°)"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Coloca-te a uma distância conhecida da câmara, escreve esse valor em cm e calibra. Substitui o campo de visão suposto (60°) por uma medida real desta câmara, reduzindo bastante o erro.">
                      Calibrar a esta distância
                    </SliderLabel>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={calibDistance}
                        onChange={(e) => setCalibDistance(e.target.value)}
                        placeholder="cm"
                        className="h-9 w-20 rounded-lg border-border/80 bg-secondary/40 text-xs"
                      />
                      <Button
                        onClick={() => {
                          const v = parseFloat(calibDistance);
                          if (Number.isFinite(v) && v > 0) sendCommand(`CALIBRATE_DISTANCE ${v}`);
                        }}
                        className="h-9 rounded-lg px-3 text-xs"
                        style={{ background: "var(--brand-primary)", color: "var(--brand-text)" }}
                      >
                        Calibrar
                      </Button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowChessCalib((p) => !p)}
                    className="mb-1 text-[11px] underline underline-offset-2 transition-opacity hover:opacity-80"
                    style={{ color: "var(--brand-text-muted)" }}
                  >
                    {showChessCalib ? "Ocultar" : "Calibração avançada"}
                  </button>
                </div>

                {showChessCalib && (
                  <div
                    className="flex flex-col gap-3 rounded-lg p-3.5"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    <p className="text-[11px] leading-relaxed" style={{ color: "var(--brand-text-muted)" }}>
                      Calibração intrínseca por tabuleiro de xadrez (método de Zhang, 2000).
                      Mede a distância focal real desta câmara, independente de qualquer rosto —
                      ao contrário da calibração rápida, que assume a largura facial e fica
                      correta apenas para quem calibrou. Imprime um tabuleiro e mostra-o à câmara
                      de vários ângulos. <strong>Não é preciso medir os quadrados.</strong>
                    </p>

                    {chessState?.estado === "a_recolher" || chessState?.estado === "a_calcular" ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <span style={{ color: "var(--brand-text)" }}>
                            {chessState.estado === "a_calcular"
                              ? "A calcular a calibração…"
                              : "Move o tabuleiro devagar, variando o ângulo"}
                          </span>
                          <span className="tabular-nums" style={{ color: "var(--brand-text-muted)" }}>
                            {chessState.capturadas}/{chessState.alvo}
                          </span>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.10)" }}>
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, (chessState.capturadas / Math.max(1, chessState.alvo)) * 100)}%`,
                              background: "var(--brand-primary)",
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => sendCommand("CHESSBOARD_CALIB_CANCEL")}
                          className="self-start rounded-lg px-3 py-1.5 text-[11px]"
                          style={{ color: "var(--brand-text-muted)", border: "1px solid rgba(255,255,255,0.12)" }}
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px]" style={{ color: "var(--brand-text-muted)" }}>
                          Cantos internos
                        </span>
                        <Input
                          type="number"
                          value={chessCols}
                          onChange={(e) => setChessCols(e.target.value)}
                          className="h-8 w-14 rounded-lg border-border/80 bg-secondary/40 text-xs"
                        />
                        <span style={{ color: "var(--brand-text-muted)" }}>×</span>
                        <Input
                          type="number"
                          value={chessRows}
                          onChange={(e) => setChessRows(e.target.value)}
                          className="h-8 w-14 rounded-lg border-border/80 bg-secondary/40 text-xs"
                        />
                        <Button
                          onClick={() => sendCommand(`CHESSBOARD_CALIB_START ${parseInt(chessCols) || 9} ${parseInt(chessRows) || 6} 15`)}
                          className="h-8 rounded-lg px-3 text-xs"
                          style={{ background: "var(--brand-primary)", color: "var(--brand-text)" }}
                        >
                          Iniciar calibração
                        </Button>
                        {latestData?.dist_calibrada && (
                          <button
                            type="button"
                            onClick={() => sendCommand("CALIB_RESET")}
                            className="rounded-lg px-3 py-1.5 text-[11px] transition-colors hover:bg-rose-500/20"
                            style={{ color: "var(--brand-text-muted)", border: "1px solid rgba(255,255,255,0.12)" }}
                          >
                            Apagar calibração
                          </button>
                        )}
                      </div>
                    )}

                    {chessState?.mensagem && (
                      <span
                        className="text-[11px]"
                        style={{ color: chessState.estado === "erro" ? "#ff8f8f" : "var(--brand-tertiary)" }}
                      >
                        {chessState.mensagem}
                      </span>
                    )}
                  </div>
                )}

                </SecaoColapsavel>

                {/* Cenário da projeção — imagem por trás do efeito 3D, só na
                    janela de projeção. Não altera o mapa de profundidade. */}
                <SecaoColapsavel
                  titulo="Cenário de fundo"
                  resumo={bgName || "sem imagem"}
                  dica={<InfoTip text="Imagem por trás do efeito 3D, ou com o próprio efeito aplicado também a ela." />}
                >
                <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Imagem desenhada por trás do efeito 3D na janela de projeção. Serve de cenário; não é analisada nem afeta o mapa de profundidade.">
                      Cenário da projeção
                    </SliderLabel>
                    <label
                      className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border/80 bg-secondary/40 px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ImageIcon className="size-3.5" />
                      {bgUrl ? "Trocar imagem" : "Escolher imagem"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleBackgroundFile(e.target.files?.[0])}
                      />
                    </label>
                  </div>

                  {bgUrl && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <SliderLabel tip="Liga ou desliga o cenário sem perder a imagem escolhida. Desligado, o fundo da projeção volta a preto.">
                          Mostrar cenário
                        </SliderLabel>
                        <button
                          type="button"
                          onClick={handleBackgroundToggle}
                          className="flex h-9 items-center gap-2 rounded-lg border px-3 text-xs transition-colors"
                          style={{
                            borderColor: bgEnabled ? "var(--brand-primary)" : "rgba(255,255,255,0.12)",
                            color: bgEnabled ? "var(--brand-text)" : "var(--brand-text-muted)",
                            background: bgEnabled ? "rgba(124,103,255,0.15)" : "transparent",
                          }}
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{ background: bgEnabled ? "var(--brand-primary)" : "rgba(255,255,255,0.25)" }}
                          />
                          {bgEnabled ? "Ligado" : "Desligado"}
                        </button>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <SliderLabel tip="'Por trás' deixa a imagem como cenário estático, com o efeito da câmara por cima. 'Com efeito' corre o Depth Anything também sobre a imagem: o cenário ganha a sua própria camada tridimensional, recuada, e a camada da câmara fica sobreposta a ela.">
                          Modo do cenário
                        </SliderLabel>
                        <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-secondary/40 p-0.5">
                          {([["atras", "Por trás"], ["efeito", "Com efeito"]] as const).map(([m, label]) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => { setBgMode(m); pushBackground(bgUrl, bgEnabled, m); }}
                              className="rounded-md px-2.5 py-1.5 text-[11px] transition-colors"
                              style={{
                                background: bgMode === m ? "var(--brand-primary)" : "transparent",
                                color: bgMode === m ? "var(--brand-text)" : "var(--brand-text-muted)",
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {bgMode === "efeito" && (
                        <span className="pb-2 text-[11px]" style={{ color: "var(--brand-text-muted)" }}>
                          {latestData?.bg_depth_status === "pronto"
                            ? "Profundidade da imagem pronta"
                            : latestData?.bg_depth_status === "erro"
                            ? "Falhou a calcular a profundidade da imagem"
                            : "A calcular a profundidade da imagem…"}
                        </span>
                      )}

                      <div className="flex items-center gap-2 pb-1">
                        <img
                          src={bgUrl}
                          alt=""
                          className="h-9 w-14 rounded border border-border/60 object-cover"
                        />
                        <span className="max-w-[10rem] truncate text-[11px] text-muted-foreground">
                          {bgName}
                        </span>
                        <button
                          type="button"
                          onClick={handleBackgroundClear}
                          title="Remover cenário"
                          className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-rose-500/20 hover:text-foreground"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
                </SecaoColapsavel>

                <SecaoColapsavel
                  titulo="Geometria e movimento"
                  resumo={`amplitude ${depthAmplitude.toFixed(1)} · contraste ${depthContrast.toFixed(1)}`}
                  dica={<InfoTip text="Amplitude, contraste, limiar, tamanho dos pontos, resolução e onda." />}
                >
                <div className="painel-sensus-campos">
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Força do deslocamento em Z conforme a profundidade." valor={depthAmplitude.toFixed(1)}>
                      Amplitude
                    </SliderLabel>
                    <Slider
                      value={[depthAmplitude]}
                      onValueChange={(v: number[]) => setDepthAmplitude(v[0])}
                      onValueCommit={(v: number[]) => sendCommand(`SET_DEPTH_AMPLITUDE ${v[0]}`)}
                      min={0} max={10} step={0.1} className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Contraste aplicado à profundidade antes do deslocamento." valor={depthContrast.toFixed(1)}>
                      Contraste
                    </SliderLabel>
                    <Slider
                      value={[depthContrast]}
                      onValueChange={(v: number[]) => setDepthContrast(v[0])}
                      onValueCommit={(v: number[]) => sendCommand(`SET_DEPTH_CONTRAST ${v[0]}`)}
                      min={0.1} max={3} step={0.1} className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Corta o fundo: tudo abaixo desta profundidade desaparece. Vale em todas as técnicas — é assim que a pessoa fica a flutuar no preto." valor={depthThreshold.toFixed(2)}>
                      Limiar
                    </SliderLabel>
                    <Slider
                      value={[depthThreshold]}
                      onValueChange={(v: number[]) => setDepthThreshold(v[0])}
                      onValueCommit={(v: number[]) => sendCommand(`SET_DEPTH_THRESHOLD ${v[0]}`)}
                      min={0} max={1} step={0.01} className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Tamanho de cada ponto, no Point Cloud e nas Partículas. O que está mais perto da câmara sai maior." valor={depthPointSize.toFixed(1)}>
                      Tamanho do Ponto
                    </SliderLabel>
                    <Slider
                      value={[depthPointSize]}
                      onValueChange={(v: number[]) => setDepthPointSize(v[0])}
                      onValueCommit={(v: number[]) => sendCommand(`SET_DEPTH_POINTSIZE ${v[0]}`)}
                      min={0.5} max={20} step={0.5} className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Ondulação sobreposta à geometria. Nas Partículas é a turbulência: quanto mais alto, mais a figura se desfaz em poeira." valor={depthWaveSize.toFixed(2)}>
                      Onda: Tamanho
                    </SliderLabel>
                    <Slider
                      value={[depthWaveSize]}
                      onValueChange={(v: number[]) => setDepthWaveSize(v[0])}
                      onValueCommit={(v: number[]) => sendCommand(`SET_DEPTH_WAVESIZE ${v[0]}`)}
                      min={0} max={2} step={0.05} className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Velocidade da ondulação — e da deriva das partículas." valor={depthWaveSpeed.toFixed(1)}>
                      Onda: Velocidade
                    </SliderLabel>
                    <Slider
                      value={[depthWaveSpeed]}
                      onValueChange={(v: number[]) => setDepthWaveSpeed(v[0])}
                      onValueCommit={(v: number[]) => sendCommand(`SET_DEPTH_WAVESPEED ${v[0]}`)}
                      min={0} max={10} step={0.1} className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Realça o contorno: onde a superfície se dobra a pique deixa de apontar à câmara, e é aí que está a silhueta de quem está à frente. Zero desliga." valor={depthGlow.toFixed(1)}>
                      Silhueta e Brilho
                    </SliderLabel>
                    <Slider
                      value={[depthGlow]}
                      onValueChange={(v: number[]) => setDepthGlow(v[0])}
                      onValueCommit={(v: number[]) => sendCommand(`SET_DEPTH_GLOW ${v[0]}`)}
                      min={0} max={3} step={0.1} className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Arredonda a profundidade a N degraus: a superfície contínua passa a um modelo de camadas, como uma maqueta cortada a laser. Zero mantém-na contínua." valor={depthSlices === 0 ? "contínuo" : depthSlices}>
                      Fatias
                    </SliderLabel>
                    <Slider
                      value={[depthSlices]}
                      onValueChange={(v: number[]) => setDepthSlices(v[0])}
                      onValueCommit={(v: number[]) => sendCommand(`SET_DEPTH_SLICES ${v[0]}`)}
                      min={0} max={32} step={1} className="py-1 cursor-pointer"
                    />
                  </div>
                </div>
                </SecaoColapsavel>

                <SecaoColapsavel
                  titulo="Câmara da cena"
                  resumo={depthOrbit ? `órbita ${depthOrbitSpeed.toFixed(1)}×` : `parada · dist. ${depthCamDist.toFixed(0)}`}
                  dica={<InfoTip text="Enquadramento da cena 3D. Arrastar o rato sobre a projeção continua a rodá-la à mão; estes controlos são para quando não há ninguém ao rato." />}
                >
                <div className="painel-sensus-campos">
                  <div className="flex items-center justify-between gap-4">
                    <SliderLabel tip="Roda a cena devagar e sem parar. Numa instalação ninguém está ao teclado, e sem isto a cena fica congelada de frente a sessão inteira.">
                      Órbita automática
                    </SliderLabel>
                    <button
                      type="button"
                      onClick={() => { const v = !depthOrbit; setDepthOrbit(v); sendCommand(`SET_DEPTH_ORBIT ${v ? 1 : 0}`); }}
                      className={`mov-toque h-7 shrink-0 rounded-lg border px-3 text-[11px] font-medium ${depthOrbit ? "border-primary/60 bg-primary/15 text-primary" : "border-white/10 bg-white/[0.04] text-muted-foreground"}`}
                    >
                      {depthOrbit ? "Ligada" : "Desligada"}
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Velocidade da órbita automática." valor={depthOrbitSpeed.toFixed(1)}>
                      Velocidade da Órbita
                    </SliderLabel>
                    <Slider
                      value={[depthOrbitSpeed]}
                      onValueChange={(v: number[]) => setDepthOrbitSpeed(v[0])}
                      onValueCommit={(v: number[]) => sendCommand(`SET_DEPTH_ORBITSPEED ${v[0]}`)}
                      min={0} max={5} step={0.1} className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Distância da câmara à cena. Mais perto enche o ecrã; mais longe mostra a nuvem inteira." valor={depthCamDist.toFixed(0)}>
                      Distância da Câmara
                    </SliderLabel>
                    <Slider
                      value={[depthCamDist]}
                      onValueChange={(v: number[]) => setDepthCamDist(v[0])}
                      onValueCommit={(v: number[]) => sendCommand(`SET_DEPTH_CAMDIST ${v[0]}`)}
                      min={2} max={50} step={1} className="py-1 cursor-pointer"
                    />
                  </div>
                </div>
                </SecaoColapsavel>
              </>
              ) : null}
              </div>
            )}

            {/* ── Separador: MÚSICA ── */}
            {tab === "musica" && (
              <div className="flex flex-col gap-2.5">
                {/* Uma pilha de secções em vez de três blocos soltos separados por
                    linhas: o que se lê ao entrar é a lista do que este separador
                    controla, e abre-se só o que se vai mexer. Ficam abertas as duas
                    que se usam com a peça a correr — o que o motor está a fazer, e
                    as camadas que se equilibram à mão. */}
                <SecaoColapsavel
                  titulo="Regulação em tempo real"
                  abertaPorOmissao
                  resumo={`${music.genre || "—"} · ${Math.round(music.bpm || 0)} BPM · ${SCALE_LABELS[music.scale] || "—"}`}
                  dica={<InfoTip text="Valores efetivos do motor musical. O estado medido pela câmara decide a energia — mais ativação (arousal) → andamento mais lento, filtro mais fechado e menos densidade, regulação compensatória. O género decide o material (instrumentos, ritmo, escalas) e roda sozinho a cada 20–55 s." />}
                >
                  <div className="painel-sensus-campos">
                    <div className="flex flex-col gap-1">
                      <span className="flex items-center text-[11px] text-muted-foreground">
                        Género
                        <b className="ml-auto font-medium text-foreground">{music.genre || "—"}</b>
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">roda sozinho a cada 20–55 s</span>
                    </div>
                    <LiveBar label="Andamento" value={music.bpm || 0} min={30} max={170} unit=" BPM" />
                    <LiveBar label="Densidade" value={(music.density || 0) * 100} min={0} max={100} unit="%" />
                    <LiveBar label="Filtro" value={music.cutoff || 0} min={200} max={5600} unit=" Hz" />
                    <div className="flex flex-col gap-1">
                      <span className="flex items-center text-[11px] text-muted-foreground">
                        Escala ativa
                        <b className="ml-auto font-medium text-foreground">{SCALE_LABELS[music.scale] || "—"}</b>
                      </span>
                      {musicScale === "auto" && (
                        <span className="text-[10px] text-muted-foreground/70">escolhida pela valência</span>
                      )}
                    </div>
                  </div>
                </SecaoColapsavel>

                <SecaoColapsavel
                  titulo="Síntese"
                  resumo={`${SCALE_LABELS[music.scale] || "—"} · ${Math.round(synthBaseF0)} Hz · ${tempoMult.toFixed(2)}×`}
                  dica={<InfoTip text="Afinação do motor generativo: a nota base, a escala e os multiplicadores que se aplicam por cima do que a biometria já decidiu." />}
                >
                  <div className="painel-sensus-campos">
                    <div className="flex flex-col gap-1.5">
                      <SliderLabel tip="Frequência da tónica (nota base) de todas as camadas. 131 Hz corresponde a Dó3." valor={<>{Math.round(synthBaseF0)} Hz</>}>
                        Freq. base
                      </SliderLabel>
                      <Slider value={[synthBaseF0]} onValueChange={handleSynthBaseF0Change} min={50} max={300} step={5} className="py-1 cursor-pointer" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <SliderLabel tip="Escala musical das camadas. Em Auto é escolhida em tempo real pela valência emocional medida.">
                        Escala
                      </SliderLabel>
                      <select value={musicScale} onChange={(e) => handleScaleChange(e.target.value)} className="w-full">
                        <option value="auto">Auto (valência)</option>
                        {Object.entries(SCALE_LABELS)
                          .filter(([k]) => k)
                          .map(([k, rotulo]) => (
                            <option key={k} value={k}>
                              {rotulo}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <SliderLabel tip="Multiplicador do andamento sobre o valor reativo (o tempo base responde ao arousal)." valor={<>{tempoMult.toFixed(2)}×</>}>
                        Andamento
                      </SliderLabel>
                      <Slider value={[tempoMult]} onValueChange={handleTempoChange} min={0.5} max={1.5} step={0.05} className="py-1 cursor-pointer" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <SliderLabel tip="Abertura do filtro low-pass. Menos brilho = som mais abafado e envolvente." valor={<>{brightness.toFixed(2)}×</>}>
                        Brilho
                      </SliderLabel>
                      <Slider value={[brightness]} onValueChange={handleBrightnessChange} min={0.3} max={1.5} step={0.05} className="py-1 cursor-pointer" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <SliderLabel tip="Volume da voz do assistente e da legenda falada na projeção. Não afeta a música generativa." valor={<>{Math.round(voiceVolume * 100)}%</>}>
                        Vol. locução
                      </SliderLabel>
                      <Slider value={[voiceVolume]} onValueChange={handleVoiceVolumeChange} min={0} max={1} step={0.05} className="py-1 cursor-pointer" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <SliderLabel tip="Análise contínua da voz (servidor local Speaches) que ajusta a música de forma compensatória.">
                        Análise vocal
                      </SliderLabel>
                      <label className="flex cursor-pointer items-center gap-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                        <input
                          type="checkbox"
                          checked={voiceAnalysis}
                          onChange={handleVoiceAnalysisToggle}
                          className="size-3.5 rounded border-border accent-primary"
                        />
                        {voiceAnalysis ? "Ativa" : "Desligada"}
                      </label>
                    </div>
                  </div>
                </SecaoColapsavel>

                <SecaoColapsavel
                  titulo="Camadas de som"
                  abertaPorOmissao
                  resumo={`${Object.keys(layers).filter((k) => layers[k].on).length}/${Object.keys(layers).length} ligadas`}
                  dica={<InfoTip text="Ganho e estado individual de cada camada: Melodia (motivos + pluck + sinos), Piano (acordes com inversões + baixo), Coro (pad desafinado), Tabla (polirritmo 3:4) e Percussão." />}
                >
                  <div className="painel-sensus-campos">
                    {Object.keys(layers).map((key) => (
                      <div key={key} className="flex flex-col gap-1.5">
                        <label className="flex min-w-0 cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={layers[key].on}
                            onChange={() => toggleLayer(key)}
                            className="size-3.5 shrink-0 rounded border-border accent-primary"
                          />
                          <span className="min-w-0 truncate">{LAYER_LABELS[key]}</span>
                          <b className="ml-auto shrink-0 font-medium tabular-nums text-foreground">
                            {Math.round(layers[key].vol * 100)}%
                          </b>
                        </label>
                        <Slider
                          value={[layers[key].vol]}
                          onValueChange={(v) => setLayerVol(key, v[0])}
                          min={0}
                          max={1}
                          step={0.05}
                          className="py-1 cursor-pointer"
                        />
                      </div>
                    ))}
                  </div>
                </SecaoColapsavel>

                {/* Pauta em tempo real (notas da camada de Melodia) */}
                <SecaoColapsavel
                  titulo="Pauta · melodia"
                  resumo={latestData?.note ?? "—"}
                  dica={<InfoTip text="As notas que a camada de Melodia está a tocar, à medida que saem do motor." />}
                >
                  <SensusStaff note={latestData?.note} noteId={latestData?.note_id} />
                </SecaoColapsavel>
              </div>
            )}


            {/* ── Separador: SENSORES ── */}
            {tab === "config" && (
              <div className="flex flex-col gap-2.5">
                <SecaoColapsavel
                  titulo="Origem do vídeo"
                  abertaPorOmissao
                  resumo={cameraDevices.find((d) => d.id === cameraSource)?.label ?? "—"}
                  dica={<InfoTip text="Fonte do vídeo analisado — câmaras do PC e telemóveis Android ligados são detetados automaticamente." />}
                >
                  <div className="flex items-center gap-2 sm:max-w-md">
                    <select
                      value={cameraSource}
                      onChange={(e) => handleCameraSourceChange(e.target.value)}
                      className="w-full"
                    >
                      {loadingCameras && <option value={cameraSource}>A procurar câmaras...</option>}
                      {!loadingCameras && cameraDevices.length === 0 && (
                        <option value={cameraSource}>Nenhuma câmara encontrada</option>
                      )}
                      {cameraDevices.map((d) => (
                        <option key={d.id} value={d.id}>{d.label}</option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={refreshCameraDevices}
                      disabled={loadingCameras}
                      title="Procurar câmaras/telemóveis novamente"
                      className="mov-toque size-8 shrink-0 rounded-lg border border-white/10 text-muted-foreground"
                    >
                      <RefreshCw className={`size-3 ${loadingCameras ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                  {(cameraEmUso || cameraErro) && (
                    <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                      Em uso:{" "}
                      <span className="text-foreground">
                        {cameraEmUso === "simulacao"
                          ? "nenhuma — imagem simulada"
                          : cameraDevices.find((d) => d.id === cameraEmUso)?.label ?? cameraEmUso}
                      </span>
                      {cameraErro && <span className="text-[color:var(--brand-warn,#ffd166)]"> · {cameraErro}</span>}
                    </p>
                  )}
                </SecaoColapsavel>

                <SecaoColapsavel
                  titulo="Sensores medidos em tempo real"
                  abertaPorOmissao
                  resumo={`${SENSOR_DEFS.filter(({ key }) => (activeSensors as any)[key] !== false).length}/${SENSOR_DEFS.length} ligados`}
                  dica={<InfoTip text="Liga/desliga cada sensor biométrico e cada camada do overlay desenhado no feed de parâmetros. As alterações aplicam-se imediatamente." />}
                >
                  {/* Sem moldura por sensor: dez caixas com contorno próprio dentro
                      de uma secção que já tem o seu davam três níveis de borda para
                      ler dez palavras. O estado é o visto do quadrado e o texto a
                      acender — o fundo só aparece ao passar o rato. */}
                  <div className="painel-sensus-campos" style={{ gap: "2px 24px" }}>
                    {SENSOR_DEFS.map(({ key, label, tip }) => {
                      const ligado = (activeSensors as any)[key] !== false;
                      return (
                        <label
                          key={key}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] transition-colors hover:bg-white/[0.045]"
                          style={{ color: ligado ? "var(--brand-text)" : "rgba(201,206,218,0.55)" }}
                        >
                          <input
                            type="checkbox"
                            checked={ligado}
                            onChange={() => toggleSensor(key)}
                            className="size-3.5 shrink-0 rounded border-border accent-primary"
                          />
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                          <InfoTip text={tip} />
                        </label>
                      );
                    })}
                  </div>
                </SecaoColapsavel>
              </div>
            )}


            {/* ── Separador: FLUIDO (Fluid AI) ── */}
            {tab === "fluido" && (
              <div className="flex flex-col gap-4">
                <p className="text-[11px] leading-relaxed" style={{ color: "var(--brand-text-muted)" }}>
                  Cada preset muda ao mesmo tempo a <strong>física do fluido</strong> (na GPU, na janela
                  de projeção) e a <strong>prompt do StreamDiffusion</strong> (no motor). Pinta com o rato
                  ou o dedo sobre a janela de projeção.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                  {FLUID_PRESETS.map((preset) => {
                    const ativo = preset.id === fluidPresetId;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => aplicarPresetFluido(preset)}
                        className="flex flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors"
                        style={{
                          background: ativo ? "rgba(124,103,255,0.16)" : "rgba(255,255,255,0.03)",
                          border: `1px solid ${ativo ? "rgba(124,103,255,0.55)" : "rgba(255,255,255,0.08)"}`,
                        }}
                      >
                        <span
                          className="text-[11px] font-semibold"
                          style={{ color: ativo ? "#c9bfff" : "var(--brand-text)" }}
                        >
                          {preset.label}
                        </span>
                        <span className="text-[10px] leading-snug" style={{ color: "var(--brand-text-muted)" }}>
                          {preset.nota}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <SecaoColapsavel
                  titulo="Ajuste fino da física"
                  abertaPorOmissao
                  dica={<InfoTip text="Parte-se dos valores do preset escolhido. Mexer aqui não muda a prompt." />}
                >
                  <div className="painel-sensus-campos">
                    {([
                      ["curl", "Vorticidade", 0, 50, 1, fluidPhysics.curl,
                        "Devolve os redemoinhos que a grelha discreta dissipa. A zero o movimento fica laminar; alto gera espirais e filamentos."],
                      ["densityDissipation", "Persistência da tinta", 0.9, 1, 0.005, fluidPhysics.densityDissipation,
                        "Quanto da tinta sobrevive a cada frame. 1.0 nunca apaga; abaixo de 0.95 o traço desaparece depressa."],
                      ["velocityDissipation", "Persistência do movimento", 0.9, 1, 0.005, fluidPhysics.velocityDissipation,
                        "Equivalente ao atrito. Abaixo de 1.0 o fluido vai parando sozinho."],
                      ["buoyancy", "Empuxo", -1, 1, 0.05, fluidPhysics.buoyancy,
                        "Empurra a tinta segundo o seu brilho, como calor a subir. Negativo afunda."],
                    ] as const).map(([chave, label, min, max, passo, valor, dica]) => (
                      <div key={chave} className="flex flex-col gap-1.5">
                        <SliderLabel
                          tip={dica}
                          valor={typeof valor === "number" ? valor.toFixed(passo < 1 ? 2 : 0) : valor}
                        >
                          {label}
                        </SliderLabel>
                        <Slider
                          value={[valor as number]}
                          onValueChange={(v: number[]) => setFluidPhysics((p) => ({ ...p, [chave]: v[0] }))}
                          onValueCommit={(v: number[]) => {
                            const novo = { ...fluidPhysics, [chave]: v[0] };
                            setFluidPhysics(novo);
                            pushFluid(novo, fluidClearSignal);
                          }}
                          min={min}
                          max={max}
                          step={passo}
                          className="py-1 cursor-pointer"
                        />
                      </div>
                    ))}
                  </div>
                </SecaoColapsavel>

                <div className="painel-sensus-campos">
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Força com que o movimento filmado empurra o fluido. Mais alto = a peça reage a gestos pequenos." valor={<>{fluidForca}%</>}>
                      Resposta à câmara
                    </SliderLabel>
                    <Slider
                      value={[fluidForca]}
                      onValueChange={(v: number[]) => setFluidForca(v[0])}
                      onValueCommit={(v: number[]) => pushFluid(fluidPhysics, fluidClearSignal, { forca: v[0] })}
                      min={0}
                      max={300}
                      step={5}
                      className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Corrente de fundo: mantém o fluido em movimento mesmo com a sala parada, para a peça nunca ficar num ecrã estático. A zero, só há movimento quando alguém se mexe." valor={<>{fluidCorrente}%</>}>
                      Corrente de fundo
                    </SliderLabel>
                    <Slider
                      value={[fluidCorrente]}
                      onValueChange={(v: number[]) => setFluidCorrente(v[0])}
                      onValueCommit={(v: number[]) => pushFluid(fluidPhysics, fluidClearSignal, { corrente: v[0] })}
                      min={0}
                      max={300}
                      step={5}
                      className="py-1 cursor-pointer"
                    />
                  </div>
                </div>

                <div className="painel-sensus-campos">
                  {([
                    ["Cor do movimento", "corMovimento", "Tinta deixada por quem se mexe à frente da câmara."],
                    ["Cor de fundo", "corFundo", "Tinta da corrente de fundo, que mantém a peça viva com a sala parada."],
                  ] as const).map(([rotulo, chave, dica]) => {
                    const c = (fluidPhysics as any)[chave] as [number, number, number] | undefined;
                    const hex = c
                      ? "#" + c.map((v) => Math.round(Math.min(1, v / (chave === "corFundo" ? 2 : 1)) * 255).toString(16).padStart(2, "0")).join("")
                      : "#7c67ff";
                    return (
                      <div key={chave} className="flex flex-col gap-1.5">
                        <SliderLabel tip={dica}>{rotulo}</SliderLabel>
                        <input
                          type="color"
                          value={hex}
                          onChange={(e) => {
                            const h = e.target.value.replace("#", "");
                            const escala = chave === "corFundo" ? 2 : 1;
                            const rgb: [number, number, number] = [
                              (parseInt(h.slice(0, 2), 16) / 255) * escala,
                              (parseInt(h.slice(2, 4), 16) / 255) * escala,
                              (parseInt(h.slice(4, 6), 16) / 255) * escala,
                            ];
                            const novo = { ...fluidPhysics, [chave]: rgb };
                            setFluidPhysics(novo);
                            pushFluid(novo, fluidClearSignal);
                          }}
                          className="h-8 w-full cursor-pointer rounded-lg border border-border bg-transparent"
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      const novo = !fluidGerar;
                      setFluidGerar(novo);
                      pushFluid(fluidPhysics, fluidClearSignal, { gerar: novo });
                    }}
                    className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] transition-colors"
                    style={{
                      background: fluidGerar ? "rgba(124,103,255,0.20)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${fluidGerar ? "rgba(124,103,255,0.55)" : "rgba(255,255,255,0.10)"}`,
                      color: fluidGerar ? "#c9bfff" : "var(--brand-text-muted)",
                    }}
                  >
                    <Layers className="size-3.5" />
                    Geração visual {fluidGerar ? "ligada" : "desligada"}
                  </button>
                  {/* Espelho da câmara. Estava fixo no shader: bom para quem se vê
                      ao espelho, errado quando a câmara filma o público de frente. */}
                  <button
                    type="button"
                    title="A câmara entrega a cena como a vê, não como um espelho. Espelhada, quem está à frente vê o fluido responder do lado onde mexeu. Desligar quando a câmara filma o público de frente."
                    onClick={() => {
                      const novo = { ...fluidPhysics, espelharCamara: !(fluidPhysics.espelharCamara ?? true) };
                      setFluidPhysics(novo);
                      pushFluid(novo, fluidClearSignal);
                    }}
                    className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] transition-colors"
                    style={{
                      background: (fluidPhysics.espelharCamara ?? true) ? "rgba(124,103,255,0.20)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${(fluidPhysics.espelharCamara ?? true) ? "rgba(124,103,255,0.55)" : "rgba(255,255,255,0.10)"}`,
                      color: (fluidPhysics.espelharCamara ?? true) ? "#c9bfff" : "var(--brand-text-muted)",
                    }}
                  >
                    <FlipHorizontal className="size-3.5" />
                    Câmara {(fluidPhysics.espelharCamara ?? true) ? "espelhada" : "direta"}
                  </button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const n = fluidClearSignal + 1;
                      setFluidClearSignal(n);
                      pushFluid(fluidPhysics, n);
                    }}
                    className="h-8 rounded-lg border border-border/80 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Limpar tela
                  </Button>
                  <span className="text-[10px]" style={{ color: "var(--brand-text-muted)" }}>
                    {fluidGerar
                      ? "A simulação é enviada ao StreamDiffusion a ~9 imagens por segundo."
                      : "Só a simulação de fluidos, controlada pela câmara. Sem StreamDiffusion."}
                  </span>
                </div>
              </div>
            )}

            {/* ── Separador: PINTURA (Air Painting) ── */}
            {tab === "pintura" && (
              <div className="flex flex-col gap-4">
                {/* Leitura ao vivo: sem isto o limiar afina-se às cegas, porque o
                    mapa de profundidade é relativo e muda com o enquadramento. */}
                <div
                  className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg p-3"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: paintInfo?.mao ? "#4ade80" : "rgba(255,255,255,0.25)" }}
                    />
                    <span style={{ color: "var(--brand-text-muted)" }}>
                      {paintInfo?.mao ? "Mão detetada" : "Sem mão no enquadramento"}
                    </span>
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--brand-text-muted)" }}>
                    Profundidade do dedo{" "}
                    <strong className="tabular-nums" style={{ color: "var(--brand-text)" }}>
                      {paintInfo?.z ?? 0}
                    </strong>{" "}
                    / limiar <span className="tabular-nums">{paintThreshold}</span>
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider"
                    style={
                      paintInfo?.pintar
                        ? { background: "rgba(124,103,255,0.22)", color: "#c9bfff" }
                        : { background: "rgba(255,255,255,0.06)", color: "var(--brand-text-muted)" }
                    }
                  >
                    {paintInfo?.fechada ? "Mão fechada" : paintInfo?.pintar ? "A pintar" : "A pairar"}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--brand-text-muted)" }}>
                    Pinça{" "}
                    <strong className="tabular-nums" style={{ color: "var(--brand-text)" }}>
                      {((paintInfo?.pinca ?? 0) * 100).toFixed(0)}%
                    </strong>{" "}
                    → espessura <span className="tabular-nums">{paintInfo?.espessura ?? "—"}</span>
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--brand-text-muted)" }}>
                    Dedos <strong className="tabular-nums" style={{ color: "var(--brand-text)" }}>{paintInfo?.dedos ?? 0}</strong>
                    {paintInfo?.papel ? ` · mão que ${paintInfo.papel === "pintar" ? "pinta" : "apaga"}` : ""}
                    {paintInfo?.maos > 1 ? " · 2 mãos" : ""}
                  </span>
                  {paintInfo?.estado === "erro" && (
                    <span className="text-[11px] text-rose-400">Deteção de mãos indisponível</span>
                  )}
                </div>

                <div className="painel-sensus-campos">
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="A que profundidade o dedo começa a pintar. O mapa do Depth Anything é relativo e renormalizado a cada frame (claro = perto), por isso não há um valor universal: usa a leitura acima — estende o braço, vê o número, e põe o limiar um pouco abaixo dele." valor={paintThreshold}>
                      Limiar de profundidade
                    </SliderLabel>
                    <Slider
                      value={[paintThreshold]}
                      onValueChange={(v: number[]) => setPaintThreshold(v[0])}
                      onValueCommit={(v: number[]) => sendCommand(`SET_AIRPAINT_THRESHOLD ${v[0]}`)}
                      min={0}
                      max={255}
                      step={1}
                      className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Intervalo de espessura controlado pelo gesto: polegar e indicador juntos dão o mínimo, afastados dão o máximo. Com a espessura por gesto desligada usa-se o mínimo como valor fixo.">
                      Espessura {paintGestureWidth ? `(${paintWidthMin}–${paintWidthMax})` : `(${paintWidthMin})`}
                    </SliderLabel>
                    <div className="flex items-center gap-2">
                      <Slider
                        value={[paintWidthMin]}
                        onValueChange={(v: number[]) => setPaintWidthMin(Math.min(v[0], paintWidthMax))}
                        onValueCommit={(v: number[]) =>
                          sendCommand(`SET_AIRPAINT_WIDTH_RANGE ${Math.min(v[0], paintWidthMax)} ${paintWidthMax}`)
                        }
                        min={1}
                        max={60}
                        step={1}
                        className="py-1 flex-1 cursor-pointer"
                      />
                      <Slider
                        value={[paintWidthMax]}
                        onValueChange={(v: number[]) => setPaintWidthMax(Math.max(v[0], paintWidthMin))}
                        onValueCommit={(v: number[]) =>
                          sendCommand(`SET_AIRPAINT_WIDTH_RANGE ${paintWidthMin} ${Math.max(v[0], paintWidthMin)}`)
                        }
                        min={1}
                        max={60}
                        step={1}
                        className="py-1 flex-1 cursor-pointer"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <SliderLabel tip="Filtra o tremor da deteção. Mais alto = traço mais limpo mas mais lento a seguir a mão; a zero, o traço acompanha tudo, incluindo o ruído de alguns píxeis que existe mesmo com a mão parada." valor={paintSmoothing.toFixed(2)}>
                      Suavização
                    </SliderLabel>
                    <Slider
                      value={[paintSmoothing]}
                      onValueChange={(v: number[]) => setPaintSmoothing(v[0])}
                      onValueCommit={(v: number[]) => sendCommand(`SET_AIRPAINT_SMOOTHING ${v[0]}`)}
                      min={0}
                      max={0.95}
                      step={0.05}
                      className="py-1 cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <SliderLabel tip="Um dedo levantado escolhe a cor principal; dois dedos escolhem a secundária. Depois abre-se a mão para pintar.">
                      Cores — 1 dedo / 2 dedos
                    </SliderLabel>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        type="color"
                        value={paintColor}
                        onChange={(e) => {
                          setPaintColor(e.target.value);
                          sendColorCommandDebounced(`SET_AIRPAINT_COLOR ${e.target.value}`);
                        }}
                        title="Cor principal (1 dedo)"
                        className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent"
                      />
                      <input
                        type="color"
                        value={paintColor2}
                        onChange={(e) => {
                          setPaintColor2(e.target.value);
                          sendColorCommandDebounced(`SET_AIRPAINT_COLOR2 ${e.target.value}`);
                        }}
                        title="Cor secundária (2 dedos)"
                        className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent"
                      />
                      <span className="mx-1 text-[10px]" style={{ color: "var(--brand-text-muted)" }}>
                        rápidas →
                      </span>
                      {PALETA_PINTURA.map((c) => (
                        <button
                          key={c}
                          type="button"
                          title={`${c} — clique define a principal`}
                          onClick={() => {
                            setPaintColor(c);
                            sendCommand(`SET_AIRPAINT_COLOR ${c}`);
                          }}
                          className="size-6 shrink-0 rounded-md transition-transform hover:scale-110"
                          style={{
                            background: c,
                            outline: paintColor.toLowerCase() === c ? "2px solid rgba(255,255,255,0.75)" : "none",
                            outlineOffset: "1px",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* ── Gestos ── */}
                <div
                  className="rounded-lg p-3"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <div className="mb-2 text-[11px] font-semibold text-primary/90">Gestos</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1 text-[11px]"
                       style={{ color: "var(--brand-text-muted)" }}>
                    <span><strong style={{ color: "var(--brand-text)" }}>Punho (0 dedos)</strong> — levanta a caneta</span>
                    <span><strong style={{ color: "var(--brand-text)" }}>1 dedo</strong> — cor principal</span>
                    <span><strong style={{ color: "var(--brand-text)" }}>2 dedos</strong> — cor secundária</span>
                    <span><strong style={{ color: "var(--brand-text)" }}>Mão aberta</strong> — pinta (direita) ou apaga (esquerda)</span>
                  </div>
                </div>

                {/* ── Ferramentas ── */}
                <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      const novo = !paintEraser;
                      setPaintEraser(novo);
                      sendCommand(`SET_AIRPAINT_ERASER ${novo ? 1 : 0}`);
                    }}
                    className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] transition-colors"
                    style={{
                      background: paintEraser ? "rgba(124,103,255,0.20)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${paintEraser ? "rgba(124,103,255,0.55)" : "rgba(255,255,255,0.10)"}`,
                      color: paintEraser ? "#c9bfff" : "var(--brand-text-muted)",
                    }}
                  >
                    <Eraser className="size-3.5" />
                    Borracha
                  </button>
                  {([
                    ["Espelhar imagem", paintMirror, setPaintMirror, "SET_AIRPAINT_MIRROR",
                      "A webcam entrega a cena como a vê, não como um espelho: sem isto a mão vai para o lado contrário do gesto."],
                    ["Trocar mãos", paintSwapHands, setPaintSwapHands, "SET_AIRPAINT_SWAP_HANDS",
                      "Inverte qual das mãos pinta e qual apaga. Usar se a atribuição sair ao contrário nesta câmara."],
                    ["Exigir profundidade", paintRequireDepth, setPaintRequireDepth, "SET_AIRPAINT_REQUIRE_DEPTH",
                      "Além da mão aberta, exige que a mão esteja à frente do limiar de profundidade. Desligado por omissão: com as duas condições, a mão aberta às vezes não pinta sem se perceber porquê."],
                  ] as const).map(([rotulo, valor, setter, comando, dica]) => (
                    <button
                      key={comando}
                      type="button"
                      title={dica}
                      onClick={() => {
                        const novo = !valor;
                        (setter as (v: boolean) => void)(novo);
                        sendCommand(`${comando} ${novo ? 1 : 0}`);
                      }}
                      className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] transition-colors"
                      style={{
                        background: valor ? "rgba(124,103,255,0.20)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${valor ? "rgba(124,103,255,0.55)" : "rgba(255,255,255,0.10)"}`,
                        color: valor ? "#c9bfff" : "var(--brand-text-muted)",
                      }}
                    >
                      {rotulo}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const novo = !paintGestureWidth;
                      setPaintGestureWidth(novo);
                      sendCommand(`SET_AIRPAINT_GESTURE_WIDTH ${novo ? 1 : 0}`);
                    }}
                    className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] transition-colors"
                    style={{
                      background: paintGestureWidth ? "rgba(124,103,255,0.20)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${paintGestureWidth ? "rgba(124,103,255,0.55)" : "rgba(255,255,255,0.10)"}`,
                      color: paintGestureWidth ? "#c9bfff" : "var(--brand-text-muted)",
                    }}
                  >
                    <Hand className="size-3.5" />
                    Espessura por gesto
                  </button>
                  <Button
                    variant="ghost"
                    disabled={paintInfo?.pode_anular === false}
                    onClick={() => sendCommand("AIRPAINT_UNDO")}
                    className="h-8 rounded-lg border border-border/80 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <Undo2 className="mr-1.5 size-3.5" />
                    Anular traço
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => sendCommand("AIRPAINT_CLEAR")}
                    className="h-8 rounded-lg border border-border/80 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Limpar tela
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={guardarPintura}
                    className="h-8 rounded-lg border border-border/80 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Guardar imagem
                  </Button>
                </div>

                <p className="text-[11px] leading-relaxed" style={{ color: "var(--brand-text-muted)" }}>
                  A mão é seguida pelo MediaPipe Hands e a profundidade vem do Depth Anything V2
                  (Yang et al., 2024, arXiv:2406.09414), que estima profundidade <em>relativa</em> a
                  partir de uma só câmara — não é uma medição de distância. Tirar a mão do
                  enquadramento interrompe o traço em vez de o unir ao ponto onde ela reaparecer.
                </p>
              </div>
            )}

            {/* ── Separador: NODES ── */}
            {tab === "nodes" && (
              <NodeGraphEditor
                graph={graph}
                capacidades={{
                  streamdiffusion: usesStreamDiffusion,
                  musica: !usesDepthMap && !usesAirPainting && !usesFluid,
                  profundidade3d: usesDepthMap && !usesAirPainting,
                }}
                onChange={(g) => {
                  setGraph(g);
                  sendCommand(`SET_GRAPH ${JSON.stringify(g)}`);
                }}
              />
            )}
          </div>
        </PainelParametros>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ECRÃ DE PROJEÇÃO — apenas a imagem do StreamDiffusion, sem overlays.
// Pensado para arrastar para um projetor/segundo monitor (F = fullscreen).
// ═══════════════════════════════════════════════════════════════════
export function ProjectionCameraView({ latestData }: { latestData?: any }) {
  // No Air Painting o engine compõe a tela sobre o próprio feed da câmara e
  // envia-a em `image`. Reutilizar esse campo evita transportar a mesma imagem
  // duas vezes na telemetria de cada frame.
  const fonteProjecao = latestData?.image_ia ?? (latestData?.paint ? latestData?.image : null);
  const aiImage = fonteProjecao
    ? (fonteProjecao.startsWith("data:") ? fonteProjecao : `data:image/jpeg;base64,${fonteProjecao}`)
    : null;
  const sdStatus = latestData?.sd_status;
  // Mensagem da falha de carregamento do motor de geracao. Sem ela, um erro
  // era indistinguivel de um carregamento lento: os dois mostravam so um
  // rodopio e a palavra "a carregar".
  const sdErro: string | undefined = latestData?.sd_erro;
  const depthMapUrl = useMapaProfundidade(latestData?.depth_map);
  // A exposição ativa decide o que esta janela projeta: as ferramentas 3D de
  // profundidade, ou a imagem do StreamDiffusion. Antes dependia de node_params
  // existir, o que também é verdade em exposições sem profundidade nenhuma.
  // O Air Painting também liga o mapa de profundidade, mas usa-o só como gatilho
  // interno: o que se projeta é a tela composta, não a nuvem de pontos.
  const { usesDepthViz, usesAirPainting, usesFluid } = useMemo(() => {
    try {
      const raw = localStorage.getItem("sensus-active-exhibition");
      if (raw) {
        const eng = (JSON.parse(raw) as ExhibitionFile).engine;
        const pintura = !!eng?.airPainting?.enabled;
        return {
          usesDepthViz: !!eng?.depthMap?.enabled && !pintura,
          usesAirPainting: pintura,
          usesFluid: !!eng?.fluid?.enabled,
        };
      }
    } catch {
      // Ignorado — assume StreamDiffusion.
    }
    return { usesDepthViz: false, usesAirPainting: false, usesFluid: false };
  }, []);

  // Física do fluido, vinda do painel de controlo pelo processo principal.
  const [fluidState, setFluidState] = useState<{
    physics: FluidPhysics;
    limparSinal: number;
    gerar: boolean;
    forca: number;
    corrente: number;
  }>({ physics: PRESET_POR_OMISSAO.physics, limparSinal: 0, gerar: true, forca: 100, corrente: 100 });
  useEffect(() => {
    window.electronAPI?.onProjectionFluid?.((payload: any) => {
      if (payload?.physics) {
        setFluidState({
          physics: payload.physics,
          limparSinal: payload.limparSinal ?? 0,
          gerar: payload.gerar !== false,
          forca: typeof payload.forca === "number" ? payload.forca : 100,
          corrente: typeof payload.corrente === "number" ? payload.corrente : 100,
        });
      }
    });
  }, []);

  // Cenário enviado pelo painel de controlo, via processo principal.
  const [background, setBackground] = useState<{ url: string | null; enabled: boolean; modo: "atras" | "efeito" }>({
    url: null,
    enabled: false,
    modo: "atras",
  });
  useEffect(() => {
    window.electronAPI?.onProjectionBackground?.((payload: any) => {
      setBackground({
        url: payload?.url ?? null,
        enabled: !!payload?.enabled,
        modo: payload?.modo === "efeito" ? "efeito" : "atras",
      });
    });
  }, []);

  const [flip, setFlip] = useState({ h: false, v: false });
  useEffect(() => {
    window.electronAPI?.onProjectionFlip?.((payload: any) => {
      setFlip({ h: !!payload?.h, v: !!payload?.v });
    });
  }, []);

  // O mapa de profundidade da imagem chega uma vez e fica em cache: o engine
  // deixa de o reenviar depois de entregue, para nao repetir ~50 KB por frame.
  const bgDepthRef = useRef<string | null>(null);
  if (latestData?.bg_depth_map) bgDepthRef.current = latestData.bg_depth_map;

  // Maximizar: a tecla F sempre funcionou, mas não se descobre sozinha. O botão
  // dá a mesma acção ao rato e só aparece enquanto o rato se mexe, para a
  // projeção continuar limpa em exposição.
  const [ecraInteiro, setEcraInteiro] = useState(false);
  const maximizar = useCallback(() => {
    if (window.electronAPI) {
      window.electronAPI.toggleFullscreen();
      setEcraInteiro((p) => !p);
    } else if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFS = () => setEcraInteiro(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFS);
    return () => document.removeEventListener("fullscreenchange", onFS);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") maximizar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximizar]);

  const [ratoAtivo, setRatoAtivo] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onMove = () => {
      setRatoAtivo(true);
      clearTimeout(t);
      t = setTimeout(() => setRatoAtivo(false), 2000);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      clearTimeout(t);
    };
  }, []);

  return (
    <>
    <div
      className={`relative h-screen w-screen overflow-hidden bg-black select-none ${ratoAtivo ? "" : "cursor-none"}`}
      style={{ transform: `scale(${flip.h ? -1 : 1}, ${flip.v ? -1 : 1})` }}
    >
      {usesFluid ? (
        /* A simulação fica sempre por baixo: é ela que recebe o rato e alimenta
           o motor. A imagem gerada entra por cima quando existir, sem bloquear
           a interação. */
        <>
          <FluidSimulation
            physics={fluidState.physics}
            enviarParaIA={fluidState.gerar}
            limparSinal={fluidState.limparSinal}
            flowFieldUrl={latestData?.flow_field}
            forcaCamara={fluidState.forca}
            correnteFundo={fluidState.corrente}
          />
          {fluidState.gerar && aiImage && (
            <img
              src={aiImage}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
            />
          )}
        </>
      ) : usesDepthViz ? (
        depthMapUrl ? (
          /* A câmara é sempre a camada da frente. No modo "efeito" o cenário
             ganha a sua própria camada do mesmo efeito, por trás; no modo
             "atrás" entra como imagem plana. */
          <DepthVisualizer
            depthMapUrl={depthMapUrl}
            params={latestData?.node_params}
            backgroundUrl={
              background.enabled && background.modo === "atras"
                ? background.url ?? undefined
                : undefined
            }
            backgroundDepthUrl={
              background.enabled && background.modo === "efeito"
                ? bgDepthRef.current ?? undefined
                : undefined
            }
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3">
            <Loader2 className="size-5 animate-spin text-white/30" />
            <span className="text-[11px] tracking-wide text-white/30">
              A carregar o modelo de profundidade
            </span>
          </div>
        )
      ) : aiImage ? (
        <img
          src={aiImage}
          alt=""
          className="h-full w-full object-cover transition-opacity duration-300"
        />
      ) : (
        // Estado de espera minimalista — desaparece assim que houver imagem gerada
        <div className="flex h-full w-full flex-col items-center justify-center gap-3">
          {sdStatus === "erro" && !usesAirPainting ? (
            <>
              <span className="text-[11px] uppercase tracking-widest text-white/25">Motor de geração indisponível</span>
              {sdErro && (
                <span className="max-w-[42rem] px-6 text-center text-[10px] leading-relaxed text-white/20">
                  {sdErro}
                </span>
              )}
            </>
          ) : (
            <>
              <Loader2 className="size-5 animate-spin text-white/30" />
              <span className="text-[11px] uppercase tracking-widest text-white/25">
                {usesAirPainting ? "A preparar a tela" : "A preparar projeção"}
              </span>
            </>
          )}
        </div>
      )}

      {/* Legenda do estado + locução. Só depois do aceno — antes disso não há
          sessão medida — e só onde há leitura de Russell: os ambientes sem
          rosto (Air Painting, Fluid AI) mandam o quadrante vazio e a legenda
          cala-se sozinha. */}
      {!latestData?.saudacao?.ativa && <LegendaEstado quadrante={latestData?.quadrante} />}
    </div>

    {/* Fora da div espelhada de propósito: é um controlo do operador, não faz
        parte da imagem projetada, e em retroprojeção apareceria invertido. */}
    <button
      type="button"
      onClick={maximizar}
      title={ecraInteiro ? "Sair de ecrã inteiro (F)" : "Maximizar (F)"}
      aria-label={ecraInteiro ? "Sair de ecrã inteiro" : "Maximizar"}
      className="mov-toque fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border border-white/15 bg-black/55 px-3 py-2 text-white/70 backdrop-blur-sm hover:text-white"
      style={{ opacity: ratoAtivo ? 1 : 0, pointerEvents: ratoAtivo ? "auto" : "none" }}
    >
      {ecraInteiro ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
      <span className="text-[10px] font-medium uppercase tracking-wider">
        {ecraInteiro ? "Sair" : "Maximizar"}
      </span>
    </button>
    </>
  );
}
