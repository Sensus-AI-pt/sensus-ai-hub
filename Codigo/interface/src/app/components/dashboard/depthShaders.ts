/**
 * Shaders das Depth Map Tools.
 *
 * Todas as técnicas leem o mesmo mapa de profundidade (claro = perto, escuro =
 * longe, normalizado por frame pelo Depth Anything V2 — Yang et al., 2024,
 * arXiv:2406.09414) e partilham a mesma cadeia de leitura, para que um controlo
 * do painel signifique a mesma coisa em qualquer técnica:
 *
 *   luma → contraste → onda → fatias → limiar → deslocamento em Z
 *
 * Antes desta passagem, metade dos controlos só valia para o Point Cloud: o
 * limiar não cortava o fundo em quatro das seis técnicas, o modo de cor não
 * saía do Point Cloud, e o tamanho do ponto não chegava às Partículas. Um
 * painel cheio de comandos que não fazem nada ensina a não mexer no painel.
 */

/** Leitura da profundidade e modos de cor — partilhado por todas as técnicas. */
const COMUM = `
uniform sampler2D uTexture;
uniform float uContrast;
uniform float uSlices;

/**
 * Profundidade em 0..1 no ponto uv, já com contraste.
 * Sem clamp: o corte fica a cargo do limiar, e limitar aqui achatava o relevo
 * das zonas muito claras (o rosto, quase sempre) contra o resto.
 */
float lerProfundidade(vec2 uv) {
  float luma = dot(texture2D(uTexture, uv).rgb, vec3(0.299, 0.587, 0.114));
  return (luma - 0.5) * uContrast + 0.5;
}

/**
 * Fatias: arredonda a profundidade a N degraus. A superfície contínua passa a
 * um modelo de camadas, como uma maqueta cortada a laser. Zero desliga.
 */
float emFatias(float d) {
  return uSlices >= 1.0 ? floor(d * uSlices) / uSlices : d;
}
`;

/** Paleta partilhada: o mesmo "Modo de Cor" em todas as técnicas que colorem. */
const CORES = `
uniform int uColorMode;
uniform vec3 uBaseColor;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 corDoModo(float depth, vec2 uv, vec3 normalCam, float t) {
  if (uColorMode == 0) return vec3(depth);
  if (uColorMode == 1) return hsv2rgb(vec3(depth * 0.8 - t * 0.1, 1.0, 1.0));
  if (uColorMode == 2) {
    float contour = fract(depth * 20.0 - t * 0.5);
    float line = smoothstep(0.0, 0.1, contour) * smoothstep(1.0, 0.9, contour);
    return mix(vec3(0.0), vec3(0.0, 1.0, 0.5), line);
  }
  if (uColorMode == 3) return normalCam * 0.5 + 0.5;
  if (uColorMode == 4) {
    float scanline = sin(uv.y * 200.0 - t * 10.0) * 0.5 + 0.5;
    return vec3(depth) * vec3(0.2, 0.8, 1.0) * scanline;
  }
  return uBaseColor * depth;
}
`;

// ── Point Cloud / Malha de arame ─────────────────────────────────────────────
// O mesmo par de shaders serve os pontos e a malha: o que muda é a primitiva
// (`<points>` ou `<mesh wireframe>`), não o cálculo. Uma técnica nova por uma
// bandeira do material é melhor negócio do que um terceiro shader a manter.

export const pcVertexShader = COMUM + `
uniform float uAmplitude;
uniform float uPointSize;
uniform float uThreshold;
uniform float uTime;
uniform float uWaveSize;
uniform float uWaveSpeed;

varying vec2 vUv;
varying float vVisibility;
varying float vDepth;
varying vec3 vNormalCam;
varying float vSilhueta;

void main() {
  vUv = uv;
  float depth = lerProfundidade(vUv);

  float wave = sin(vUv.x * 20.0 + uTime * uWaveSpeed) * cos(vUv.y * 20.0 + uTime * uWaveSpeed) * uWaveSize;
  depth = emFatias(depth + wave);

  vVisibility = depth < uThreshold ? 0.0 : 1.0;
  vDepth = depth;

  vec3 pos = position;
  pos.z += depth * uAmplitude;

  float dX = lerProfundidade(vUv + vec2(0.01, 0.0));
  float dY = lerProfundidade(vUv + vec2(0.0, 0.01));
  vec3 p0 = vec3(0.0, 0.0, depth * uAmplitude);
  vec3 pX = vec3(0.01, 0.0, dX * uAmplitude);
  vec3 pY = vec3(0.0, 0.01, dY * uAmplitude);
  vec3 norm = normalize(cross(pX - p0, pY - p0));
  vNormalCam = normalMatrix * norm;

  // Silhueta: onde a superfície se dobra a pique, a normal deixa de apontar à
  // câmara. É esse o contorno da pessoa dentro da nuvem, e é o que dá volume a
  // um amontoado de pontos todos iguais.
  vSilhueta = 1.0 - abs(normalize(vNormalCam).z);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // O tamanho segue a profundidade além da perspetiva: o que está à frente
  // ganha corpo e o fundo afina, que é o que separa as duas camadas.
  gl_PointSize = uPointSize * (0.55 + 0.9 * clamp(depth, 0.0, 1.0)) * (10.0 / -mvPosition.z);
}
`;

