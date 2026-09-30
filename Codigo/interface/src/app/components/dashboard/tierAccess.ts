export type Tier = "personal" | "creator" | "commercial";

const TIER_RANK: Record<Tier, number> = { personal: 0, creator: 1, commercial: 2 };

// Página → tier mínimo exigido. Páginas fora deste mapa ficam sempre acessíveis.
export const PAGE_TIER: Partial<Record<string, Tier>> = {
  assistente: "creator",
  chatbots: "creator",
  dispositivos: "commercial",
};

// Tier → chave de tradução do nome do plano (usada pelo badge do menu e pelo ecrã de upgrade).
export const TIER_LABEL_KEY: Record<Tier, "planPersonal" | "planCreator" | "planCommercial"> = {
  personal: "planPersonal",
  creator: "planCreator",
  commercial: "planCommercial",
};

export function hasAccess(required: Tier | undefined, current: Tier | null): boolean {
  if (!required) return true;
  if (!current) return false;
  return TIER_RANK[current] >= TIER_RANK[required];
}
