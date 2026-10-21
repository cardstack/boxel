// Pretui — CardEmbed: the frame around a host-rendered card inside the transcript.
import Component from '@glimmer/component';
import { StateGlyph } from './state-glyph';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import type { ComponentLike } from '@glint/template';

export type CardEmbedState =
  | 'pending'
  | 'loading'
  | 'ready'
  | 'error'
  | 'missing'
  | 'auth-required'
  | 'cancelled';
export type CardEmbedFormat = 'fitted' | 'embedded' | 'isolated' | 'edit' | 'atom';

export interface CardEmbedSignature {
  Args: {
    /** the format the host renders the card in; drives the sizing */
    format?: CardEmbedFormat;
    /** an explicit box, from the ref's args or the host's size parser:
     * '320px', '100%' */
    width?: string;
    height?: string;
    /** the least height the card gets. Default: fitted 64px, embedded
     * 120px, isolated 200px */
    minHeight?: string;
    /** past this, the card scrolls in its own box */
    maxHeight?: string;
    /** 'ready' (default), 'pending' (the call is still writing it: the
     * box is held with a shimmering line), 'loading' (the card is
     * fetching), 'error', 'missing' (deleted since) */
    state?: CardEmbedState;
    /** the card's title: the frame's name, and the pending line */
    label?: string;
    /** its type, said quietly: 'Tea lot' */
    kind?: string;
    /** open the card where the reader works; a corner Open with an arrow icon */
    onOpen?: () => void;
    /** the corner button's words. Default 'Open'; 'Open in Boxel' inside
     * an MCP App, where `@onOpen` calls the host's openLink */
    openLabel?: string;
    /** the hat: one 26px line over the card with its type, its title and
     * its actions (Open, and `<:actions>`). Default: on for embedded,
     * isolated and edit, which are big enough to carry one; off for fitted
     * and atom, which keep a quiet corner Open */
    hat?: boolean;
    /** the type's icon, in the hat: a boxel-icons component */
    icon?: ComponentLike<{ Element: SVGSVGElement }>;
    /** why it could not show, or why it was cancelled */
    error?: string;
    onRetry?: () => void;
    /** fill the width it is given, with no cap and no outer edge: the
     * top-level frame of an MCP App iframe */
    fill?: boolean;
    /** the definite box a fitted card needs when nothing around it has a
     * height: an aspect ratio ('16 / 9') or a height ('180px') */
    envelope?: string;
    /** 'auth-required': what access is missing ("Saving needs edit access
     * to Home renovation"), with one action */
    authPrompt?: string;
    authorizeLabel?: string;
    onAuthorize?: () => void;
  };
  Blocks: {
    /** the host's CardRenderer */
    default: [];
    /** replaces the pending line */
    pending: [];
    /** more corner actions, beside Open */
    actions: [];
  };
  Element: HTMLDivElement;
}

const MIN: Record<CardEmbedFormat, string> = {
  fitted: '64px',
  embedded: '120px',
  isolated: '200px',
  edit: '200px',
  atom: '20px',
};

/**
 * Pret UI cannot render a card (that is the host's CardRenderer), so this
 * is the frame, the states and the sizing around one. It holds the card's
 * box while the call is still writing it (Law 8: late values never shift
 * layout), stops the transcript's prose styles at its edge so the card
 * keeps its own type and theme, scrolls a tall card in its own box, and
 * offers "Open ↗" in a corner, outside the card's own tab order.
 */
