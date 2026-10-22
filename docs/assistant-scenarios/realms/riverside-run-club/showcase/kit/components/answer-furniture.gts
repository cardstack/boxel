// Pretui — Answer furniture: stat chips, source refs, a sources strip and a Method note, for an assistant's reply.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';

/** "github.com" from a URL; the URL itself when it does not parse */
export function sourceHost(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

// ── StatChips ────────────────────────────────────────────────────────────
// The answer's numbers, pulled out of its prose: `$3.75 median` `6 shops`.

export interface StatChipsSignature {
  Args: { items: string[]; label?: string };
  Element: HTMLUListElement;
}

export class StatChips extends Component<StatChipsSignature> {
  <template>
    <ul
      class='pretui-statchips'
      aria-label={{if @label @label 'Key figures'}}
      data-test-pretui-stat-chips
      ...attributes
    >
      {{#each @items as |item|}}<li class='pretui-statchip'>{{item}}</li>{{/each}}
    </ul>
    <style scoped>
      @layer PretComponent {
        .pretui-statchips {
          display: flex;
          flex-wrap: wrap;
          gap: var(--step-8, 8px);
          margin: 0;
          padding: 0;
          list-style: none;
        }
        /* a figure, not a pasteable string: sans with tabular figures */
        .pretui-statchip {
          padding: 0 var(--step-8, 8px);
          border-radius: var(--round-chip, 4px);
          background: var(--inset, var(--boxel-100));
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          font-variant-numeric: tabular-nums;
          color: var(--foreground);
        }
      }
    </style>
  </template>
}

// ── SourceRef ────────────────────────────────────────────────────────────
// [3] in a sentence: a numbered link to where the claim came from.

export interface SourceRefSignature {
  Args: { n: number | string; href: string; title?: string };
  Element: HTMLAnchorElement;
}

export class SourceRef extends Component<SourceRefSignature> {
  get label(): string {
    return `Source ${this.args.n}: ${this.args.title ?? sourceHost(this.args.href)}`;
  }
  <template><a
      class='pretui-sourceref'
      href={{@href}}
      target='_blank'
      rel='noopener noreferrer'
      aria-label={{this.label}}
      title={{if @title @title @href}}
      data-test-pretui-source-ref={{@n}}
      ...attributes
    >{{@n}}</a><style scoped>
      @layer PretComponent {
        .pretui-sourceref {
          display: inline-block;
          min-width: 16px;
          margin-inline: 1px;
          padding: 1px var(--step-4, 4px);
          border-radius: var(--round-chip, 4px);
          background: var(--inset, var(--boxel-100));
          /* an inline pill: 16 px leading + 1 px each side = 18 px, inside 22 px reading leading */
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-weight: 400;
          font-variant-numeric: tabular-nums;
          text-align: center;
          text-decoration: none;
          vertical-align: baseline;
          color: var(--pretui-link, var(--primary, var(--boxel-highlight)));
        }
        .pretui-sourceref:hover {
          background: var(--hover, var(--inset, var(--boxel-100)));
        }
        .pretui-sourceref:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
      }
    </style></template>
}

// ── SourcesStrip ─────────────────────────────────────────────────────────
// Where the answer looked, as one strip of sites after it.

export interface AnswerSource {
  href: string;
  /** the number a SourceRef in the prose uses for it */
  n?: number | string;
  /** default: the site's host */
  label?: string;
}

export interface SourcesStripSignature {
  Args: {
    sources: AnswerSource[];
    /** how many to show before a "+N" that shows the rest. Default: all */
    limit?: number;
  };
  Element: HTMLDivElement;
}

export class SourcesStrip extends Component<SourcesStripSignature> {
  readonly labelId = guidFor(this) + '-sources';
  @tracked showAll = false;
  labelOf = (source: AnswerSource) => source.label ?? sourceHost(source.href);
  get shown(): AnswerSource[] {
    let { sources, limit } = this.args;
    return this.showAll || limit === undefined ? sources : sources.slice(0, limit);
  }
  get more(): number {
    return this.args.sources.length - this.shown.length;
  }
  expand = () => (this.showAll = true);
  <template>
    <div class='pretui-sources' data-test-pretui-sources ...attributes>
      <span class='pretui-sources-label' id={{this.labelId}}>Sources</span>
      <ul class='pretui-sources-list' aria-labelledby={{this.labelId}}>
        {{#each this.shown as |source|}}
          <li>
            <a
              class='pretui-sources-link'
              href={{source.href}}
              target='_blank'
              rel='noopener noreferrer'
              title={{source.href}}
              data-test-pretui-source={{this.labelOf source}}
            >{{#if source.n}}<span
                  class='pretui-sources-n'
                >{{source.n}}</span>{{/if}}{{this.labelOf source}}</a>
          </li>
        {{/each}}
        {{#if this.more}}
          <li><button
              type='button'
              class='pretui-sources-more'
              aria-label='Show {{this.more}} more sources'
              data-test-pretui-sources-more
              {{on 'click' this.expand}}
            >+{{this.more}}</button></li>
        {{/if}}
      </ul>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-sources {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: var(--step-8, 8px);
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
        }
        .pretui-sources-list {
          display: contents;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .pretui-sources-link {
          display: inline-flex;
          align-items: baseline;
          gap: var(--step-4, 4px);
          padding: 1px var(--step-8, 8px);
          border-radius: var(--round-row, 8px);
          box-shadow: inset 0 0 0 1px var(--border);
          text-decoration: none;
          white-space: nowrap;
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-sources-link:hover {
          color: var(--foreground);
          box-shadow: inset 0 0 0 1px var(--border-strong, var(--border));
        }
        .pretui-sources-link:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-sources-more {
          padding: 1px var(--step-8, 8px);
          border: 0;
          border-radius: var(--round-row, 8px);
          background: none;
          box-shadow: inset 0 0 0 1px var(--border);
          font: inherit;
          font-variant-numeric: tabular-nums;
          color: var(--ink-2, var(--muted-foreground));
          cursor: pointer;
        }
        .pretui-sources-more:hover {
          color: var(--pretui-link, var(--primary));
        }
        .pretui-sources-more:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-sources-n {
          font-variant-numeric: tabular-nums;
          color: var(--pretui-link, var(--primary, var(--boxel-highlight)));
        }
      }
    </style>
  </template>
}

// ── MethodNote ───────────────────────────────────────────────────────────
// How the answer was reached, folded to one line until the reader opens it.

export interface MethodNoteSignature {
  Args: {
    text: string;
    /** the label. Default 'Method' */
    label?: string;
    defaultOpen?: boolean;
  };
  Element: HTMLDivElement;
}

export class MethodNote extends Component<MethodNoteSignature> {
  @tracked open = this.args.defaultOpen ?? false;
  readonly bodyId = guidFor(this) + '-method';
  toggle = () => (this.open = !this.open);
  <template>
    <div
      class='pretui-method'
      data-open={{if this.open 'true'}}
      data-test-pretui-method-note
      ...attributes
    >
      <button
        type='button'
        class='pretui-method-toggle'
        aria-expanded={{if this.open 'true' 'false'}}
        aria-controls={{this.bodyId}}
        data-test-pretui-method-toggle
        {{on 'click' this.toggle}}
      >
        <span class='pretui-method-label'>{{if @label @label 'Method'}}</span>
        <span class='pretui-method-chevron' aria-hidden='true'></span>
      </button>
      <p class='pretui-method-text' id={{this.bodyId}}>{{@text}}</p>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-method {
          display: flex;
          align-items: baseline;
          gap: var(--step-8, 8px);
          min-width: 0;
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-method[data-open] {
          display: grid;
          gap: var(--step-4, 4px);
        }
        .pretui-method-toggle {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          flex: none;
          padding: 0;
          border: 0;
          background: none;
          font: inherit;
          font-weight: 600;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-method-toggle:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
          border-radius: var(--round-chip, 4px);
        }
        .pretui-method-chevron {
          width: 5px;
          height: 5px;
          border-inline-end: 1.5px solid currentColor;
          border-block-end: 1.5px solid currentColor;
          transform: rotate(-45deg);
          transition: transform 160ms
            var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
        }
        .pretui-method[data-open] .pretui-method-chevron {
          transform: rotate(45deg);
        }
        .pretui-method-text {
          min-width: 0;
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-method[data-open] .pretui-method-text {
          white-space: normal;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-method-chevron {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
