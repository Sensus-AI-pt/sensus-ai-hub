/**
 * Presets do ambiente Fluid AI. Cada um muda ao mesmo tempo a física do fluido
 * (local, na GPU do frontend) e a prompt do StreamDiffusion (no motor Python,
 * por comando). São os dois lados do mesmo aspeto: a forma do movimento e o
 * estilo com que ele é reinterpretado.
 */

export interface FluidPhysics {
  /** Perda de velocidade por frame. 1.0 = sem perda; abaixo disso o movimento pára. */
  velocityDissipation: number;
  /** Perda de tinta por frame. Controla quanto tempo o traço fica visível. */
  densityDissipation: number;
  /** Confinamento de vorticidade: devolve os redemoinhos que a grelha dissipa. */
  curl: number;
  /** Iterações de Jacobi na pressão. Mais = fluido mais incompressível, mais custo. */
  pressureIterations: number;
  /** Empuxo segundo a luminância da tinta. Positivo = o "calor" sobe. */
  buoyancy: number;
  /** Cor da tinta deixada pelo movimento filmado (RGB 0-1). */
  corMovimento: [number, number, number];
  /** Cor da tinta de fundo, por segundo (RGB, multiplicada pelo dt). */
  corFundo: [number, number, number];
  /** Força com que o movimento filmado empurra o fluido. */
  forcaCamara: number;
  /** Corrente de fundo. 0 = o fluido só se mexe quando alguém se mexe. */
  correnteFundo: number;
  /**
   * Espelha o movimento filmado. Omisso = ligado, que é o comportamento que os
   * presets sempre tiveram — por isso é opcional e nenhum deles precisa de o
   * declarar.
   */
  espelharCamara?: boolean;
}

export interface FluidPreset {
  id: string;
  label: string;
  /** Descrição curta para o painel — o que muda, em linguagem simples. */
  nota: string;
  prompt: string;
  physics: FluidPhysics;
}

export const FLUID_PRESETS: readonly FluidPreset[] = [
  {
    id: "cyberpunk",
    label: "Cyberpunk HUD",
    nota: "Rasto longo e muito turbulento, azul e magenta elétricos.",
    prompt:
      "cyberpunk neon city, futuristic surveillance HUD overlay, glowing blue and magenta lights, rain-slicked pavement, high tech simulation, 8k, detailed",
    physics: {
      velocityDissipation: 0.995,
      densityDissipation: 0.992,
      curl: 48.0,
      pressureIterations: 20,
      buoyancy: 0.0,
      corMovimento: [0.10, 0.34, 0.95],
      corFundo: [1.12, 0.32, 6.08],
      forcaCamara: 1500,
      correnteFundo: 170,
    },
  },
  {
    id: "termica",
    label: "Visão Térmica",
    nota: "A tinta sobe como calor e apaga-se depressa. Laranjas e amarelos.",
    prompt:
      "thermal imaging camera scan, FLIR heat map vision, bright yellow orange and blue temperature gradients, military tactical sensor view, high contrast",
    physics: {
      velocityDissipation: 0.975,
      densityDissipation: 0.96,
      curl: 10.0,
      pressureIterations: 18,
      buoyancy: 1.4,
      corMovimento: [1.00, 0.42, 0.03],
      corFundo: [5.44, 1.76, 0.06],
      forcaCamara: 1100,
      correnteFundo: 120,
    },
  },
  {
    id: "render3d",
    label: "Render 3D",
    nota: "Espesso e lento, quase sem redemoinhos. Verdes e turquesas.",
    prompt:
      "3d digital animation style, clay renders, octane render lighting, vibrant vivid colors, smooth surfaces, cute stylized characters, cinematic volumetric light",
    physics: {
      velocityDissipation: 0.93,
      densityDissipation: 0.985,
      curl: 1.5,
      pressureIterations: 20,
      buoyancy: 0.0,
      corMovimento: [0.30, 0.85, 0.55],
      corFundo: [1.76, 5.12, 3.52],
      forcaCamara: 600,
      correnteFundo: 45,
    },
  },
  {
    id: "blueprint",
    label: "Blueprint Técnico",
    nota: "Traço direto e seco, sem rotação nenhuma. Azul de esferográfica.",
    prompt:
      "architectural blueprint drawing, glowing white grid lines on deep navy blue paper, CAD draft drawing, technical schematic, clean lineart, vector graphic design",
    physics: {
      velocityDissipation: 0.88,
      densityDissipation: 0.9,
      curl: 0.0,
      pressureIterations: 16,
      buoyancy: 0.0,
      corMovimento: [0.55, 0.80, 1.00],
      corFundo: [0.96, 2.24, 6.08],
      forcaCamara: 2200,
      correnteFundo: 210,
    },
  },
  {
    id: "origami",
    label: "Mundo de Papel",
    nota: "Quase não apaga: a tinta acumula-se e assenta. Tons de papel.",
    prompt:
      "diorama made of folded paper, origami style, intricate papercraft textures, depth of field, tilt-shift lens photo, soft warm studio lighting",
    physics: {
      velocityDissipation: 0.96,
      densityDissipation: 0.999,
      curl: 5.0,
      pressureIterations: 20,
      buoyancy: -0.35,
      corMovimento: [1.00, 0.72, 0.38],
      corFundo: [4.16, 2.72, 1.28],
      forcaCamara: 800,
      correnteFundo: 60,
    },
  },
  {
    id: "foto",
    label: "Fotorrealismo",
    nota: "Água natural, sem viscosidade. Cinzentos e brancos frios.",
    prompt:
      "raw photorealistic documentary footage, 8k resolution, cinematic lighting, ultra detailed skin and fabric textures, shot on 35mm lens, natural environment",
    physics: {
      velocityDissipation: 1.0,
      densityDissipation: 0.975,
      curl: 24.0,
      pressureIterations: 20,
      buoyancy: 0.0,
      corMovimento: [0.85, 0.88, 0.95],
      corFundo: [2.88, 3.04, 3.84],
      forcaCamara: 1000,
      correnteFundo: 95,
    },
  },
] as const;

export const PRESET_POR_OMISSAO = FLUID_PRESETS[0];