export class CardEmbed extends Component<CardEmbedSignature> {
  get format(): CardEmbedFormat {
    return this.args.format ?? 'fitted';
  }
  get state(): CardEmbedState {
    return this.args.state ?? 'ready';
  }
  get isPending() {
    return this.state === 'pending';
  }
  get isLoading() {
    return this.state === 'loading';
  }
  get isError() {
    return this.state === 'error' || this.state === 'missing' || this.state === 'cancelled';
  }
  get needsAuth() {
    return this.state === 'auth-required';
  }
  get authText(): string {
    return this.args.authPrompt ?? 'This needs more access';
  }
  /** a card that failed can be tried again; a deleted one cannot */
  get canRetry() {
    return this.state === 'error' && Boolean(this.args.onRetry);
  }
  get hasHat(): boolean {
    if (this.args.hat !== undefined) {
      return this.args.hat;
    }
    let f = this.format;
    return (f === 'embedded' || f === 'isolated' || f === 'edit') &&
      Boolean(this.args.label ?? this.args.kind);
  }
  get showsCard() {
    return this.state === 'ready' || this.state === 'loading';
  }
  get boxStyle() {
    let envelope = this.args.envelope;
    let rules = [
      `--pretui-embed-min: ${this.args.minHeight ?? MIN[this.format]}`,
      envelope && envelope.includes('/') ? `aspect-ratio: ${envelope}` : '',
      envelope && !envelope.includes('/') ? `--pretui-embed-h: ${envelope}` : '',
      this.args.width ? `--pretui-embed-w: ${this.args.width}` : '',
      this.args.height ? `--pretui-embed-h: ${this.args.height}` : '',
      this.args.maxHeight ? `--pretui-embed-max-h: ${this.args.maxHeight}` : '',
    ].filter(Boolean);
    return htmlSafe(rules.join('; '));
  }
  get pendingText(): string {
    let what = this.args.label ?? this.args.kind ?? 'the card';
    return `Making ${what}…`;
  }
  get errorText(): string {
    let what = this.args.label ?? this.args.kind ?? 'the card';
    if (this.state === 'cancelled') {
      return this.args.error ? `Cancelled · ${this.args.error}` : 'Cancelled';
    }
    return this.state === 'missing'
      ? `${what} was deleted since`
      : (this.args.error ?? `Couldn’t show ${what}`);
  }
  get openLabel(): string {
    return this.args.openLabel
      ? `${this.args.openLabel}: ${this.args.label ?? 'the card'}`
      : `Open ${this.args.label ?? 'the card'} on the stack`;
  }
  get openText(): string {
    return this.args.openLabel ?? 'Open';
  }
  authorize = () => this.args.onAuthorize?.();
  open = () => this.args.onOpen?.();
  retry = () => this.args.onRetry?.();
  <template>
    <div
      class='pretui-embed'
      role='group'
      aria-label={{if @label @label 'Card'}}
      aria-busy={{if (if this.isPending true this.isLoading) 'true'}}
      data-format={{this.format}}
      data-state={{this.state}}
      data-fill={{if @fill 'true'}}
      data-hat={{if this.hasHat 'true'}}
      data-scroll-region={{if @maxHeight 'true'}}
      style={{this.boxStyle}}
      data-test-pretui-card-embed={{this.state}}
      ...attributes
    >
      {{#if this.hasHat}}
        <div class='pretui-embed-hat' data-test-pretui-card-embed-hat>
          {{#if @icon}}<@icon class='pretui-embed-hat-icon' width='14' height='14' aria-hidden='true' />{{/if}}
          {{#if @kind}}<span class='pretui-embed-hat-kind'>{{@kind}}</span>{{/if}}
          {{#if @label}}<span class='pretui-embed-hat-title' title={{@label}}>{{@label}}</span>{{/if}}
          <span class='pretui-embed-hat-actions'>
            {{yield to='actions'}}
            {{#if (if @onOpen this.showsCard)}}
              <button
                type='button'
                class='pretui-embed-hat-open'
                aria-label={{this.openLabel}}
                data-test-pretui-card-embed-open
                {{on 'click' this.open}}
              >{{this.openText}} <StateGlyph @glyph='open' @size={{11}} /></button>
            {{/if}}
          </span>
        </div>
      {{/if}}
      {{#if this.isPending}}
        <div class='pretui-embed-pending' data-test-pretui-card-embed-pending>
          {{#if (has-block 'pending')}}{{yield to='pending'}}{{else}}
            <span class='pretui-embed-shimmer'>{{this.pendingText}}</span>
          {{/if}}
        </div>
      {{else if this.needsAuth}}
        <div class='pretui-embed-error' data-kind='auth' role='status' data-test-pretui-card-embed-auth>
          <span>{{this.authText}}</span>
          {{#if @onAuthorize}}<button
              type='button'
              class='pretui-embed-act'
              data-kind='primary'
              data-test-pretui-card-embed-authorize
              {{on 'click' this.authorize}}
            >{{if @authorizeLabel @authorizeLabel 'Ask for access'}}</button>{{/if}}
        </div>
      {{else if this.isError}}
        <div class='pretui-embed-error' role='status' data-test-pretui-card-embed-error>
          <span>{{this.errorText}}</span>
          {{#if this.canRetry}}<button
              type='button'
              class='pretui-embed-act'
              data-test-pretui-card-embed-retry
              {{on 'click' this.retry}}
            >Retry</button>{{/if}}
        </div>
      {{else}}
        <div class='pretui-embed-card'>{{yield}}</div>
      {{/if}}
      {{#if (if this.hasHat false (if this.showsCard (if @onOpen true (has-block 'actions'))))}}
        <div class='pretui-embed-corner'>
          {{yield to='actions'}}
          {{#if @onOpen}}
            <button
              type='button'
              class='pretui-embed-open'
              aria-label={{this.openLabel}}
              data-test-pretui-card-embed-open
              {{on 'click' this.open}}
            >{{this.openText}} <StateGlyph @glyph='open' @size={{11}} /></button>
          {{/if}}
        </div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        /* a size container at the text column's width: the card's own
           container queries see the embed, not the window */
        .pretui-embed {
          container-type: inline-size;
          position: relative;
          box-sizing: border-box;
          width: var(--pretui-embed-w, 100%);
          max-width: var(--pretui-embed-max, 37.5rem);
          min-height: var(--pretui-embed-min);
          height: var(--pretui-embed-h, auto);
          max-height: var(--pretui-embed-max-h, none);
          overflow: auto;
          border-radius: var(--radius-surface, 10px);
          box-shadow: 0 0 0 1px var(--border);
          isolation: isolate;
          contain: layout paint;
          /* the transcript's prose stops at the frame: the card brings
             its own measure, leading and link colour */
          font: initial;
          line-height: normal;
          letter-spacing: normal;
          text-align: start;
          white-space: normal;
          color: initial;
        }
        /* the hat: one quiet line in the frame's own chrome over the card's
           surface. Main's card header is a 30px-minimum bar with 24px
           icons and 13px semibold text; this is 26px, the type as a mono
           eyebrow, the title at 12px, and the actions as text */
        .pretui-embed[data-hat] {
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
        }
        .pretui-embed-hat {
          position: sticky;
          inset-block-start: 0;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          height: 26px;
          padding: 0 6px 0 10px;
          background: var(--card, var(--background));
          box-shadow: 0 1px 0 var(--border);
          font-family: var(--font-sans, system-ui, sans-serif);
          color: var(--foreground);
        }
        .pretui-embed-hat-icon {
          flex: none;
          color: var(--muted-foreground);
        }
        .pretui-embed-hat-kind {
          flex: none;
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--subtle-foreground, var(--muted-foreground));
        }
        .pretui-embed-hat-title {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          font-weight: 500;
        }
        .pretui-embed-hat-actions {
          display: flex;
          align-items: center;
          gap: 2px;
          margin-inline-start: auto;
        }
        .pretui-embed-hat-open {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          height: 20px;
          padding: 0 6px;
          border: 0;
          border-radius: 5px;
          background: none;
          font: inherit;
          font-size: var(--text-ui-xs, 11px);
          font-weight: 500;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-embed-hat-open:hover {
          color: var(--pretui-link, var(--primary));
          background: var(--hover, var(--inset));
        }
        .pretui-embed-hat-open:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        /* the iframe's top level: the whole width, no cap, no edge */
        .pretui-embed[data-fill] {
          max-width: none;
          border-radius: 0;
          box-shadow: none;
        }
        .pretui-embed-card {
          display: grid;
          min-height: inherit;
        }
        .pretui-embed-card > :deep(*) {
          min-width: 0;
        }
        .pretui-embed-pending,
        .pretui-embed-error {
          display: flex;
          align-items: center;
          gap: 8px;
          box-sizing: border-box;
          height: 100%;
          min-height: var(--pretui-embed-min);
          padding: 12px;
          background: var(--inset, var(--boxel-100));
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        /* the shimmer is a moving gradient in CSS: no clock */
        .pretui-embed-shimmer {
          background: linear-gradient(
            90deg,
            var(--muted-foreground) 0%,
            var(--foreground) 50%,
            var(--muted-foreground) 100%
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: pretui-embed-shimmer 1.6s linear infinite;
        }
        @keyframes pretui-embed-shimmer {
          from {
            background-position: 100% 0;
          }
          to {
            background-position: -100% 0;
          }
        }
        .pretui-embed-error[data-kind='auth'] {
          color: var(--foreground);
        }
        .pretui-embed-act[data-kind='primary'] {
          height: 24px;
          padding: 0 10px;
          border-radius: 12px;
          background: var(--primary, var(--boxel-highlight));
          color: var(--primary-foreground, var(--boxel-dark));
        }
        .pretui-embed[data-state='error'] .pretui-embed-error {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
        }
        .pretui-embed-act {
          padding: 0 4px;
          border: 0;
          border-radius: 4px;
          background: none;
          font: inherit;
          font-weight: 600;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-embed-act:hover {
          color: var(--pretui-link, var(--primary));
        }
        /* Open sits in the corner, quiet until the frame is hovered or
           focused (always on touch), never over the card's own controls'
           focus order: it comes after the card */
        .pretui-embed-corner {
          position: absolute;
          inset-block-start: 6px;
          inset-inline-end: 6px;
          display: flex;
          gap: 4px;
          opacity: 0;
          transition: opacity 120ms ease-out;
        }
        .pretui-embed:hover .pretui-embed-corner,
        .pretui-embed:focus-within .pretui-embed-corner {
          opacity: 1;
        }
        @media (hover: none) {
          .pretui-embed-corner {
            opacity: 1;
          }
        }
        .pretui-embed-open {
          height: 22px;
          padding: 0 8px;
          border: 0;
          border-radius: 11px;
          background: var(--popover, var(--card));
          box-shadow: 0 0 0 1px var(--border-strong, var(--border));
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: var(--text-ui-xs, 11px);
          font-weight: 500;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-embed-open:hover {
          color: var(--pretui-link, var(--primary));
        }
        .pretui-embed-open:focus-visible,
        .pretui-embed-act:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-embed-shimmer {
            animation: none;
            color: var(--muted-foreground);
          }
          .pretui-embed-corner {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
