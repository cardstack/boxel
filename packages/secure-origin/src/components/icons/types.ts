import type { TemplateOnlyComponent } from '@ember/component/template-only';

export interface Signature {
  Element: SVGSVGElement;
}

export type IconComponent = TemplateOnlyComponent<Signature>;
