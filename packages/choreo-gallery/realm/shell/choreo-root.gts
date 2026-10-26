import type { TOC } from '@ember/component/template-only';
import { MotionConfig } from 'glimmer-motion';

import { theme } from '../lib/theme';

interface Signature {
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

/**
 * The boundary every piece of the gallery renders inside: the ground, the
 * color-scheme switch, and the few element defaults the demos were designed
 * against.
 *
 * The palette and the type are the gallery's theme card (`theme.json`), which
 * every gallery card links. The gallery reads the theme contract's names
 * (`--foreground`, `--background`, `--primary`, `--border`, `--ring`, …), so a
 * theme reaches its text, surfaces, accents and focus ring, and so do the
 * Pret UI and Boxel components rendered inside it. The names the contract has
 * no slot for, such as the other accents and their text inks, are the theme's
 * own custom variables.
 *
 * The scheme switch is this element's `data-theme`. The card's theme
 * stylesheet reapplies the theme's light or dark set to any `data-theme`
 * element inside the card, above the Boxel defaults that the attribute also
 * selects, so the gallery's values hold in both schemes.
 */
export const ChoreoRoot: TOC<Signature> = <template>
  <div
    class='choreo-site'
    data-choreo-site
    data-test-choreo-site
    data-theme={{theme.resolved}}
    ...attributes
  >
    <MotionConfig @reducedMotion='user'>
      {{yield}}
    </MotionConfig>
  </div>
  <style scoped>
    .choreo-site {
      color-scheme: dark;
      --ease: cubic-bezier(0.22, 1, 0.36, 1);
      --page: 1180px;
      /* one flat color plus two soft radial glows — no texture, so the
         ground is as composable as any other layer */
      --wash:
        radial-gradient(
          1200px 640px at 12% -10%,
          color-mix(in srgb, var(--primary) 16%, transparent),
          transparent 55%
        ),
        radial-gradient(
          900px 480px at 110% 8%,
          color-mix(in srgb, var(--copper) 8%, transparent),
          transparent 50%
        ),
        var(--background);

      position: relative;
      min-height: 100%;
      color: var(--foreground);
      font-family: var(--font-sans);
      font-size: 16px;
      line-height: 1.5;
      background: var(--wash);
      transition:
        background 220ms var(--ease),
        color 220ms var(--ease);
    }

    .choreo-site[data-theme='light'] {
      color-scheme: light;
    }

    /* The element defaults the demos were designed against. :where() gives
       them no more weight than a bare element selector, so any class rule a
       component sets on its own elements outranks them. */
    .choreo-site,
    :where(.choreo-site) :deep(:where(*)),
    :where(.choreo-site) :deep(:where(*)::before),
    :where(.choreo-site) :deep(:where(*)::after) {
      box-sizing: border-box;
    }

    :where(.choreo-site) :deep(:where(a)) {
      color: inherit;
      text-decoration: none;
    }

    :where(.choreo-site) :deep(:where(button, input)) {
      font: inherit;
      color: inherit;
    }

    :where(.choreo-site) :deep(:where(button)) {
      cursor: pointer;
    }

    /* No double-tap-to-zoom on anything you are meant to tap: Safari's
       wait for a second tap reads as lag on demos you tap repeatedly. */
    :where(.choreo-site)
      :deep(:where(button, a, select, summary, [role='button'])) {
      touch-action: manipulation;
    }

    :where(.choreo-site) :deep(:where(:focus-visible)) {
      outline: 2px solid var(--ring);
      outline-offset: 3px;
    }

    /* The operator-mode container recolors every focused button with an
       unlayered button:focus:not(:disabled) rule, at (0,2,1). This rule
       paints the gallery's ring one notch above that, at (0,2,2) with the
       scope attribute, so a class rule a component sets on its own buttons,
       at (0,3,0) or more, still wins. :not(svg) is only that notch. */
    :where(.choreo-site) :deep(button:focus-visible:not(svg)) {
      outline-color: var(--ring);
    }

    /* Text for a screen reader alone: a live region's announcement, a
       control's full name, "(opens in a new tab)". Any component in the
       gallery can use the class. */
    .choreo-site :deep(.sr-only) {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }

    /* glimmer-motion marks the document while a drag is held, so nothing in
       the gallery selects under the pointer mid-drag */
    html[data-gm-dragging] .choreo-site,
    html[data-gm-dragging] .choreo-site :deep(*) {
      -webkit-user-select: none !important;
      user-select: none !important;
      -webkit-touch-callout: none !important;
    }

    /* The syntax spans come from highlightSample as trusted HTML, so they
       carry no component's scope; every code box in the gallery shares
       these colors. */
    .choreo-site :deep(.syn-tag),
    .choreo-site :deep(.syn-arg),
    .choreo-site :deep(.syn-keyword) {
      color: var(--iris-ink);
    }

    .choreo-site :deep(.syn-attr) {
      color: color-mix(in srgb, var(--foreground) 80%, var(--background));
    }

    .choreo-site :deep(.syn-string) {
      color: var(--syn-string);
    }

    .choreo-site :deep(.syn-helper),
    .choreo-site :deep(.syn-mustache) {
      color: var(--primary-ink);
    }

    .choreo-site :deep(.syn-number) {
      color: var(--steel-ink);
    }

    .choreo-site :deep(.syn-comment) {
      color: var(--subtle-foreground);
    }

    .choreo-site :deep(.syn-punct) {
      color: var(--muted-foreground);
    }
  </style>
</template>;
