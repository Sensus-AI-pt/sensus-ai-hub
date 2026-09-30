import { NODE_TYPES } from "./nodeRegistry";
import type { NodeTypeId } from "./nodeRegistry";

// Reexportado porque o NodeGraphEditor o importa daqui, e não do registo.
export type { NodeTypeId };

export interface GraphNode {
  id: string;
  type: NodeTypeId;
  params: Record<string, any>;
  pos: [number, number];
}

export interface GraphConnection {
  from: [string, string];
  to: [string, string];
}

export interface NodeGraph {
  nodes: GraphNode[];
  connections: GraphConnection[];
}

export interface ExhibitionFile {
  senVersion: number;
  id: string;
  name: string;
  description: string;
  /** Chave de imagem do ambiente (ver environmentImages.ts). Vazio ou desconhecida = sem imagem. */
  thumbnail?: string;
  /** Falso = espaço reservado: aparece na lista mas não é selecionável. Ausente = disponível. */
  available?: boolean;
  engine: {
    streamdiffusion: {
      enabled: boolean;
      basePrompt: string;
      negativePrompt: string;
      /**
       * Prompt por quadrante do plano de Russell, com as chaves do motor
       * (`calmo_positivo`, `calmo_negativo`, `ativado_positivo`,
       * `ativado_negativo`). Ausente ou vazia = usa a `basePrompt`, e nesse
       * caso a imagem só se diferencia pelo denoising, não pelo conteúdo.
       */
      quadrantPrompts?: Record<string, string>;
    };
    depthMap: { enabled: boolean };
    /**
     * A peça espera por um aceno antes de acordar: sem som nem imagem gerada
     * até alguém acenar à câmara, com um mini tutorial na projeção. Ausente =
     * desligado, para os ambientes antigos arrancarem como sempre.
     */
    saudacao?: { enabled: boolean };
    /**
     * Pintura no ar acionada por profundidade. Requer depthMap.enabled — é do
     * mapa que sai o gatilho do eixo Z. Quando ligado, a janela de projeção
     * mostra a tela composta em vez das ferramentas 3D de profundidade.
     */
    airPainting?: { enabled: boolean };
    /**
     * Biometria facial (malha de rosto do MediaPipe). Ausente = ligada, para as
     * exposições antigas não mudarem. Desligar poupa ~23 ms por frame no motor,
     * e só faz sentido onde nada consome os valores do rosto.
     */
    faceTracking?: { enabled: boolean };
    /**
     * Simulação de fluidos em WebGL2 no frontend, com a saída a alimentar o
     * StreamDiffusion. Exclui as ferramentas 3D de profundidade na projeção.
     */
    fluid?: { enabled: boolean };
  };
  defaults: {
    cfg: number;
    denoising: number;
    steps: number;
    seed: number;
    activeSensors: Record<string, boolean>;
    music: { layers: Record<string, number> };
    depthViz?: {
      technique: string;
      colorMode: string;
      baseColor: string;
      amplitude: number;
      contrast: number;
      threshold: number;
      pointSize: number;
      resolution: number;
      waveSize: number;
      waveSpeed: number;
      /** Realce da silhueta e do brilho (0 desliga). Opcional: 0.8 por omissão. */
      glow?: number;
      /** Degraus de profundidade (0 = superfície contínua). Opcional. */
      slices?: number;
    };
  };
  graph: NodeGraph;
}

export function validateExhibition(obj: any): string[] {
  const errors: string[] = [];
  if (typeof obj !== "object" || obj === null) return ["ficheiro .sen não é um objeto JSON"];
  if (obj.senVersion !== 1) errors.push("senVersion deve ser 1");
  if (typeof obj.id !== "string" || !obj.id) errors.push("id em falta");
  if (typeof obj.name !== "string" || !obj.name) errors.push("name em falta");
  if (typeof obj.engine?.streamdiffusion?.enabled !== "boolean") errors.push("engine.streamdiffusion.enabled deve ser boolean");
  if (typeof obj.engine?.depthMap?.enabled !== "boolean") errors.push("engine.depthMap.enabled deve ser boolean");
  if (obj.engine?.airPainting !== undefined && typeof obj.engine?.airPainting?.enabled !== "boolean")
    errors.push("engine.airPainting.enabled deve ser boolean");
  if (obj.engine?.airPainting?.enabled && !obj.engine?.depthMap?.enabled)
    errors.push("engine.airPainting requer engine.depthMap.enabled — o gatilho vem do mapa de profundidade");
  if (obj.engine?.fluid !== undefined && typeof obj.engine?.fluid?.enabled !== "boolean")
    errors.push("engine.fluid.enabled deve ser boolean");
  if (obj.engine?.fluid?.enabled && obj.engine?.airPainting?.enabled)
    errors.push("engine.fluid e engine.airPainting não podem estar ligados ao mesmo tempo — disputam a janela de projeção");
  if (typeof obj.defaults?.cfg !== "number") errors.push("defaults.cfg deve ser number");
  if (typeof obj.defaults?.seed !== "number") errors.push("defaults.seed deve ser number");
  if (!Array.isArray(obj.graph?.nodes)) errors.push("graph.nodes deve ser um array");
  if (!Array.isArray(obj.graph?.connections)) errors.push("graph.connections deve ser um array");
  const ids = new Set<string>();
  for (const n of obj.graph?.nodes || []) {
    if (!NODE_TYPES[n.type as NodeTypeId]) errors.push(`tipo de node desconhecido: ${n.type}`);
    if (ids.has(n.id)) errors.push(`id de node duplicado: ${n.id}`);
    ids.add(n.id);
  }
  for (const c of obj.graph?.connections || []) {
    if (!ids.has(c.from?.[0])) errors.push(`ligação refere-se a node inexistente: ${c.from?.[0]}`);
    if (!ids.has(c.to?.[0])) errors.push(`ligação refere-se a node inexistente: ${c.to?.[0]}`);
  }
  return errors;
}
