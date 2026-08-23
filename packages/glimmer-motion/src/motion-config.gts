/**
 * MotionConfig for Glimmer — Motion's components/MotionConfig: defaults for every motion element below it.
 * React merges the context into each element's props (`{ ...config, ...props }`); here the element looks
 * up its closest <MotionConfig> ancestor in the DOM and merges the same way on every update pass.
 *
 *   <MotionConfig @transition={{hash type="spring"}} @reducedMotion="user">…</MotionConfig>
 */
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';
import {
  type ReducedMotionConfig,
  resolveTransition,
  type Transition,
} from 'motion-dom';
import type { TransformPoint } from 'motion-utils';

export interface MotionConfigContext {
  /** CSP nonce for the <style> elements the binding injects (popLayout) */
  nonce?: string;
  /** "user" (the default here) respects prefers-reduced-motion, "always" forces it, "never" ignores it — React's default */
  reducedMotion?: ReducedMotionConfig;
  /** complete every animation instantly (E2E / visual regression runs) */
  skipAnimations?: boolean;
  /** corrects pointer coordinates for drag — see correctParentTransform / transformViewBoxPoint */
  transformPagePoint?: TransformPoint;
  /** default transition for the tree; `inherit: true` shallow-merges with the parent config's */
  transition?: Transition;
}

interface Signature {
  Args: MotionConfigContext;
  Blocks: { default: [] };
  Element: HTMLElement;
}

const configs = new WeakMap<Element, MotionConfig>();

/** the merged config in effect for an element — React's useContext(MotionConfigContext) */
export function closestMotionConfig(el: Element): MotionConfigContext {
  const host = el.parentElement?.closest('[data-motion-config]');
  const component = host && configs.get(host);
  return component ? component.config : {};
}

export class MotionConfig extends Component<Signature> {
  private host?: Element;

  register = modifier((el: HTMLElement) => {
    this.host = el;
    configs.set(el, this);
    return () => {
      configs.delete(el);
      this.host = undefined;
    };
  });

  /** inherits from the closest parent MotionConfig, then applies its own args (transition via resolveTransition) */
  get config(): MotionConfigContext {
    const parent = this.host ? closestMotionConfig(this.host) : {};
    const own: MotionConfigContext = {};
    for (const key of [
      'transition',
      'reducedMotion',
      'transformPagePoint',
      'skipAnimations',
      'nonce',
    ] as const) {
      if (this.args[key] !== undefined) {
        (own as Record<string, unknown>)[key] = this.args[key];
      }
    }
    const config: MotionConfigContext = { ...parent, ...own };
    config.transition = resolveTransition(config.transition, parent.transition);
    return config;
  }

  <template>
    <div
      data-motion-config
      style='display: contents'
      {{this.register}}
      ...attributes
    >
      {{yield}}
    </div>
  </template>
}

export default MotionConfig;
