import type { TOC } from '@ember/component/template-only';
import { MotionConfig } from 'glimmer-motion';

import { theme } from '../lib/theme';

interface Signature {
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

/**
 * The boundary every piece of the gallery renders inside: the palette, the
 * type, and the few element defaults the demos were designed against.
 *
 * The tokens are custom properties declared on this element, so everything
 * inside it — the shell's own components and every demo stage — inherits them
 * without the gallery ever styling the host's document. The theme switch is
 * this element's `data-theme`.
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
      /* Dark surfaces are a warm charcoal ladder, not near-black.
         well < bg < page < elev < spot, so recessed chrome still sinks and
         cards still lift, without a black floor. */
      --bg-well: #221e1a;
      --bg: #2a2521;
      --bg-elev: #3a342e;
      --bg-spot: #443c35;
      /* Playhead's own surfaces, a shade above the shared ladder so its
         small UI sits ON the page rather than cutting a hole in it. */
      --ph-card-top: #3d362f;
      --ph-card-bot: #322c27;
      --ph-go-top: #4a4139;
      --ph-go-bot: #2c2722;
      --ph-receipt-top: #403830;
      --ph-receipt-bot: #2e2924;
      --ph-row: rgba(0, 0, 0, 0.16);
      --ph-groove: rgba(0, 0, 0, 0.22);
      --ph-btn: rgba(0, 0, 0, 0.26);
      /* the page's own resting tone. --bg is the recessed canvas; cards use
         --bg-elev, a notch above this, so they lift instead of sinking. */
      --bg-page: #2e2924;
      --ink: #f3ece3;
      /* a step between --ink and --ink-dim, for the notes' headings */
      --ink-soft: #e6dfd6;
      --ink-dim: #d2c9bf;
      --ink-faint: #b8aea3;
      --line: rgba(var(--ink-rgb), 0.09);
      --line-strong: rgba(var(--ink-rgb), 0.16);
      /* bare triplets for rgba(var(--x-rgb), a) call sites that want an
         alpha no token covers; redefined per theme so they repaint */
      --bg-rgb: 42, 37, 33;
      --ink-rgb: 243, 236, 227;
      /* Shadows were picked against a dark page. Light mode scales the
         alpha and warms the tint; in dark the multiplier is 1. */
      --shadow-rgb: 0, 0, 0;
      --shadow-a: 1;
      /* a raised panel goes lighter than the page in dark mode and darker
         in light mode; this is that one bit, so panels flip together */
      --surface-tint-rgb: 255, 255, 255;
      --ember: #ff3b1f;
      --ember-hot: #ff6a3a;
      --copper: #e4a35a;
      --iris: #9667f7;
      --steel: #8b969c;
      --teal: #4fb8a6;
      --azure: #6ea8f0;
      /* An accent as TEXT. The accents above are tuned as fills and rules;
         small type in them needs 4.5:1 on --bg, --bg-page, --bg-elev and the
         faint tints laid over them (a code box, a tile's meta, an API pill), so
         each one an element sets text in has an -ink twin, lifted here and
         darkened in light mode. Text reads the -ink token; fills,
         rules and glows keep the accent. */
      --ember-ink: #ff7a4e;
      --copper-ink: var(--copper);
      --iris-ink: #af8bf9;
      --steel-ink: #96a0a5;
      /* the small uppercase label over a section, a tile or a code sample */
      --eyebrow: var(--ember-ink);
      /* ember text on an ember-tinted fill, such as a diagram's hot box */
      --hot-ink: #ff9370;
      /* the theme's focus color, which Boxel's own components read too; a
         focus indicator needs 3:1 against whatever it is drawn over */
      --ring: var(--ember-hot);
      --glow: rgba(255, 59, 31, 0.38);
      /* the mark's fading tail and its inner orbit. The -dark pair holds in
         either theme, for a mark that sits on a dark ground. */
      --mark-tail-dark: rgba(255, 59, 31, 0.35);
      --mark-orbit-dark: rgba(139, 150, 156, 0.75);
      --mark-tail: var(--mark-tail-dark);
      --mark-orbit: var(--mark-orbit-dark);
      --syn-string: #ffb36a;
      --gradient-tail: var(--ink);
      --font-display: 'Syne', 'Avenir Next', sans-serif;
      --font-display-alt: 'Archivo', 'Avenir Next Condensed', sans-serif;
      --font: 'IBM Plex Sans', 'Helvetica Neue', sans-serif;
      --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
      --ease: cubic-bezier(0.22, 1, 0.36, 1);
      --page: 1180px;
      /* one flat color plus two soft radial glows — no texture, so the
         ground is as composable as any other layer */
      --wash:
        radial-gradient(
          1200px 640px at 12% -10%,
          rgba(255, 59, 31, 0.16),
          transparent 55%
        ),
        radial-gradient(
          900px 480px at 110% 8%,
          rgba(228, 163, 90, 0.08),
          transparent 50%
        ),
        var(--bg-page);

      position: relative;
      min-height: 100%;
      color: var(--ink);
      font-family: var(--font);
      font-size: 16px;
      line-height: 1.5;
      background: var(--wash);
      transition:
        background 220ms var(--ease),
        color 220ms var(--ease);
    }

    /* Light mode. The accents carry over unchanged as fills and rules; every
       ink that sets text gets a darker value that holds 4.5:1 on cream. */
    .choreo-site[data-theme='light'] {
      color-scheme: light;
      --bg-well: #e2dccf;
      --bg: #efe9df;
      --bg-elev: #f7f3ec;
      --bg-spot: #fbf8f3;
      --shadow-rgb: 72, 56, 44;
      --shadow-a: 0.3;
      --ph-card-top: var(--bg-spot);
      --ph-card-bot: var(--bg-well);
      --ph-go-top: var(--bg-spot);
      --ph-go-bot: var(--bg-well);
      --ph-receipt-top: var(--bg-spot);
      --ph-receipt-bot: var(--bg-well);
      --ph-row: var(--bg-well);
      --ph-groove: var(--bg-well);
      --ph-btn: var(--bg-well);
      --bg-page: #f2ece1;
      --ink: #211d18;
      --ink-soft: #47423a;
      --ink-dim: #5e564b;
      --ink-faint: #6d6458;
      --line: rgba(33, 29, 24, 0.1);
      --line-strong: rgba(33, 29, 24, 0.18);
      --bg-rgb: 239, 233, 223;
      --ink-rgb: 33, 29, 24;
      --surface-tint-rgb: 33, 29, 24;
      --ember-ink: #bf2e00;
      --copper-ink: #905824;
      --iris-ink: #7334f5;
      --steel-ink: #5e686e;
      --hot-ink: #a02600;
      --ring: var(--ember-ink);
      --mark-tail: rgba(255, 59, 31, 0.5);
      --mark-orbit: rgba(94, 104, 110, 0.85);
      --syn-string: #a24f00;
      --gradient-tail: var(--copper);
      --lightbox-ring: rgba(33, 29, 24, 0.12);
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
      color: color-mix(in srgb, var(--ink) 80%, var(--bg-page));
    }

    .choreo-site :deep(.syn-string) {
      color: var(--syn-string);
    }

    .choreo-site :deep(.syn-helper),
    .choreo-site :deep(.syn-mustache) {
      color: var(--ember-ink);
    }

    .choreo-site :deep(.syn-number) {
      color: var(--steel-ink);
    }

    .choreo-site :deep(.syn-comment) {
      color: var(--ink-faint);
    }

    .choreo-site :deep(.syn-punct) {
      color: var(--ink-dim);
    }
  </style>
</template>;
