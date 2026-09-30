import { validateExhibition } from "./types";
import type { ExhibitionFile } from "./types";

const rawFiles = import.meta.glob("./*.sen", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export function loadExhibitions(): ExhibitionFile[] {
  const list: ExhibitionFile[] = [];
  for (const [path, raw] of Object.entries(rawFiles)) {
    try {
      const parsed = JSON.parse(raw);
      const errors = validateExhibition(parsed);
      if (errors.length) {
        console.error(`[exhibitions] ${path} inválido:`, errors);
        continue;
      }
      list.push(parsed as ExhibitionFile);
    } catch (ex) {
      console.error(`[exhibitions] ${path} não é JSON válido:`, ex);
    }
  }
  // Ordem fixa de apresentação: os ambientes prontos primeiro, na ordem pedida;
  // os restantes (espaços reservados) a seguir. O glob de ficheiros é alfabético
  // e não corresponde à ordem que se quer mostrar.
  const ORDEM = ["regulacao-sensorial", "exp1-depth-explorer", "air-painting", "fluid-ai"];
  return list.sort((a, b) => {
    const ia = ORDEM.indexOf(a.id);
    const ib = ORDEM.indexOf(b.id);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.name.localeCompare(b.name, "pt");
  });
}
