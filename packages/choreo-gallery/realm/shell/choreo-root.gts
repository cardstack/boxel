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
 *
 * Where no theme card reaches the shell (a gallery card whose theme link is
 * missing, or a context that applies no card themes), the shell declares the
 * theme's values itself, ranked below any theme, so it renders in the
 * gallery's palette and type either way.
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

      /* The eyebrow role. The card container derives --boxel-eyebrow-*
         from the theme's --theme-eyebrow-* on its own element, above this
         one, so they are derived again here, where the fallback below
         declares the gallery's eyebrow when no theme sets one. */
      --boxel-eyebrow-font-family: var(--theme-eyebrow-font-family);
      --boxel-eyebrow-font-size: var(--theme-eyebrow-font-size);
      --boxel-eyebrow-line-height: var(--theme-eyebrow-line-height);
      --boxel-eyebrow-font-weight: var(--theme-eyebrow-font-weight);
      --boxel-eyebrow-letter-spacing: var(--theme-eyebrow-letter-spacing);

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

    /* The gallery's palette and type where no theme card reaches the shell:
       theme.json's values, the light set and then the dark set over it, as
       the theme's stylesheet applies them. They must match theme.json; the
       host's gallery theme-fallback test fails when the two differ.

       A theme still wins. This element's data-theme makes it a scheme
       island, and a theme card's stylesheet re-declares the theme's values
       on islands at (0,2,0), while Boxel's [data-theme] defaults are
       (0,1,0). With the scope attribute these two rules are (0,1,1), so
       they outrank the defaults and give way to any theme. The div keeps
       that one notch; the :where() keeps the rest at zero. */
    div:where(.choreo-site) {
      --background: #f2ece1;
      --foreground: #211d18;
      --card: #f7f3ec;
      --card-foreground: #211d18;
      --canvas: #efe9df;
      --inset: #e2dccf;
      --muted-foreground: #5e564b;
      --subtle-foreground: #6d6458;
      --primary: #ff3b1f;
      --primary-foreground: #ffffff;
      --primary-ink: #bf2e00;
      --border: color-mix(in srgb, var(--foreground) 10%, transparent);
      --border-strong: color-mix(in srgb, var(--foreground) 18%, transparent);
      --ring: var(--primary-ink);
      --font-sans: 'IBM Plex Sans', 'Helvetica Neue', sans-serif;
      --font-mono: 'IBM Plex Mono', ui-monospace, monospace;

      --ember-hot: #ff6a3a;
      --copper: #e4a35a;
      --iris: #9667f7;
      --steel: #8b969c;
      --teal: #4fb8a6;
      --azure: #6ea8f0;
      --glow: rgba(255, 59, 31, 0.38);
      --mark-tail-dark: rgba(255, 59, 31, 0.35);
      --mark-orbit-dark: rgba(139, 150, 156, 0.75);

      --theme-eyebrow-font-family: 'IBM Plex Mono', ui-monospace, monospace;
      --theme-eyebrow-font-size: 0.6875rem;
      --theme-eyebrow-line-height: 1.5;
      --theme-eyebrow-font-weight: 400;
      --theme-eyebrow-letter-spacing: 0.18em;

      --ink-soft: #47423a;
      --copper-ink: #905824;
      --iris-ink: #7334f5;
      --steel-ink: #5e686e;
      --hot-ink: #a02600;
      --syn-string: #a24f00;
      --bg-spot: #fbf8f3;
      --ph-card-top: var(--bg-spot);
      --ph-card-bot: var(--inset);
      --ph-go-top: var(--bg-spot);
      --ph-go-bot: var(--inset);
      --ph-receipt-top: var(--bg-spot);
      --ph-receipt-bot: var(--inset);
      --ph-row: var(--inset);
      --ph-groove: var(--inset);
      --ph-btn: var(--inset);
      --shadow-ink: #48382c;
      --shadow-a: 0.3;
      --surface-tint: #211d18;
      --mark-tail: rgba(255, 59, 31, 0.5);
      --mark-orbit: rgba(94, 104, 110, 0.85);
      --gradient-tail: var(--copper);
      --lightbox-ring: rgba(33, 29, 24, 0.12);
      --font-display: 'Syne', 'Avenir Next', sans-serif;
      --font-display-alt: 'Archivo', 'Avenir Next Condensed', sans-serif;
    }

    div:where(.choreo-site[data-theme='dark']) {
      --background: #2e2924;
      --foreground: #f3ece3;
      --card: #3a342e;
      --card-foreground: #f3ece3;
      --canvas: #2a2521;
      --inset: #221e1a;
      --muted-foreground: #d2c9bf;
      --subtle-foreground: #b8aea3;
      --primary: #ff3b1f;
      --primary-foreground: #ffffff;
      --primary-ink: #ff7a4e;
      --border: color-mix(in srgb, var(--foreground) 9%, transparent);
      --border-strong: color-mix(in srgb, var(--foreground) 16%, transparent);
      --ring: var(--ember-hot);

      --ink-soft: #e6dfd6;
      --copper-ink: var(--copper);
      --iris-ink: #af8bf9;
      --steel-ink: #96a0a5;
      --hot-ink: #ff9370;
      --syn-string: #ffb36a;
      --bg-spot: #443c35;
      --ph-card-top: #3d362f;
      --ph-card-bot: #322c27;
      --ph-go-top: #4a4139;
      --ph-go-bot: #2c2722;
      --ph-receipt-top: #403830;
      --ph-receipt-bot: #2e2924;
      --ph-row: rgba(0, 0, 0, 0.16);
      --ph-groove: rgba(0, 0, 0, 0.22);
      --ph-btn: rgba(0, 0, 0, 0.26);
      --shadow-ink: #000000;
      --shadow-a: 1;
      --surface-tint: #ffffff;
      --mark-tail: var(--mark-tail-dark);
      --mark-orbit: var(--mark-orbit-dark);
      --gradient-tail: var(--foreground);
      --lightbox-ring: rgba(0, 0, 0, 0.5);
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