export const pcFragmentShader = CORES + `
uniform float uOpacity;
uniform float uTime;
uniform float uGlow;

varying vec2 vUv;
varying float vVisibility;
varying float vDepth;
varying vec3 vNormalCam;
varying float vSilhueta;

void main() {
  if (vVisibility < 0.5) discard;

  // Queda radial em vez de um disco de bordo duro. Com mistura aditiva, milhares
  // de discos duros somam-se numa pasta chapada; com queda, cada ponto tem um
  // halo e o conjunto lê-se como volume iluminado.
  float sprite = 1.0;
  #ifdef IS_POINTS
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float r2 = dot(circCoord, circCoord);
    if (r2 > 1.0) discard;
    sprite = pow(1.0 - r2, 1.5);
  #endif

  vec3 col = corDoModo(vDepth, vUv, vNormalCam, uTime);
  col *= 1.0 + vSilhueta * uGlow;

  gl_FragColor = vec4(col * sprite, uOpacity * sprite);
}
`;

// ── Partículas ───────────────────────────────────────────────────────────────
// Partilha o fragment shader do Point Cloud de propósito: as partículas são a
// mesma nuvem, com deriva. Enquanto tiveram shader próprio, ficaram de fora de
// tudo o que o painel oferece — sem modo de cor, sem tamanho de ponto, sem
// limiar — e pintavam o fundo a preto sobre fundo preto, o que sobre mistura
// aditiva é não pintar nada. Daí o efeito ser "uns pontos perdidos pelo ecrã":
// os únicos visíveis eram os poucos acima de 0.4 de profundidade, e esses
// fugiam para longe do corpo de onde tinham saído.

export const particlesVertexShader = COMUM + `
uniform float uAmplitude;
uniform float uPointSize;
uniform float uThreshold;
uniform float uTime;
uniform float uWaveSize;
uniform float uWaveSpeed;

varying vec2 vUv;
varying float vVisibility;
varying float vDepth;
varying vec3 vNormalCam;
varying float vSilhueta;

float rand(vec2 co) { return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vUv = uv;
  float depth = emFatias(lerProfundidade(vUv));
  vVisibility = depth < uThreshold ? 0.0 : 1.0;
  vDepth = depth;

  vec3 pos = position;
  pos.z += depth * uAmplitude;

  // Deriva: cada partícula tem a sua fase, e a amplitude cresce com a
  // proximidade. O que está ao fundo fica quase quieto e segura a forma; o que
  // está à frente solta-se e esfarela. A figura continua legível — é dela que a
  // poeira sai — em vez de se dispersar toda pelo ecrã.
  float n = rand(uv);
  float t = uTime * uWaveSpeed + n * 6.2831;
  float turbulencia = uWaveSize * clamp(depth, 0.0, 1.0);
  pos.x += sin(t) * turbulencia;
  pos.y += cos(t * 0.83) * turbulencia + turbulencia * 0.6 * fract(t * 0.05);
  pos.z += sin(t * 1.37) * turbulencia * uAmplitude * 0.5;

  float dX = lerProfundidade(vUv + vec2(0.01, 0.0));
  float dY = lerProfundidade(vUv + vec2(0.0, 0.01));
  vec3 p0 = vec3(0.0, 0.0, depth * uAmplitude);
  vec3 norm = normalize(cross(vec3(0.01, 0.0, dX * uAmplitude) - p0,
                             vec3(0.0, 0.01, dY * uAmplitude) - p0));
  vNormalCam = normalMatrix * norm;
  vSilhueta = 1.0 - abs(normalize(vNormalCam).z);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // Cintilação: o tamanho oscila com a fase da própria partícula. Sem isto a
  // nuvem move-se em bloco e lê-se como uma textura a tremer.
  float cintila = 0.65 + 0.35 * sin(t * 2.1);
  gl_PointSize = uPointSize * cintila * (0.55 + 0.9 * clamp(depth, 0.0, 1.0)) * (10.0 / -mvPosition.z);
}
`;

// ── Cubos instanciados ───────────────────────────────────────────────────────

export const cubesVertexShader = COMUM + `
uniform float uAmplitude;
uniform float uThreshold;
uniform float uTime;
uniform float uWaveSize;
uniform float uWaveSpeed;
attribute vec3 instancePosition;
attribute vec2 instanceUv;
varying vec2 vUv;
varying float vDepth;
varying float vVisibility;
varying vec3 vNormalCam;
varying float vSilhueta;
void main() {
  vUv = instanceUv;
  float wave = sin(vUv.x * 20.0 + uTime * uWaveSpeed) * cos(vUv.y * 20.0 + uTime * uWaveSpeed) * uWaveSize;
  float depth = clamp(emFatias(lerProfundidade(vUv) + wave), 0.0, 1.0);
  vDepth = depth;
  vVisibility = depth < uThreshold ? 0.0 : 1.0;
  // O cubo tem normais a sério — não é preciso derivá-las do mapa.
  vNormalCam = normalMatrix * normal;
  vSilhueta = 1.0 - abs(normalize(vNormalCam).z);

  vec3 pos = position;
  pos.z *= (vDepth * 5.0 + 0.1);
  vec3 finalPos = pos + instancePosition;
  finalPos.z += vDepth * uAmplitude;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
}
`;

