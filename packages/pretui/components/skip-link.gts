// Pretui — SkipLink: the first focusable control, a way past the chrome to the main content.
import Component from '@glimmer/component';

export interface SkipLinkSignature {
  Args: {
    /** The in-page target (default '#main'). Give that element the matching id. */
    href?: string;
    /** The link text (default 'Skip to content'). */
    label?: string;
  };
  Element: HTMLAnchorElement;
}

/**
 * WCAG 2.4.1 Bypass Blocks. Put it first in the pane, before the header and
 * navigation. It is off screen until it receives focus, then appears at the
 * top start corner of the nearest positioned ancestor so the keyboard user can see where they are. It is a plain
 * in-page anchor, so it needs no router. The target should be focusable
 * (`tabindex='-1'` on a `<main>`) so focus actually moves there, not only the
 * scroll position.
 */
export class SkipLink extends Component<SkipLinkSignature> {
  get href(): string {
    return this.args.href ?? '#main';
  }
  get label(): string {
    return this.args.label ?? 'Skip to content';
  }
  <template>
    <a class='pretui-skip-link' href={{this.href}} data-test-pretui-skip-link ...attributes>{{this.label}}</a>
    <style scoped>
      .pretui-skip-link {
        position: absolute;
        inset-block-start: var(--space-3, 0.5rem);
        inset-inline-start: var(--space-3, 0.5rem);
        z-index: var(--pretui-z-toast, 100);
        padding: var(--space-2, 0.375rem) var(--space-4, 0.6875rem);
        border-radius: var(--radius-control, 6px);
        background: var(--primary);
        color: var(--primary-foreground);
        font-family: var(--font-sans);
        font-size: var(--text-ui-md, 0.78rem);
        font-weight: 600;
        text-decoration: none;
        box-shadow: var(--pretui-shadow-raised, 0 0 0 1px var(--border));
      }
      /* Off screen but in the tab order and the accessibility tree until it
         has focus: the clip pattern, not display: none. */
      .pretui-skip-link:not(:focus) {
        inline-size: 1px;
        block-size: 1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .pretui-skip-link:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
    </style>
  </template>
}
