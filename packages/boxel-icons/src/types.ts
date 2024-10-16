import type { ComponentLike } from '@glint/template';

export interface Signature {
  Element: SVGElement;
}

export type Icon = ComponentLike<Signature>;
