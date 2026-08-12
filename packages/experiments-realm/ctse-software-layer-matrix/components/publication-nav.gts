// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import GlimmerComponent from '@glimmer/component'; // ¹ Shared host-page navigation; links intentionally target host routes, not card URLs
import { eq } from '@cardstack/boxel-ui/helpers';

interface Signature {
  Args: {
    active: string;
  };
  Element: HTMLElement;
}

export default class PublicationNav extends GlimmerComponent<Signature> {
  get active() { // ⁵ Named getter keeps this a real component while preserving a minimal host-only API
    return this.args.active;
  }

  <template>
    <nav class='publication-nav' aria-label='Software Matrix publications'> {{! ² Each destination is a standalone printable page }}
      <a class={{if (eq this.active 'matrix') 'active'}} href='/'>Matrix</a>
      <a class={{if (eq this.active 'vendor') 'active'}} href='/vendor-readiness/'>Vendor Readiness</a>
      <a class={{if (eq this.active 'droplab') 'active'}} href='/droplab/'>DropLab</a>
      <a class={{if (eq this.active 'cueclear') 'active'}} href='/cueclear/'>CueClear</a>
      <a class={{if (eq this.active 'cutroom') 'active'}} href='/cutroom/'>CutRoom</a>
      <a class={{if (eq this.active 'commonplace') 'active'}} href='/commonplace/'>Commonplace</a>
      <span>Print / PDF · ⌘P</span>
    </nav>

    <style scoped>
      .publication-nav { /* ³ Screen-only publication rail keeps navigation outside the card stack */
        position: sticky;
        z-index: 40;
        top: 0;
        display: flex;
        align-items: center;
        gap: 0.3rem;
        min-width: 0;
        padding: 0.55rem clamp(0.75rem, 2vw, 1.5rem);
        overflow-x: auto;
        border-bottom: 1px solid var(--border);
        background: var(--background);
        color: var(--foreground);
        font: 700 0.68rem/1 var(--font-mono);
        letter-spacing: 0.05em;
        scrollbar-width: thin;
        text-transform: uppercase;
      }

      a {
        flex: 0 0 auto;
        padding: 0.52rem 0.62rem;
        border: 1px solid transparent;
        color: var(--muted-foreground);
        text-decoration: none;
      }

      a:hover,
      a:focus-visible {
        border-color: var(--border);
        color: var(--foreground);
        outline: none;
      }

      a.active {
        border-color: var(--primary);
        background: var(--primary);
        color: var(--primary-foreground);
      }

      span {
        flex: 0 0 auto;
        margin-left: auto;
        padding-left: 0.8rem;
        color: var(--muted-foreground);
        font-weight: 500;
        white-space: nowrap;
      }

      @media print { /* ⁴ The exported PDF contains only the publication itself */
        .publication-nav {
          display: none;
        }
      }
    </style>
  </template>
}
