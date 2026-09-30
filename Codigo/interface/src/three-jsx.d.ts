/**
 * Declara os elementos JSX do three.js (`<mesh>`, `<points>`, `<group>`, …).
 *
 * Porquê: o projeto tem `@react-three/fiber` 8.18 com `three` 0.180. A augmentação
 * de `JSX.IntrinsicElements` do r3f v8 foi escrita para o three ~0.15x e deixa de
 * se aplicar com esta versão, o que produzia ~24 erros de tipo em elementos que
 * funcionam perfeitamente em execução. Sem este ficheiro o `npm run typecheck`
 * ficava afogado em ruído e ninguém o correria — que é o mesmo que não o ter.
 *
 * Isto afeta só a verificação de tipos, nunca o que corre. A correção de fundo é
 * alinhar as versões (r3f v9 com React 19, ou three ~0.15x); enquanto isso não
 * acontecer, os elementos 3D não são verificados — o que se perde aqui.
 */
import type { ReactNode } from "react";

type ElementoTres = Record<string, any> & { children?: ReactNode };

// A augmentação vai ao namespace JSX *dentro* do módulo "react": o projeto tem
// @types/react 19, que deixou de declarar o JSX global (era aí que o r3f v8
// escrevia). É essa a razão de fundo por que a augmentação do r3f não pega.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      mesh: ElementoTres;
      points: ElementoTres;
      group: ElementoTres;
      primitive: ElementoTres;
      shaderMaterial: ElementoTres;
      ambientLight: ElementoTres;
      pointLight: ElementoTres;
      directionalLight: ElementoTres;
      planeGeometry: ElementoTres;
      bufferGeometry: ElementoTres;
      bufferAttribute: ElementoTres;
      meshStandardMaterial: ElementoTres;
      meshBasicMaterial: ElementoTres;
      pointsMaterial: ElementoTres;
      lineSegments: ElementoTres;
      lineBasicMaterial: ElementoTres;
    }
  }
}

export {};
