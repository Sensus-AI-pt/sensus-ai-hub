import { Component, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  pcVertexShader, pcFragmentShader,
  cubesVertexShader, cubesFragmentShader,
  laserVertexShader, laserFragmentShader,
  relightVertexShader, relightFragmentShader,
  zmaskVertexShader, zmaskFragmentShader,
  particlesVertexShader,
} from "./depthShaders";

const COLOR_MODES = ["Grayscale", "Rainbow", "Contour", "Normal", "Hologram", "Tint"];

export interface DepthVizParams {
  technique: string;
  amplitude: number;
  contrast: number;
  threshold: number;
  colorMode: string;
  baseColor: string;
  pointSize: number;
  resolution: number;
  waveSize: number;
  waveSpeed: number;
  /** Realce da silhueta e do brilho. 0 desliga. */
  glow: number;
  /** Degraus de profundidade (0 = superfície contínua). */
  slices: number;
}

/**
 * Textura do mapa de profundidade, atualizada a cada frame que chega do motor.
 *
 * Sem canvas intermédio: a imagem descodificada vai direta para a textura. O
 * canvas obrigava a uma cópia do frame inteiro em CPU antes de cada envio para
 * a GPU, e não dava nada em troca.
 *
 * Um frame que chegue enquanto o anterior ainda está a descodificar é guardado
 * e substituído pelo seguinte, nunca enfileirado: mostrar profundidade
 * atrasada é pior do que saltar um frame — a mesma regra que o motor já aplica
 * do outro lado, na thread de inferência.
 */
function useDepthTexture(depthMapUrl?: string) {
  const texRef = useRef<THREE.Texture | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const aspectRef = useRef(16 / 9);
  const ocupado = useRef(false);
  const pendente = useRef<string | null>(null);

  if (!texRef.current) {
    // Arranca 1x1 preto e não 0x0: uma textura sobre uma imagem de dimensão
    // zero faz o WebGL emitir INVALID_VALUE ao carregar, e o frame perde-se.
    // Acontece sempre que a imagem ainda não chegou, que é o primeiro render.
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 1, 1);
    }
    texRef.current = new THREE.Texture(c);
    texRef.current.minFilter = THREE.LinearFilter;
    texRef.current.magFilter = THREE.LinearFilter;
    texRef.current.needsUpdate = true;
  }

  const carregar = useCallback((url: string) => {
    ocupado.current = true;
    const img = imgRef.current ?? (imgRef.current = new Image());
    img.src = url;
    img
      .decode()
      .then(() => {
        const tex = texRef.current;
        if (!tex || !img.naturalWidth) return;
        tex.image = img;
        tex.needsUpdate = true;
        aspectRef.current = img.naturalWidth / img.naturalHeight || 16 / 9;
      })
      .catch(() => {
        /* frame corrompido ou substituído a meio: o seguinte resolve. */
      })
      .finally(() => {
        ocupado.current = false;
        const seguinte = pendente.current;
        pendente.current = null;
        if (seguinte && seguinte !== url) carregar(seguinte);
      });
  }, []);

  useEffect(() => {
    if (!depthMapUrl) return;
    if (ocupado.current) {
      pendente.current = depthMapUrl;
      return;
    }
    carregar(depthMapUrl);
  }, [depthMapUrl, carregar]);

  return { texture: texRef.current, aspectRatio: aspectRef.current };
}

type VizProps = { texture: THREE.Texture; aspectRatio: number; p: DepthVizParams };

/**
 * O bloco de uniforms que todas as técnicas partilham, e a sua atualização por
 * frame. Cada shader declara só as que usa; as que sobram são ignoradas pelo
 * three.js. Vale a repetição que poupa: enquanto cada técnica montava a sua
 * lista, uma esquecia-se do tamanho do ponto, outra do limiar, e o painel ficava
 * com controlos que não faziam nada consoante a técnica escolhida.
 */
