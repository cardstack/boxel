import Component from '@glimmer/component';

import { realmFile } from '../lib/realm-url';
import type { Theater } from '../lib/theater';
import { ChoreoMark } from './choreo-mark';
import { ChoreoRoot } from './choreo-root';
import { ThemePicker } from './pickers';

interface Signature {
  Args: {
    /** a film's page in theater: the bar steps out and the page opens on the picture */
    theater?: Theater;
  };
  Blocks: { default: [] };
}

/**
 * The site around a page of the gallery: the brand, the theme picker and the
 * site's links above it, the licence below. The gallery and each demo's page
 * wear the same frame, so a demo opened on its own is still the site.
 *
 * Moving between pages belongs to the host, which opens each demo card in
 * its stack, so the frame has no navigation of its own: the brand is the
 * site's name, and the way back to the gallery is the host's.
 */
export class SiteFrame extends Component<Signature> {
  /** the gallery's demos, hung in a walkable 3D room */
  roomHref = realmFile('widget-room');

  <template>
    <ChoreoRoot
      class='app-shell {{if @theater.on "is-theater"}}'
      data-test-theater={{@theater.on}}
    >
      <header class='topbar'>
        <span class='brand'>
          <ChoreoMark />
          <span class='brand-copy'>
            <span class='brand-name'>Choreo</span>
            <span class='brand-sub'>by Cardstack</span>
          </span>
        </span>
        <nav class='top-links' aria-label='Gallery'>
          <ThemePicker />
          <a href={{this.roomHref}} data-gallery-room>3D Gallery</a>
          <a
            href='https://github.com/cardstack/boxel/tree/main/packages/choreo'
            target='_blank'
            rel='noopener noreferrer'
          >GitHub</a>
        </nav>
      </header>
      <main class='page-shell'>
        <div class='page'>
          {{yield}}
        </div>
      </main>
      <footer class='footer'>
        <span>© 2026 Cardstack Foundation</span>
        <a
          href='https://github.com/cardstack/boxel/blob/main/packages/choreo/LICENSE'
          target='_blank'
          rel='noopener noreferrer'
        >
          MIT License
        </a>
      </footer>
    </ChoreoRoot>
    <style scoped>
      .app-shell {
        display: flex;
        flex-direction: column;
      }

      .topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        padding: 18px 28px;
        /* blur only — no tint of its own. Content scrolling underneath
           softens instead of darkening. */
        backdrop-filter: blur(18px);
        background: transparent;
        border-bottom: 1px solid var(--line);
        transition: border-color 220ms var(--ease);
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .brand-copy {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }

      /* Syne at 800, nudged 1px right: the C's open counter reads as more
         space on its left than its right */
      .brand-name {
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 16px;
        letter-spacing: -0.03em;
        margin-left: 1px;
      }

      .brand-sub {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ink-dim);
      }

      .top-links {
        display: flex;
        align-items: center;
        gap: 22px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-dim);
      }

      /* a link at rest carries a hairline underline, so it reads as a link
         before the pointer finds it */
      .top-links a,
      .footer a {
        text-decoration: underline;
        text-decoration-color: var(--line-strong);
        text-underline-offset: 3px;
      }

      @media (hover: hover) {
        .top-links a:hover {
          color: var(--ink);
        }
      }

      /* the shell keeps the footer at the foot, the page keeps its measure */
      .page-shell {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .page {
        width: min(var(--page), calc(100% - 48px));
        margin: 0 auto;
        padding: 56px 0 96px;
        flex: 1;
      }

      /* the bar carries the mark at the top left; in theater it is gone and
         the demo page draws the mark over the picture instead, so the two
         are never on screen at once — and the page opens on the picture,
         not on a band of ground above it */
      .app-shell.is-theater .topbar {
        display: none;
      }

      /* and it comes back as a fade, not a cut: the bar returns in the same
         render that takes the film out of theater, and its blur would
         otherwise land at once over whatever is moving beneath it */
      .app-shell:not(.is-theater) .topbar {
        animation: topbar-in 0.32s var(--ease) both;
      }

      @keyframes topbar-in {
        from {
          opacity: 0;
        }
      }

      .app-shell.is-theater .page {
        padding-top: 0;
      }

      .footer {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 40px 24px 48px;
        border-top: 1px solid var(--line);
        margin-top: 64px;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .footer a {
        color: var(--ink-dim);
      }

      @media (hover: hover) {
        .footer a:hover {
          color: var(--copper-ink);
        }
      }

      @media (max-width: 720px) {
        .topbar {
          padding: 14px 16px;
          gap: 12px;
        }

        .top-links {
          gap: 12px;
          letter-spacing: 0.08em;
        }

        /* if it is ever squeezed anyway, it clips rather than printing
           itself over the control next to it */
        .brand-copy {
          min-width: 0;
        }

        .brand-name,
        .brand-sub {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .page {
          width: 100%;
          padding: 32px 16px 64px;
        }
      }

      @media (max-width: 600px) {
        .top-links {
          flex-wrap: wrap;
          row-gap: 10px;
        }
      }

      @media (max-width: 400px) {
        .top-links {
          gap: 10px;
          font-size: 10px;
        }
      }
    </style>
  </template>
}
