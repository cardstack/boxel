import type { TOC } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import { type MotionHold, motionPreference } from '../lib/motion-hold';

interface Signature {
  Args: { hold: MotionHold };
  Element: HTMLButtonElement;
}

/**
 * For a viewer whose system asks for reduced motion: the way to see a demo's
 * motion as it was designed, and back. Nobody else needs it, so nobody else
 * sees it.
 */
export const MotionToggle: TOC<Signature> = <template>
  {{#if motionPreference.reduce}}
    <button
      type='button'
      class='motion-toggle'
      data-test-motion-toggle
      data-motion-full={{if @hold.full 'true' 'false'}}
      {{on 'click' @hold.toggleFull}}
      ...attributes
    >{{if @hold.full 'Back to reduced motion' 'Play full motion'}}</button>
  {{/if}}
  <style scoped>
    .motion-toggle {
      padding: 0;
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--copper-ink);
      background: none;
      border: 0;
      cursor: pointer;
    }

    @media (hover: hover) {
      .motion-toggle:hover {
        color: var(--ink);
      }
    }

    .motion-toggle[data-motion-full='true'] {
      color: var(--ink-dim);
    }
  </style>
</template>;
