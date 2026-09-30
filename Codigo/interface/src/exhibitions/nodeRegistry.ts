export type PortType = "float" | "bool" | "color" | "string" | "image";

export type NodeTypeId =
  | "sensor" | "number" | "bool" | "color"
  | "add" | "sub" | "mul" | "div" | "map_range" | "clamp" | "smooth"
  | "compare" | "and" | "or" | "not" | "threshold"
  | "color_temperature"
  | "prompt_fragment" | "sd_params" | "depth_viz_output"
  | "layer_control" | "music_modifiers"
  | "camera_image" | "depth_map_image" | "generated_image"
  | "blur" | "brightness_contrast" | "hsv_adjust" | "img_threshold" | "edge"
  | "composite" | "chroma_key" | "feedback_image" | "image_output"
  | "noise" | "wave" | "trigger" | "envelope" | "delay" | "hold"
  | "select" | "switch" | "average" | "audio_spectrum"
  | "transform_3d" | "camera_3d" | "light_3d";

export interface NodeParamField {
  key: string;
  label: string;
  kind: "select" | "number" | "text" | "color" | "checkbox";
  options?: string[];
  default: any;
}

export interface NodeTypeSpec {
  label: string;
  category: "Sensor" | "Constante" | "Matemática" | "Lógica" | "Utilitário" | "Output Visual" | "Output Áudio";
  inputs: Record<string, PortType>;
  outputs: Record<string, PortType>;
  paramFields: NodeParamField[];
}

export const SENSOR_FIELDS = [
  "bpm", "val", "aro", "iris_radius", "sym", "blinks", "dist_cm",
  "russell.positivo", "russell.negativo", "russell.ativado", "russell.nao_ativado",
];

export const MUSIC_LAYERS = ["melodia", "piano", "coro", "tabla", "percussao"];

export const DEPTH_TECHNIQUES = [
  "point_cloud", "wireframe", "particles", "instanced_cubes",
  "topographic_laser", "relighting", "z_masking",
];

