// Imagens de preview dos ambientes. As originais são fotografias da instalação e
// não fazem parte do repositório público: sem imagem para a chave, o ecrã
// inicial mostra o ambiente sem preview.
const IMAGENS: Record<string, string> = {};

export function environmentImage(key?: string): string | undefined {
  if (!key) return undefined;
  return IMAGENS[key];
}
