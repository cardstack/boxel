// Pretui — Result: the page-level outcome scene — done, failed, not found, not allowed.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { resolveTone } from '../pretui-primitives';

export type ResultStatus =
  | 'success'
  | 'info'
  | 'warning'
  | 'danger'
  | '403'
  | '404'
  | '500';

const STATUSES: readonly ResultStatus[] = [
  'success',
  'info',
  'warning',
  'danger',
  '403',
  '404',
  '500',
];

// An HTTP code is a status, not a tone, but it still needs a hue: a missing
// page is information, a refused one a warning, a server failure danger.
const HUES: Record<ResultStatus, string> = {
  success: 'var(--success)',
  info: 'var(--pretui-info)',
  warning: 'var(--warning)',
  danger: 'var(--destructive)',
  '403': 'var(--warning)',
  '404': 'var(--pretui-info)',
  '500': 'var(--destructive)',
};

const GLYPHS: Record<ResultStatus, string> = {
  success: '✓',
  info: 'i',
  warning: '!',
  danger: '✕',
  '403': '403',
  '404': '404',
  '500': '500',
};

// The title a code gets when the caller gives none, so a bare
// `<Result @status='404' />` still says something a person can read.
const DEFAULT_TITLES: Partial<Record<ResultStatus, string>> = {
  '403': 'You do not have access to this page',
  '404': 'This page does not exist',
  '500': 'Something went wrong on our side',
};

export interface ResultSignature {
  Args: {
    /** The outcome. Accepts the kit's tone spellings too (`error`, `positive`…). Default 'info'. */
    status?: ResultStatus | number | string;
    /** The one sentence that says what happened. Codes get a default. */
    title?: string;
    /** What it means for the reader, and what to do next. */
    description?: string;
    /** The title's heading level (default 2). */
    headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  };
  Blocks: {
    /** Replaces the status glyph — an illustration, a product mark. */
    icon: [];
    /** Anything between the description and the actions: a list of what failed, an order number. */
    default: [];
    /** The ways forward, usually one or two Buttons. */
    extra: [];
  };
  Element: HTMLElement;
}

/**
 * EmptyState is a region with no data yet; ResultCard is an agent's output
 * card; Alert is an inline message. Result is the scene that replaces a whole
 * pane once an outcome is known — a submitted form, a missing page, a refused
 * request — with one heading, one explanation and the ways forward.
 *
 * The glyph is static (Law 5): an outcome is not a process, so nothing spins
 * or bounces. HTTP codes render as their numerals, set large, because "404"
 * is the most recognisable thing that can be said about a missing page.
 */
export class Result extends Component<ResultSignature> {
  get status(): ResultStatus {
    let raw = this.args.status;
    return resolveTone(raw === undefined ? undefined : String(raw), STATUSES, 'info');
  }
  get isCode(): boolean {
    return /^\d+$/.test(this.status);
  }
  get title(): string | undefined {
    return this.args.title ?? DEFAULT_TITLES[this.status];
  }
  get level(): number {
    let level = this.args.headingLevel ?? 2;
    return level >= 1 && level <= 6 ? level : 2;
  }
  get glyph(): string {
    return GLYPHS[this.status];
  }
  get hueStyle() {
    return htmlSafe(`--pretui-result-hue: ${HUES[this.status]}`);
  }

  <template>
    <section
      class='pretui-result'
      data-status={{this.status}}
      style={{this.hueStyle}}
      data-test-pretui-result
      ...attributes
    >
      <div class='pretui-result-mark' aria-hidden='true'>
        {{#if (has-block 'icon')}}
          {{yield to='icon'}}
        {{else if this.isCode}}
          <span class='pretui-result-code'>{{this.glyph}}</span>
        {{else}}
          <span class='pretui-result-glyph'>{{this.glyph}}</span>
        {{/if}}
      </div>
      {{#if this.title}}
        <div class='pretui-result-title' role='heading' aria-level={{this.level}} data-test-pretui-result-title>
          {{this.title}}
        </div>
      {{/if}}
      {{#if @description}}
        <p class='pretui-result-desc' data-test-pretui-result-description>{{@description}}</p>
      {{/if}}
      {{#if (has-block)}}
        <div class='pretui-result-body'>{{yield}}</div>
      {{/if}}
      {{#if (has-block 'extra')}}
        <div class='pretui-result-extra' data-test-pretui-result-extra>{{yield to='extra'}}</div>
      {{/if}}
    </section>
    <style scoped>
      .pretui-result {
        display: grid;
        justify-items: center;
        text-align: center;
        gap: var(--space-3, 0.5rem);
        padding: var(--space-9, 2.75rem) var(--space-6, 1.25rem);
        min-inline-size: 0;
      }
      .pretui-result-mark {
        display: grid;
        place-items: center;
        margin-block-end: var(--space-2, 0.375rem);
        color: var(--pretui-result-hue);
      }
      .pretui-result-glyph {
        display: grid;
        place-items: center;
        inline-size: 3.5rem;
        block-size: 3.5rem;
        border-radius: 50%;
        font-size: 1.5rem;
        font-weight: 600;
        line-height: 1;
        color: color-mix(in oklch, var(--foreground) 30%, var(--pretui-result-hue));
        background: color-mix(in oklch, var(--pretui-result-hue) var(--pretui-chip-mix, 20%), var(--card));
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--pretui-result-hue) 45%, var(--border));
      }
      .pretui-result-code {
        font-family: var(--font-serif);
        font-size: var(--pretui-result-code-size, 4.5rem);
        font-variant-numeric: tabular-nums;
        line-height: 1;
        letter-spacing: -0.02em;
        color: color-mix(in oklch, var(--foreground) 25%, var(--pretui-result-hue));
      }
      .pretui-result-title {
        font-family: var(--font-serif);
        font-size: var(--text-heading, 1.1875rem);
        color: var(--foreground);
        max-inline-size: 36ch;
      }
      .pretui-result-desc {
        margin: 0;
        font-size: var(--text-ui-md, 0.8125rem);
        color: var(--muted-foreground);
        max-inline-size: 44ch;
      }
      .pretui-result-body {
        inline-size: min(100%, 32rem);
        text-align: start;
      }
      .pretui-result-extra {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--space-3, 0.5rem);
        margin-block-start: var(--space-3, 0.5rem);
      }
    </style>
  </template>
}