export const NODE_TYPES: Record<NodeTypeId, NodeTypeSpec> = {
  sensor: { label: "Sensor", category: "Sensor", inputs: {}, outputs: { out: "float" },
    paramFields: [{ key: "field", label: "Campo", kind: "select", options: SENSOR_FIELDS, default: "val" }] },
  number: { label: "Número", category: "Constante", inputs: {}, outputs: { out: "float" },
    paramFields: [{ key: "value", label: "Valor", kind: "number", default: 0 }] },
  bool: { label: "Booleano", category: "Constante", inputs: {}, outputs: { out: "bool" },
    paramFields: [{ key: "value", label: "Valor", kind: "checkbox", default: false }] },
  color: { label: "Cor", category: "Constante", inputs: {}, outputs: { out: "color" },
    paramFields: [{ key: "value", label: "Cor", kind: "color", default: "#ffffff" }] },
  add: { label: "Somar", category: "Matemática", inputs: { a: "float", b: "float" }, outputs: { out: "float" }, paramFields: [] },
  sub: { label: "Subtrair", category: "Matemática", inputs: { a: "float", b: "float" }, outputs: { out: "float" }, paramFields: [] },
  mul: { label: "Multiplicar", category: "Matemática", inputs: { a: "float", b: "float" }, outputs: { out: "float" }, paramFields: [] },
  div: { label: "Dividir", category: "Matemática", inputs: { a: "float", b: "float" }, outputs: { out: "float" }, paramFields: [] },
  map_range: { label: "Mapear Intervalo", category: "Matemática", inputs: { in: "float" }, outputs: { out: "float" },
    paramFields: [
      { key: "inMin", label: "Entrada mín.", kind: "number", default: -1 },
      { key: "inMax", label: "Entrada máx.", kind: "number", default: 1 },
      { key: "outMin", label: "Saída mín.", kind: "number", default: 0 },
      { key: "outMax", label: "Saída máx.", kind: "number", default: 1 },
    ] },
  clamp: { label: "Limitar", category: "Matemática", inputs: { in: "float" }, outputs: { out: "float" },
    paramFields: [{ key: "min", label: "Mín.", kind: "number", default: 0 }, { key: "max", label: "Máx.", kind: "number", default: 1 }] },
  smooth: { label: "Suavizar", category: "Matemática", inputs: { in: "float" }, outputs: { out: "float" },
    paramFields: [{ key: "factor", label: "Fator (0-1)", kind: "number", default: 0.2 }] },
  compare: { label: "Comparar", category: "Lógica", inputs: { a: "float", b: "float" }, outputs: { out: "bool" },
    paramFields: [{ key: "op", label: "Operador", kind: "select", options: [">", "<", ">=", "<=", "=="], default: ">" }] },
  and: { label: "E", category: "Lógica", inputs: { a: "bool", b: "bool" }, outputs: { out: "bool" }, paramFields: [] },
  or: { label: "Ou", category: "Lógica", inputs: { a: "bool", b: "bool" }, outputs: { out: "bool" }, paramFields: [] },
  not: { label: "Não", category: "Lógica", inputs: { a: "bool" }, outputs: { out: "bool" }, paramFields: [] },
  threshold: { label: "Limiar", category: "Lógica", inputs: { in: "float" }, outputs: { out: "bool" },
    paramFields: [{ key: "threshold", label: "Limiar", kind: "number", default: 0.5 }] },
  color_temperature: { label: "Temperatura de Cor", category: "Utilitário", inputs: { kelvin: "float" }, outputs: { out: "color" },
    paramFields: [{ key: "kelvin", label: "Kelvin (default)", kind: "number", default: 6500 }] },
  prompt_fragment: { label: "Fragmento de Prompt", category: "Output Visual", inputs: { value: "float" }, outputs: {},
    paramFields: [{ key: "template", label: "Modelo (usa {value})", kind: "text", default: "{value}" }] },
  sd_params: { label: "Parâmetros SD", category: "Output Visual", inputs: { cfg: "float", denoising: "float", steps: "float", seed: "float" }, outputs: {},
    paramFields: [
      { key: "cfg", label: "CFG (default)", kind: "number", default: 1.0 },
      { key: "denoising", label: "Denoising (default)", kind: "number", default: 0.65 },
      { key: "steps", label: "Steps (default)", kind: "number", default: 1 },
      { key: "seed", label: "Seed (default)", kind: "number", default: 2252004 },
    ] },
  depth_viz_output: { label: "Depth Visualizer", category: "Output Visual",
    inputs: { amplitude: "float", contrast: "float", threshold: "float", baseColor: "color", pointSize: "float", resolution: "float", waveSize: "float", waveSpeed: "float", glow: "float", slices: "float" },
    outputs: {},
    paramFields: [
      { key: "technique", label: "Técnica", kind: "select", options: DEPTH_TECHNIQUES, default: "point_cloud" },
      { key: "colorMode", label: "Modo de Cor", kind: "select", options: ["Grayscale", "Rainbow", "Contour", "Normal", "Hologram", "Tint"], default: "Rainbow" },
      { key: "amplitude", label: "Amplitude (default)", kind: "number", default: 3.0 },
      { key: "contrast", label: "Contraste (default)", kind: "number", default: 1.5 },
      { key: "threshold", label: "Limiar (default)", kind: "number", default: 0.05 },
      { key: "baseColor", label: "Cor base (default)", kind: "color", default: "#00f0ff" },
      { key: "pointSize", label: "Tamanho do ponto (default)", kind: "number", default: 3.0 },
      { key: "resolution", label: "Resolução (default)", kind: "number", default: 256 },
      { key: "waveSize", label: "Onda: tamanho (default)", kind: "number", default: 0.0 },
      { key: "waveSpeed", label: "Onda: velocidade (default)", kind: "number", default: 1.0 },
      { key: "glow", label: "Silhueta/brilho (default)", kind: "number", default: 0.8 },
      { key: "slices", label: "Fatias (0 = contínuo)", kind: "number", default: 0 },
    ] },
  layer_control: { label: "Controlo de Camada", category: "Output Áudio", inputs: { volume: "float", mute: "bool" }, outputs: {},
    paramFields: [
      { key: "layer", label: "Camada", kind: "select", options: MUSIC_LAYERS, default: "melodia" },
      { key: "volume", label: "Volume (default)", kind: "number", default: 0.6 },
      { key: "on", label: "Ligada (default)", kind: "checkbox", default: true },
    ] },
  music_modifiers: { label: "Modificadores de Música", category: "Output Áudio", inputs: { tempoMult: "float", cutoffMult: "float" }, outputs: {},
    paramFields: [
      { key: "scale", label: "Escala forçada", kind: "select", options: ["", "minor", "major_pent", "lydian", "major", "dorian", "phrygian", "mixolydian", "harmonic_minor", "minor_pent", "blues", "hirajoshi", "pelog", "whole_tone"], default: "" },
      { key: "tempoMult", label: "Andamento × (default)", kind: "number", default: 1.0 },
      { key: "cutoffMult", label: "Brilho × (default)", kind: "number", default: 1.0 },
    ] },

  camera_image: { label: "Imagem da Câmara", category: "Sensor", inputs: {}, outputs: { out: "image" }, paramFields: [] },
  depth_map_image: { label: "Imagem de Profundidade", category: "Sensor", inputs: {}, outputs: { out: "image" }, paramFields: [] },
  generated_image: { label: "Última Imagem Gerada", category: "Sensor", inputs: {}, outputs: { out: "image" }, paramFields: [] },
  blur: { label: "Desfocar", category: "Output Visual", inputs: { image: "image" }, outputs: { out: "image" },
    paramFields: [{ key: "radius", label: "Raio", kind: "number", default: 5 }] },
  brightness_contrast: { label: "Brilho/Contraste", category: "Output Visual", inputs: { image: "image" }, outputs: { out: "image" },
    paramFields: [
      { key: "brightness", label: "Brilho (-100..100)", kind: "number", default: 0 },
      { key: "contrast", label: "Contraste (-100..100)", kind: "number", default: 0 },
    ] },
  hsv_adjust: { label: "Ajuste HSV", category: "Output Visual", inputs: { image: "image" }, outputs: { out: "image" },
    paramFields: [
      { key: "hueShift", label: "Matiz (-180..180)", kind: "number", default: 0 },
      { key: "saturation", label: "Saturação ×", kind: "number", default: 1.0 },
      { key: "value", label: "Valor ×", kind: "number", default: 1.0 },
    ] },
  img_threshold: { label: "Limiar de Imagem", category: "Output Visual", inputs: { image: "image" }, outputs: { out: "image" },
    paramFields: [{ key: "threshold", label: "Limiar (0-255)", kind: "number", default: 128 }] },
  edge: { label: "Deteção de Contornos", category: "Output Visual", inputs: { image: "image" }, outputs: { out: "image" },
    paramFields: [
      { key: "threshold1", label: "Limiar 1", kind: "number", default: 100 },
      { key: "threshold2", label: "Limiar 2", kind: "number", default: 200 },
    ] },
  composite: { label: "Compor Imagens", category: "Output Visual", inputs: { a: "image", b: "image" }, outputs: { out: "image" },
    paramFields: [
      { key: "mode", label: "Modo", kind: "select", options: ["mix", "add", "multiply", "screen"], default: "mix" },
      { key: "mix", label: "Mistura (0-1)", kind: "number", default: 0.5 },
    ] },
  chroma_key: { label: "Chroma Key", category: "Output Visual", inputs: { image: "image" }, outputs: { out: "image" },
    paramFields: [
      { key: "keyColor", label: "Cor-chave", kind: "color", default: "#00ff00" },
      { key: "tolerance", label: "Tolerância (0-100)", kind: "number", default: 30 },
    ] },
  feedback_image: { label: "Feedback de Imagem", category: "Output Visual", inputs: { image: "image" }, outputs: { out: "image" },
    paramFields: [{ key: "mixFactor", label: "Mistura (0-1)", kind: "number", default: 0.5 }] },
  image_output: { label: "Saída de Imagem", category: "Output Visual", inputs: { image: "image" }, outputs: {},
    paramFields: [{ key: "target", label: "Destino", kind: "select", options: ["sd_input", "sd_output", "depth_map"], default: "sd_input" }] },

  noise: { label: "Ruído", category: "Sensor", inputs: {}, outputs: { out: "float" },
    paramFields: [
      { key: "speed", label: "Velocidade", kind: "number", default: 1.0 },
      { key: "seed", label: "Semente", kind: "number", default: 0 },
    ] },
  wave: { label: "Onda (LFO)", category: "Sensor", inputs: {}, outputs: { out: "float" },
    paramFields: [
      { key: "shape", label: "Forma", kind: "select", options: ["sine", "square", "saw"], default: "sine" },
      { key: "frequency", label: "Frequência (Hz)", kind: "number", default: 1.0 },
      { key: "amplitude", label: "Amplitude", kind: "number", default: 1.0 },
    ] },
  trigger: { label: "Trigger", category: "Lógica", inputs: { in: "float" }, outputs: { out: "bool" },
    paramFields: [{ key: "threshold", label: "Limiar", kind: "number", default: 0.5 }] },
  envelope: { label: "Envelope (ADSR)", category: "Matemática", inputs: { trigger: "bool" }, outputs: { out: "float" },
    paramFields: [
      { key: "attack", label: "Attack (s)", kind: "number", default: 0.1 },
      { key: "decay", label: "Decay (s)", kind: "number", default: 0.2 },
      { key: "sustain", label: "Sustain (0-1)", kind: "number", default: 0.7 },
      { key: "release", label: "Release (s)", kind: "number", default: 0.3 },
    ] },
  delay: { label: "Atraso", category: "Matemática", inputs: { in: "float" }, outputs: { out: "float" },
    paramFields: [{ key: "seconds", label: "Segundos", kind: "number", default: 0.5 }] },
  hold: { label: "Segurar", category: "Matemática", inputs: { in: "float", trigger: "bool" }, outputs: { out: "float" }, paramFields: [] },
  select: { label: "Selecionar", category: "Lógica", inputs: { in0: "float", in1: "float", in2: "float" }, outputs: { out: "float" },
    paramFields: [{ key: "index", label: "Índice (0-2)", kind: "number", default: 0 }] },
  switch: { label: "Alternar", category: "Lógica", inputs: { cond: "bool", a: "float", b: "float" }, outputs: { out: "float" }, paramFields: [] },
  average: { label: "Média", category: "Matemática", inputs: { a: "float", b: "float", c: "float" }, outputs: { out: "float" }, paramFields: [] },
  audio_spectrum: { label: "Espectro de Áudio", category: "Sensor", inputs: {}, outputs: { bass: "float", mid: "float", treble: "float" }, paramFields: [] },

  transform_3d: { label: "Transform 3D", category: "Output Visual",
    inputs: { posX: "float", posY: "float", posZ: "float", rotX: "float", rotY: "float", rotZ: "float", scale: "float" }, outputs: {},
    paramFields: [
      { key: "posX", label: "Posição X", kind: "number", default: 0 }, { key: "posY", label: "Posição Y", kind: "number", default: 0 }, { key: "posZ", label: "Posição Z", kind: "number", default: 0 },
      { key: "rotX", label: "Rotação X", kind: "number", default: 0 }, { key: "rotY", label: "Rotação Y", kind: "number", default: 0 }, { key: "rotZ", label: "Rotação Z", kind: "number", default: 0 },
      { key: "scale", label: "Escala", kind: "number", default: 1 },
    ] },
  camera_3d: { label: "Câmara 3D", category: "Output Visual", inputs: { fov: "float", distance: "float", autoOrbit: "bool" }, outputs: {},
    paramFields: [
      { key: "fov", label: "FOV", kind: "number", default: 50 },
      { key: "distance", label: "Distância", kind: "number", default: 12 },
      { key: "autoOrbit", label: "Órbita automática", kind: "checkbox", default: true },
    ] },
  light_3d: { label: "Luz 3D", category: "Output Visual", inputs: { intensity: "float", color: "color" }, outputs: {},
    paramFields: [
      { key: "intensity", label: "Intensidade", kind: "number", default: 0.5 },
      { key: "color", label: "Cor", kind: "color", default: "#ffffff" },
    ] },
};

