// @ts-nocheck — vendored verbatim; type-checked upstream under Motion's tsconfig
// Vendored from Motion's packages/framer-motion/src/utils/get-context-window.ts (motion@bbabb00) — framework-free; only imports were re-pointed.
import type { VisualElement } from 'motion-dom';

// Fixes https://github.com/motiondivision/motion/issues/2270
export const getContextWindow = ({ current }: VisualElement<Element>) => {
  return current ? current.ownerDocument.defaultView : null;
};
