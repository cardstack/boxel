import type { TOC } from '@ember/component/template-only';
import { motion } from 'glimmer-motion';

export type LowerThirdVariant = 'eyebrow' | 'feature' | 'proof';

interface Signature {
  Args: {
    detail?: string;
    id: string;
    label: string;
    title?: string;
    variant: LowerThirdVariant;
  };
}

/**
 * The reel's reusable type overlay — the title plane's one asset,
 * ported from videos/choreo-feature-reel where it was first designed.
 *
 * The plane's score owns when and how it enters; this component only
 * declares the semantic actor (`role='lower-third'`) and the brand
 * treatment. It has no panel or backdrop on purpose, so it superimposes
 * over a live demo, a captured plate, or the closing lockup — and its
 * rest pose is the stylesheet's: a lower third rests invisible, and only
 * a score brings it up.
 */
export const LowerThird: TOC<Signature> = <template>
  <aside
    class="reel-lower-third"
    data-variant={{@variant}}
    data-lt={{@id}}
    {{motion id=@id role="lower-third"}}
  >
    <span class="reel-lower-third__rule" aria-hidden="true"></span>
    <p class="reel-lower-third__label">{{@label}}</p>
    {{#if @title}}
      <p class="reel-lower-third__title">{{@title}}</p>
    {{/if}}
    {{#if @detail}}
      <p class="reel-lower-third__detail">{{@detail}}</p>
    {{/if}}
  </aside>
</template>;

export default LowerThird;