/**
 * Que nodes fazem alguma coisa em cada ambiente.
 *
 * Todos os 47 estão implementados no motor, mas nem todos têm consumidor em
 * todos os ambientes: pôr um Controlo de Camada no Depth Map Tools, que não tem
 * música, cria um node que nunca faz nada. A paleta passa a mostrar só o que o
 * ambiente ativo consegue consumir — o resto continua a existir e a funcionar
 * se vier num ficheiro .sen.
 */
export interface CapacidadesAmbiente {
  streamdiffusion: boolean;
  musica: boolean;
  profundidade3d: boolean;
}

const SO_STREAMDIFFUSION: NodeTypeId[] = ["prompt_fragment", "sd_params"];
const SO_MUSICA: NodeTypeId[] = ["layer_control", "music_modifiers", "audio_spectrum"];
const SO_PROFUNDIDADE: NodeTypeId[] = ["depth_viz_output", "transform_3d", "camera_3d", "light_3d", "depth_map_image"];

export function nodeDisponivel(tipo: NodeTypeId, cap: CapacidadesAmbiente): boolean {
  if (SO_STREAMDIFFUSION.includes(tipo)) return cap.streamdiffusion;
  if (SO_MUSICA.includes(tipo)) return cap.musica;
  if (SO_PROFUNDIDADE.includes(tipo)) return cap.profundidade3d;
  return true;
}
