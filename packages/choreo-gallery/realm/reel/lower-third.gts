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
 * The reel's reusable type overlay — the title plane's one asset.
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
    class='reel-lower-third'
    data-variant={{@variant}}
    data-lt={{@id}}
    {{motion id=@id role='lower-third'}}
  >
    <span class='reel-lower-third__rule' aria-hidden='true'></span>
    <p class='reel-lower-third__label'>{{@label}}</p>
    {{#if @title}}
      <p class='reel-lower-third__title'>{{@title}}</p>
    {{/if}}
    {{#if @detail}}
      <p class='reel-lower-third__detail'>{{@detail}}</p>
    {{/if}}
  </aside>
  <style scoped>
    .reel-lower-third {
      position: absolute;
      top: 8.5%;
      left: 4.2%;
      width: min(680px, 48%);
      color: #f3ece3;
      pointer-events: none;
      text-shadow: 0 2px 14px rgba(12, 9, 8, 0.5);
      /* the rest pose is the stylesheet's: a lower third rests invisible and
         slightly low; only the plane's score brings it up */
      opacity: 0;
      transform: translateY(14px);
    }

    .reel-lower-third__rule {
      display: block;
      width: 64px;
      height: 2px;
      margin-bottom: 16px;
      background: #ff3b1f;
      transform-origin: left center;
    }

    .reel-lower-third__label,
    .reel-lower-third__title,
    .reel-lower-third__detail {
      margin: 0;
    }

    .reel-lower-third__label {
      font:
        500 20px/1.1 'IBM Plex Mono',
        monospace;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }

    .reel-lower-third__title {
      max-width: 12ch;
      margin-top: 12px;
      font:
        700 58px/0.96 'Syne',
        sans-serif;
      letter-spacing: -0.035em;
    }

    .reel-lower-third__detail {
      margin-top: 10px;
      color: #d2c9bf;
      font:
        400 26px/1.3 'IBM Plex Sans',
        sans-serif;
    }

    .reel-lower-third[data-variant='eyebrow'] {
      width: auto;
    }

    .reel-lower-third[data-variant='eyebrow'] .reel-lower-third__rule {
      width: 42px;
    }

    .reel-lower-third[data-variant='proof'] {
      top: auto;
      bottom: 19%;
    }
  </style>
</template>;
