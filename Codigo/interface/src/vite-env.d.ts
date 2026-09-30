/// <reference types="vite/client" />

// Declara os tipos dos imports que o Vite resolve mas o TypeScript não conhece
// por si: imagens, fontes e o resolvedor `figma:asset/` definido no vite.config.
declare module "figma:asset/*" {
  const src: string;
  export default src;
}