export const cubesFragmentShader = CORES + `
uniform float uTime;
uniform float uGlow;
varying vec2 vUv;
varying float vDepth;
varying float vVisibility;
varying vec3 vNormalCam;
varying float vSilhueta;
void main() {
  if (vVisibility < 0.5) discard;
  vec3 col = corDoModo(vDepth, vUv, vNormalCam, uTime);
  col *= 1.0 + vSilhueta * uGlow;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── Laser topográfico ────────────────────────────────────────────────────────

export const laserVertexShader = COMUM + `
uniform float uAmplitude;
uniform float uThreshold;
varying vec2 vUv;
varying float vDepth;
varying float vVisibility;
void main() {
  vUv = uv;
  float depth = clamp(emFatias(lerProfundidade(vUv)), 0.0, 1.0);
  vDepth = depth;
  vVisibility = depth < uThreshold ? 0.0 : 1.0;
  vec3 pos = position;
  pos.z += vDepth * uAmplitude;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const laserFragmentShader = `
uniform float uTime;
uniform float uGlow;
uniform vec3 uLaserColor;
varying vec2 vUv;
varying float vDepth;
varying float vVisibility;
void main() {
  if (vVisibility < 0.5) discard;
  float contour = fract(vDepth * 30.0 - uTime * 0.5);
  float line = smoothstep(0.0, 0.05, contour) * smoothstep(1.0, 0.95, contour);
  float sweep = fract(vUv.y * 2.0 - uTime * 0.3);
  float laser = smoothstep(0.01, 0.0, abs(sweep - 0.5));
  vec3 col = mix(vec3(0.0, 0.05, 0.1), uLaserColor, line);
  col += uLaserColor * laser * (1.0 + uGlow);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── Reiluminação ─────────────────────────────────────────────────────────────

export const relightVertexShader = COMUM + `
uniform float uAmplitude;
uniform float uThreshold;
varying vec2 vUv;
varying vec3 vWorldPos;
varying float vVisibility;
void main() {
  vUv = uv;
  float depth = emFatias(lerProfundidade(uv));
  vVisibility = depth < uThreshold ? 0.0 : 1.0;
  vec3 pos = position;
  pos.z += depth * uAmplitude * 0.1;
  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const relightFragmentShader = `
uniform sampler2D uTexture;
uniform float uContrast;
uniform float uAmplitude;
uniform float uGlow;
uniform vec3 uLightPos;
varying vec2 vUv;
varying vec3 vWorldPos;
varying float vVisibility;

float getDepth(vec2 uv) {
   float luma = dot(texture2D(uTexture, uv).rgb, vec3(0.299, 0.587, 0.114));
   return clamp((luma - 0.5) * uContrast + 0.5, 0.0, 1.0);
}

void main() {
  if (vVisibility < 0.5) discard;
  float d = getDepth(vUv);
  float dX = getDepth(vUv + vec2(0.01, 0.0));
  float dY = getDepth(vUv + vec2(0.0, 0.01));

  vec3 p0 = vec3(0.0, 0.0, d * uAmplitude);
  vec3 pX = vec3(0.01, 0.0, dX * uAmplitude);
  vec3 pY = vec3(0.0, 0.01, dY * uAmplitude);
  vec3 surfNormal = normalize(cross(pX - p0, pY - p0));

  vec3 lightDir = normalize(uLightPos - vWorldPos);
  float diff = max(dot(surfNormal, lightDir), 0.0);

  vec3 baseColor = texture2D(uTexture, vUv).rgb;
  vec3 ambient = baseColor * 0.2;
  vec3 diffuse = baseColor * diff * 1.5;

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 reflectDir = reflect(-lightDir, surfNormal);
  float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);

  gl_FragColor = vec4(ambient + diffuse + vec3(spec * (0.5 + uGlow)), 1.0);
}
`;

// ── Máscara em Z ─────────────────────────────────────────────────────────────

export const zmaskVertexShader = COMUM + `
uniform float uAmplitude;
uniform float uThreshold;
varying vec2 vUv;
varying float vVisibility;
void main() {
  vUv = uv;
  float depth = clamp(emFatias(lerProfundidade(uv)), 0.0, 1.0);
  vVisibility = depth < uThreshold ? 0.0 : 1.0;
  vec3 pos = position;
  pos.z += depth * uAmplitude;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const zmaskFragmentShader = `
uniform sampler2D uTexture;
varying vec2 vUv;
varying float vVisibility;
void main() {
  if (vVisibility < 0.5) discard;
  vec4 col = texture2D(uTexture, vUv);
  gl_FragColor = vec4(col.rgb, 1.0);
}
`;
