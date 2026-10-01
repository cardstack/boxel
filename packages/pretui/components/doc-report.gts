// Pretui — DocReport: a rich agent deliverable, capped and expandable, with previewable card pills.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import { Button } from './button';
import { Prose } from './prose';
import { Tooltip } from './tooltip';
import { iconFor } from '../icon-registry';

// ── DocReport ────────────────────────────────────────────────────────────
// The deliverable at the end of a research run: a document, not a chat
// message. Two things make it a component rather than a `<div>` of prose —
// it is capped so a 4000-word report cannot swallow the transcript, and the
// cards it cites are pills you can preview without leaving the report.
//
// The body is a slot, never a string: a report is markdown, tables, embedded
// cards, whatever the run produced (Law 7). `Prose` supplies the reading
// measure and the inline-code treatment; `Tooltip` supplies the pill preview
// and, being CSS-only on hover AND focus-within, works from the keyboard —
// which the design mirror's hover-only fit-preview did not.

export interface DocCard {
  /** stable id — the {{#each}} key */
  id: string;
  /** the pill face */
  label: string;
  /** one line shown in the preview */
  summary?: string;
  /** boxel-ui icon export name, resolved through icon-registry */
  icon?: string;
}

export interface DocReportSignature {
  Args: {
    /** the report's title */
    title: string;
    /** small caps line above the title, e.g. 'Research · 12 sources' */
    eyebrow?: string;
    /** short facts rendered as a machine-value strip under the title */
    meta?: string[];
    /** the cards this report cites */
    cards?: DocCard[];
    /** fires when a card pill is activated */
    onOpenCard?: (card: DocCard) => void;
    /** controlled expansion */
    expanded?: boolean;
    /** starting expansion when uncontrolled */
    defaultExpanded?: boolean;
    /** fires with the requested expansion */
    onExpandedChange?: (expanded: boolean) => void;
    /** expand-button wording (default 'Full report') */
    expandLabel?: string;
    /** collapse-button wording (default 'Collapse') */
    collapseLabel?: string;
  };
  Blocks: {
    /** the report body */
    default: [];
    /** actions in the header, right of the title */
    actions: [];
  };
  Element: HTMLElement;
}

export class DocReport extends Component<DocReportSignature> {
  @tracked private innerExpanded?: boolean;

  private bodyId = guidFor(this) + '-body';

  get expanded(): boolean {
    return (
      this.args.expanded ?? this.innerExpanded ?? this.args.defaultExpanded ?? false
    );
  }
  get toggleLabel(): string {
    return this.expanded
      ? (this.args.collapseLabel ?? 'Collapse')
      : (this.args.expandLabel ?? 'Full report');
  }
  get cards(): DocCard[] {
    return this.args.cards ?? [];
  }
  get meta(): string[] {
    return this.args.meta ?? [];
  }

  toggle = () => {
    let next = !this.expanded;
    if (this.args.expanded === undefined) {
      this.innerExpanded = next;
    }
    this.args.onExpandedChange?.(next);
  };

  openCard = (card: DocCard) => this.args.onOpenCard?.(card);

  <template>
    <article
      class='pretui-doc'
      data-expanded={{if this.expanded 'true'}}
      data-test-pretui-doc-report
      ...attributes
    >
      <header class='pretui-doc-head'>
        <div class='pretui-doc-titles'>
          {{#if @eyebrow}}
            <span class='pretui-doc-eyebrow'>{{@eyebrow}}</span>
          {{/if}}
          <h3 class='pretui-doc-title'>{{@title}}</h3>
        </div>
        {{yield to='actions'}}
      </header>

      {{#if this.meta.length}}
        <ul class='pretui-doc-meta' aria-label='Report facts'>
          {{#each this.meta as |fact|}}
            <li><code>{{fact}}</code></li>
          {{/each}}
        </ul>
      {{/if}}

      <div class='pretui-doc-clip' id={{this.bodyId}}>
        <Prose>{{yield}}</Prose>
      </div>

      <div class='pretui-doc-foot'>
        <Button
          @tone='neutral'
          @appearance='outlined'
          @size='s'
          aria-expanded={{if this.expanded 'true' 'false'}}
          aria-controls={{this.bodyId}}
          data-test-pretui-doc-report-toggle
          {{on 'click' this.toggle}}
        >{{this.toggleLabel}}</Button>

        {{#if this.cards.length}}
          <ul class='pretui-doc-pills' aria-label='Cards cited'>
            {{#each this.cards key='id' as |card|}}
              <li>
                <Tooltip @content={{if card.summary card.summary card.label}}>
                  <button
                    type='button'
                    class='pretui-doc-pill'
                    data-test-pretui-doc-report-pill
                    {{on 'click' (fn this.openCard card)}}
                  >
                    {{#let (iconFor card.icon) as |CardIcon|}}
                      {{#if CardIcon}}
                        <CardIcon
                          class='pretui-doc-pill-icon'
                          role='presentation'
                        />
                      {{/if}}
                    {{/let}}
                    <span>{{card.label}}</span>
                  </button>
                </Tooltip>
              </li>
            {{/each}}
          </ul>
        {{/if}}
      </div>
    </article>

    <style scoped>
      .pretui-doc {
        display: flex;
        flex-direction: column;
        gap: var(--space-3, 9px);
        padding: var(--space-4, 13px);
        border-radius: var(--radius-surface, 14px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-card,
          0 0 0 1px var(--border),
          0 1px 2px rgb(0 0 0 / 0.08)
        );
      }
      .pretui-doc-head {
        display: flex;
        align-items: flex-start;
        gap: 10px;
      }
      .pretui-doc-titles {
        flex: 1;
        min-width: 0;
      }
      .pretui-doc-eyebrow {
        display: block;
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--ink-3, var(--boxel-400));
      }
      .pretui-doc-title {
        margin: 2px 0 0;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: -0.02em;
      }
      .pretui-doc-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .pretui-doc-meta code {
        font-family: var(--font-mono);
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 5px;
        background: var(--inset, var(--boxel-100));
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        color: var(--muted-foreground);
        font-variant-numeric: tabular-nums;
      }
      /* the cap: content beyond it is clipped and faded out, so the reader
         can see that there IS more rather than guessing */
      .pretui-doc-clip {
        font-size: var(--text-ui-md, 12.5px);
        max-height: var(--pretui-doc-cap, 16rem);
        overflow: hidden;
        mask-image: linear-gradient(
          to bottom,
          #000 0,
          #000 calc(100% - 3rem),
          transparent 100%
        );
        transition: mask-image 200ms linear;
      }
      .pretui-doc[data-expanded] .pretui-doc-clip {
        max-height: none;
        overflow: visible;
        mask-image: none;
      }
      .pretui-doc-foot {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .pretui-doc-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .pretui-doc-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-height: 24px;
        padding: 0 9px;
        border: 0;
        border-radius: 999px;
        background: var(--inset, var(--boxel-100));
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        font: inherit;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .pretui-doc-pill:hover {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      .pretui-doc-pill:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .pretui-doc-pill-icon {
        width: 12px;
        height: 12px;
        flex: none;
      }
      @media (any-pointer: coarse) {
        .pretui-doc-pill {
          min-height: 44px;
          padding: 0 14px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-doc-clip {
          transition: none;
        }
      }
    </style>
  </template>
}