function useUniformesPartilhados(texture: THREE.Texture, p: DepthVizParams) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({
    uTexture: { value: texture },
    uAmplitude: { value: p.amplitude },
    uContrast: { value: p.contrast },
    uThreshold: { value: p.threshold },
    uPointSize: { value: p.pointSize },
    uColorMode: { value: COLOR_MODES.indexOf(p.colorMode) },
    uBaseColor: { value: new THREE.Color(p.baseColor) },
    uLaserColor: { value: new THREE.Color(p.baseColor) },
    uLightPos: { value: new THREE.Vector3() },
    uOpacity: { value: 1.0 },
    uGlow: { value: p.glow },
    uSlices: { value: p.slices },
    uWaveSize: { value: p.waveSize },
    uWaveSpeed: { value: p.waveSpeed },
    uTime: { value: 0 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [texture]);

  useFrame((state) => {
    const u = matRef.current?.uniforms;
    if (!u) return;
    const t = state.clock.elapsedTime;
    u.uAmplitude.value = p.amplitude;
    u.uContrast.value = p.contrast;
    u.uThreshold.value = p.threshold;
    u.uPointSize.value = p.pointSize;
    u.uColorMode.value = COLOR_MODES.indexOf(p.colorMode);
    u.uBaseColor.value.set(p.baseColor);
    u.uLaserColor.value.set(p.baseColor);
    u.uGlow.value = p.glow;
    u.uSlices.value = p.slices;
    u.uWaveSize.value = p.waveSize;
    u.uWaveSpeed.value = p.waveSpeed;
    u.uTime.value = t;
    // Luz em órbita, para a reiluminação ter de onde vir.
    u.uLightPos.value.set(Math.sin(t) * 4, Math.cos(t) * 4, 2.0);
  });

  return { matRef, uniforms };
}

/**
 * Malha plana com a resolução pedida, libertada quando muda.
 *
 * Sem o `dispose`, cada passagem pelo seletor de resolução deixava a malha
 * anterior na VRAM — e a 1024×1024 são mais de um milhão de vértices por cada
 * uma que ficava para trás.
 */
function usePlano(aspectRatio: number, segmentos: number) {
  const geo = useMemo(
    () => new THREE.PlaneGeometry(10 * aspectRatio, 10, segmentos, segmentos),
    [aspectRatio, segmentos],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  return geo;
}

/** Resolução pedida, limitada ao que a técnica aguenta sem deixar de ser tempo real. */
function resolucao(p: DepthVizParams, maximo: number) {
  return Math.max(32, Math.min(p.resolution || 256, maximo));
}

function PointCloudViz({ texture, aspectRatio, p }: VizProps) {
  const { matRef, uniforms } = useUniformesPartilhados(texture, p);
  const geometry = usePlano(aspectRatio, resolucao(p, 1024));
  return (
    <points geometry={geometry}>
      <shaderMaterial ref={matRef} vertexShader={pcVertexShader} fragmentShader={"#define IS_POINTS\n" + pcFragmentShader} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

/**
 * Malha de arame: os mesmos shaders do Point Cloud, desenhados como arestas em
 * vez de pontos. Uma técnica inteira por uma bandeira do material — não havia
 * motivo para escrever um terceiro par de shaders para dizer o mesmo.
 */
function WireframeViz({ texture, aspectRatio, p }: VizProps) {
  const { matRef, uniforms } = useUniformesPartilhados(texture, p);
  // Teto mais baixo do que o dos pontos: cada quadrado da malha custa três
  // arestas, e acima disto deixa de ser malha para ser uma mancha cheia.
  const geometry = usePlano(aspectRatio, resolucao(p, 256));
  return (
    <mesh geometry={geometry}>
      <shaderMaterial ref={matRef} wireframe vertexShader={pcVertexShader} fragmentShader={pcFragmentShader} uniforms={uniforms} transparent depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}

function ParticlesViz({ texture, aspectRatio, p }: VizProps) {
  const { matRef, uniforms } = useUniformesPartilhados(texture, p);
  const geometry = usePlano(aspectRatio, resolucao(p, 512));
  return (
    <points geometry={geometry}>
      <shaderMaterial ref={matRef} vertexShader={particlesVertexShader} fragmentShader={"#define IS_POINTS\n" + pcFragmentShader} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function InstancedCubesViz({ texture, aspectRatio, p }: VizProps) {
  const { matRef, uniforms } = useUniformesPartilhados(texture, p);
  const res = resolucao(p, 128);
  const count = res * res;
  const geometry = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const width = 10 * aspectRatio, height = 10;
    let i = 0;
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        pos[i * 3] = (x / (res - 1) - 0.5) * width;
        pos[i * 3 + 1] = (y / (res - 1) - 0.5) * height;
        pos[i * 3 + 2] = 0;
        uv[i * 2] = x / (res - 1);
        uv[i * 2 + 1] = y / (res - 1);
        i++;
      }
    }
    const geo = new THREE.InstancedBufferGeometry();
    const baseGeo = new THREE.BoxGeometry((10 * aspectRatio) / res * 0.8, 10 / res * 0.8, 10 / res * 0.8);
    geo.index = baseGeo.index;
    geo.attributes = baseGeo.attributes;
    geo.setAttribute("instancePosition", new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute("instanceUv", new THREE.InstancedBufferAttribute(uv, 2));
    geo.instanceCount = count;
    return geo;
  }, [res, aspectRatio, count]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh>
      <primitive object={geometry} attach="geometry" />
      <shaderMaterial ref={matRef} transparent={false} vertexShader={cubesVertexShader} fragmentShader={cubesFragmentShader} uniforms={uniforms} />
    </mesh>
  );
}

function TopographicViz({ texture, aspectRatio, p }: VizProps) {
  const { matRef, uniforms } = useUniformesPartilhados(texture, p);
  const geometry = usePlano(aspectRatio, resolucao(p, 512));
  return (
    <mesh geometry={geometry}>
      <shaderMaterial ref={matRef} transparent side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} vertexShader={laserVertexShader} fragmentShader={laserFragmentShader} uniforms={uniforms} />
    </mesh>
  );
}

function RelightingViz({ texture, aspectRatio, p }: VizProps) {
  const { matRef, uniforms } = useUniformesPartilhados(texture, p);
  const geometry = usePlano(aspectRatio, resolucao(p, 256));
  return (
    <mesh geometry={geometry}>
      <shaderMaterial ref={matRef} vertexShader={relightVertexShader} fragmentShader={relightFragmentShader} uniforms={uniforms} />
    </mesh>
  );
}

function ZMaskingViz({ texture, aspectRatio, p }: VizProps) {
  const { matRef, uniforms } = useUniformesPartilhados(texture, p);
  const geometry = usePlano(aspectRatio, resolucao(p, 512));
  return (
    <mesh geometry={geometry}>
      <shaderMaterial ref={matRef} transparent={false} depthWrite side={THREE.DoubleSide} vertexShader={zmaskVertexShader} fragmentShader={zmaskFragmentShader} uniforms={uniforms} />
    </mesh>
  );
}

/**
 * Aplica a distância e o campo de visão pedidos pelo painel.
 *
 * Tem de ser aqui dentro e não na prop `camera` do `<Canvas>`: o R3F só monta a
 * câmara a partir dessa prop uma vez, e as alterações seguintes nunca chegavam
 * à cena — o slider da distância mexia num número que ninguém lia.
 *
 * Só o raio muda, e só quando o valor muda mesmo: assim o OrbitControls (e a
 * órbita automática) mantém o ângulo onde estava, em vez de a cena saltar para
 * a frente a cada ajuste.
 */
function CameraDaCena({ fov, distance }: { fov: number; distance: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useEffect(() => {
    // 1.083 = |(0, -5, 12)| / 12 — mantém a proporção da posição por omissão.
    camera.position.setLength(distance * 1.083);
  }, [camera, distance]);
  useEffect(() => {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }, [camera, fov]);
  return null;
}

function Viewport({ texture, aspectRatio, p }: VizProps) {
  switch (p.technique) {
    case "point_cloud": return <PointCloudViz texture={texture} aspectRatio={aspectRatio} p={p} />;
    case "wireframe": return <WireframeViz texture={texture} aspectRatio={aspectRatio} p={p} />;
    case "instanced_cubes": return <InstancedCubesViz texture={texture} aspectRatio={aspectRatio} p={p} />;
    case "topographic_laser": return <TopographicViz texture={texture} aspectRatio={aspectRatio} p={p} />;
    case "relighting": return <RelightingViz texture={texture} aspectRatio={aspectRatio} p={p} />;
    case "z_masking": return <ZMaskingViz texture={texture} aspectRatio={aspectRatio} p={p} />;
    case "particles": return <ParticlesViz texture={texture} aspectRatio={aspectRatio} p={p} />;
    default: return null;
  }
}

const DEFAULT_PARAMS: DepthVizParams = {
  technique: "point_cloud", amplitude: 3.0, contrast: 1.5, threshold: 0.05,
  colorMode: "Rainbow", baseColor: "#00f0ff", pointSize: 3.0, resolution: 256,
  waveSize: 0.0, waveSpeed: 1.0, glow: 0.8, slices: 0,
};

interface Transform3D { posX: number; posY: number; posZ: number; rotX: number; rotY: number; rotZ: number; scale: number }
interface Camera3D { fov: number; distance: number; autoOrbit: boolean; orbitSpeed: number }
interface Light3D { intensity: number; color: string }

const DEFAULT_TRANSFORM: Transform3D = { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 1 };
const DEFAULT_CAMERA: Camera3D = { fov: 50, distance: 12, autoOrbit: false, orbitSpeed: 0.6 };
const DEFAULT_LIGHT: Light3D = { intensity: 0.5, color: "#ffffff" };

const DEG_TO_RAD = Math.PI / 180;

/**
 * Uma excecao dentro do canvas 3D desmonta a arvore inteira e deixa a janela
 * preta, sem qualquer indicacao do que falhou. Esta barreira mostra a mensagem
 * e escreve-a na consola, que o processo principal encaminha para o log.
 */
class DepthErrorBoundary extends Component<{ children: ReactNode }, { erro: string | null }> {
  state = { erro: null as string | null };

  static getDerivedStateFromError(e: any) {
    return { erro: e?.message ? String(e.message) : String(e) };
  }

  componentDidCatch(e: any) {
    console.error("[DepthVisualizer] falhou:", e);
  }

  render() {
    if (this.state.erro) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
          <span className="text-[11px] text-white/50">Falha na visualizacao 3D</span>
          <span className="max-w-lg text-[10px] text-white/30">{this.state.erro}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

function DepthVisualizerInner({
  depthMapUrl,
  params,
  backgroundUrl,
  backgroundDepthUrl,
}: {
  depthMapUrl?: string;
  params?: Partial<DepthVizParams> & { transform?: Partial<Transform3D>; camera?: Partial<Camera3D>; light?: Partial<Light3D> };
  /** Imagem de cenário desenhada por trás do efeito. Ausente = fundo preto. */
  backgroundUrl?: string;
  /**
   * Mapa de profundidade da imagem de cenário. Quando presente, o efeito é
   * aplicado também ao cenário, numa camada por trás, e a camada da câmara
   * fica sobreposta. Ausente = só a camada da câmara.
   */
  backgroundDepthUrl?: string;
}) {
  const { texture, aspectRatio } = useDepthTexture(depthMapUrl);
  const bg = useDepthTexture(backgroundDepthUrl);
  const p: DepthVizParams = { ...DEFAULT_PARAMS, ...params };
  const transform: Transform3D = { ...DEFAULT_TRANSFORM, ...params?.transform };
  const camera: Camera3D = { ...DEFAULT_CAMERA, ...params?.camera };
  const light: Light3D = { ...DEFAULT_LIGHT, ...params?.light };
  // Mantém a proporção da posição por omissão (0,-5,12) ao escalar por "distance".
  const camPos: [number, number, number] = [0, -camera.distance * (5 / 12), camera.distance];

  return (
    <div className="relative h-full w-full bg-black">
      {backgroundUrl && (
        <img
          src={backgroundUrl}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full object-cover"
        />
      )}
      {/* O canvas fica transparente para o cenário se ver por trás. As técnicas
          usam AdditiveBlending, pelo que compõem naturalmente sobre a imagem. */}
      <Canvas
        className="relative"
        gl={{ alpha: true }}
        // Teto na densidade de píxeis: num projetor 4K, renderizar a 2x custa
        // quatro vezes mais fragmentos para uma nuvem de pontos que ninguém vê
        // ao dobro da resolução. É o ganho mais barato que esta cena tem.
        dpr={[1, 1.5]}
        style={{ background: "transparent" }}
        camera={{ position: camPos, fov: camera.fov }}
      >
        <ambientLight intensity={light.intensity} color={light.color} />
        <CameraDaCena fov={camera.fov} distance={camera.distance} />

        {/* Camada de trás: o mesmo efeito aplicado ao cenário. Recuada em Z e
            ligeiramente maior, para ler como plano de fundo; a amplitude é
            reduzida para não competir com a camada da câmara à frente. */}
        {backgroundDepthUrl && (
          <group position={[0, 0, -7]} scale={1.35}>
            <Viewport
              texture={bg.texture}
              aspectRatio={bg.aspectRatio}
              p={{ ...p, amplitude: p.amplitude * 0.6, pointSize: p.pointSize * 0.8 }}
            />
          </group>
        )}

        {/* Camada da frente: a câmara ao vivo, sobreposta ao cenário. */}
        <group
          position={[transform.posX, transform.posY, transform.posZ]}
          rotation={[transform.rotX * DEG_TO_RAD, transform.rotY * DEG_TO_RAD, transform.rotZ * DEG_TO_RAD]}
          scale={transform.scale}
        >
          <Viewport texture={texture} aspectRatio={aspectRatio} p={p} />
        </group>
        <OrbitControls enableDamping dampingFactor={0.05} maxDistance={50} minDistance={2} autoRotate={camera.autoOrbit} autoRotateSpeed={camera.orbitSpeed} />
      </Canvas>
    </div>
  );
}

export function DepthVisualizer(props: Parameters<typeof DepthVisualizerInner>[0]) {
  return (
    <DepthErrorBoundary>
      <DepthVisualizerInner {...props} />
    </DepthErrorBoundary>
  );
}
