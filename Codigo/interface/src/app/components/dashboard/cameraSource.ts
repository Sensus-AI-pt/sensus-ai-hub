/**
 * Fonte de imagem: qual é a câmara de arranque e o que fica guardado.
 *
 * Regra da peça: **o ambiente virtual abre sempre na webcam do PC**. O
 * telemóvel entra por espelhamento scrcpy, que pede autorização no ecrã do
 * telemóvel; se essa autorização não for dada — telemóvel bloqueado, diálogo
 * recusado, cabo mal ligado — a peça arrancava sem imagem e nada no ecrã do
 * operador dizia porquê. Pior: a escolha ficava guardada, por isso o arranque
 * seguinte voltava a esperar pelo telemóvel.
 *
 * Por isso só as câmaras do PC (`pc:<índice>`) são memorizadas entre sessões.
 * Escolher o telemóvel nas configurações troca a fonte **ao vivo**, na sessão
 * que está a correr, e não passa a ser o arranque por omissão.
 */

const CHAVE = "sensus-camera-source";

/** Fonte usada quando não há nada guardado: a primeira webcam do PC. */
export const CAMARA_POR_OMISSAO = "pc:0";

function guardado(): string | null {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

/** Fonte com que o motor arranca. Nunca é o telemóvel. */
export function cameraDeArranque(): string {
  const memoria = guardado();
  return memoria && memoria.startsWith("pc") ? memoria : CAMARA_POR_OMISSAO;
}

/**
 * Guarda a escolha, se ela for memorizável. Devolve o que fica a valer para o
 * próximo arranque, para quem quiser mostrá-lo.
 */
export function guardarCamera(fonte: string): string {
  try {
    if (fonte.startsWith("pc")) localStorage.setItem(CHAVE, fonte);
  } catch {
    /* localStorage indisponível: a escolha vale para esta sessão à mesma. */
  }
  return cameraDeArranque();
}
