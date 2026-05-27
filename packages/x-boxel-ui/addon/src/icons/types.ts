import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type { ComponentLike } from '@glint/template';

export interface Signature {
  Element: SVGSVGElement;
}

export type Icon = ComponentLike<Signature>;

export type IconComponent = TemplateOnlyComponent<Signature>;
