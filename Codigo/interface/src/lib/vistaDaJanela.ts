/**
 * Que janela da aplicação é esta.
 *
 * O Electron abre a mesma `index.html` três vezes: a janela principal, e as
 * duas de projeção (`#projection-camera` e `#projection-ai`), que o operador
 * manda para os monitores. Partilham origem — e portanto `localStorage` —, e
 * distingui-las importa em dois sítios:
 *
 * - As de projeção não autenticam ninguém. São superfícies de saída, abertas
 *   por uma janela principal que já tem sessão; pedir-lhes login punha o ecrã
 *   de entrada em cima do projetor.
 * - E não podem limpar a sessão ao arrancar, porque a que limpariam é a da
 *   janela principal, que está a correr por baixo delas.
 */

export type VistaDaJanela = "projection" | "projection-camera" | "projection-ai" | null;

export function vistaDaJanela(): VistaDaJanela {
  if (typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search).get("view");
  const valor = query || window.location.hash.replace(/^#/, "");
  if (valor === "projection" || valor === "projection-camera" || valor === "projection-ai") {
    return valor;
  }
  return null;
}

export function eJanelaDeProjecao(): boolean {
  return vistaDaJanela() !== null;
}
