// Pretui — AuthoredMark: a value the assistant wrote, marked where it sits on the card.
import Component from '@glimmer/component';

export interface AuthoredMarkSignature {
  Args: {
    /** who wrote it. Default 'AI' */
    by?: string;
    /** when: 'turn 3', '2:04 PM' */
    when?: string;
  };
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

/**
 * Wraps a value the assistant wrote: a dotted underline, and on hover or
 * focus "AI · turn 3", so a reader looking at the card, not the
 * transcript, can tell which values came from the assistant.
 */
export class AuthoredMark extends Component<AuthoredMarkSignature> {
  get label(): string {
    let by = this.args.by ?? 'AI';
    return this.args.when ? `Written by ${by} · ${this.args.when}` : `Written by ${by}`;
  }
  get tag(): string {
    let by = this.args.by ?? 'AI';
    return this.args.when ? `${by} · ${this.args.when}` : by;
  }
  <template>
    <span class='pretui-authored' tabindex='0' title={{this.label}} data-test-pretui-authored-mark ...attributes>{{yield}}<span class='pretui-authored-tag' role='note' aria-label={{this.label}}>{{this.tag}}</span></span>
    <style scoped>
      @layer PretComponent {
        .pretui-authored {
          position: relative;
          text-decoration: underline dotted;
          text-decoration-color: var(--pretui-link, var(--primary));
          text-underline-offset: 3px;
          outline: none;
        }
        .pretui-authored:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
          border-radius: 2px;
        }
        .pretui-authored-tag {
          position: absolute;
          inset-block-end: calc(100% + 4px);
          inset-inline-start: 0;
          padding: 1px 6px;
          border-radius: 4px;
          background: var(--popover, var(--card));
          box-shadow: 0 0 0 1px var(--border);
          font-family: var(--font-mono);
          font-size: 10.5px;
          white-space: nowrap;
          color: var(--muted-foreground);
          opacity: 0;
          pointer-events: none;
          transition: opacity 120ms ease-out;
        }
        .pretui-authored:hover .pretui-authored-tag,
        .pretui-authored:focus-visible .pretui-authored-tag {
          opacity: 1;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-authored-tag {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
