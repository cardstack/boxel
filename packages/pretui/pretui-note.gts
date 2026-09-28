// Pretui — the sticky note: an annotation left on a component page.
//
// The loop this closes: you are looking at a component in the gallery,
// something is wrong or missing, you stick a note on it. An agent later
// picks up every open note, fixes the code, folds the note AND what it did
// about it into that component's `writeup` markdown, and marks the note
// addressed. The note is the request; the writeup is the permanent record.
//
// Design notes:
//   - The note LINKS to its component (`target`), so the relationship is a
//     real edge in the graph rather than a name match. The component page
//     finds its own notes by querying for that edge.
//   - Colour is the Law 2 recipe over one hue, not a hardcoded yellow, so a
//     sticky re-tints with the season and reads correctly in light or dark.
//     `--pretui-note-hue` is the knob.
//   - `status` is deliberately a plain string rather than an enum field: an
//     agent writes it, and a value this small does not need a field class.
//     Anything that is not 'addressed' counts as open, so a note created by
//     hand with no status set still shows up in the queue.
import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { on } from '@ember/modifier';
import { PretUISpec } from './pretui-component';

/** A note is open unless it has been explicitly addressed. */
export function isAddressed(status: string | undefined): boolean {
  return (status ?? '').toLowerCase() === 'addressed';
}

/**
 * First line of a note, flattened to plain text and shortened — the note's
 * title in card lists, search results, and the assistant's card picker.
 * Notes are markdown, so the leading `#`/`>`/`-`/backtick furniture is
 * stripped rather than shown.
 */
export function noteSummary(note: string | undefined): string {
  let first = (note ?? '')
    .split('\n')
    .map((line) => line.replace(/^[\s>#*\-+]+/, '').trim())
    .find((line) => line.length > 0);
  if (!first) return 'Sticky note';
  let plain = first.replace(/[`*_]/g, '');
  return plain.length > 72 ? `${plain.slice(0, 71)}…` : plain;
}

export class PretuiNote extends CardDef {
  static displayName = 'Sticky Note';

  /** what you want changed, in your own words */
  @field note = contains(MarkdownField);
  /** the component this note is stuck to */
  @field target = linksTo(() => PretUISpec);
  /** 'open' (default, and anything unrecognised) or 'addressed' */
  @field status = contains(StringField);
  /** what the agent actually did about it — written when the note is closed */
  @field resolution = contains(MarkdownField);
  /** ISO date the note was left. Stamped at creation by the page that
   *  creates it, never read from the clock at render time. */
  @field noted = contains(StringField);
  /** who left it, when that is worth recording */
  @field author = contains(StringField);

  /** Derived so a note is never "Untitled" in a list, a search result, or the
   *  assistant's card picker — the note text IS the title. */
  @field title = contains(StringField, {
    computeVia: function (this: PretuiNote) {
      return noteSummary(this.note);
    },
  });

  static isolated = class Isolated extends Component<typeof PretuiNote> {
    private openTarget = () => {
      let id = this.args.model.target?.id;
      if (!id) return;
      this.args.viewCard?.(new URL(id), 'isolated');
    };

    get addressed() {
      return isAddressed(this.args.model.status);
    }

    <template>
      <article
        class='note-page'
        data-addressed={{if this.addressed 'true'}}
        data-test-pretui-note-page
      >
        <header class='note-head'>
          <span class='note-cap'>Sticky note</span>
          <span class='note-state'>{{if this.addressed 'addressed' 'open'}}</span>
          {{#if @model.noted}}
            <span class='note-when'>{{@model.noted}}</span>
          {{/if}}
        </header>

        <div class='note-body'><@fields.note /></div>

        {{#if @model.target}}
          <button
            type='button'
            class='note-target'
            data-test-pretui-note-target
            {{on 'click' this.openTarget}}
          >
            On
            <strong>{{if
                @model.target.componentName
                @model.target.componentName
                'a component'
              }}</strong>
          </button>
        {{/if}}

        {{#if @model.resolution}}
          <section class='note-fix'>
            <span class='note-cap'>What got fixed</span>
            <div class='note-body'><@fields.resolution /></div>
          </section>
        {{/if}}

        {{#if @model.author}}
          <footer class='note-foot'>— {{@model.author}}</footer>
        {{/if}}
      </article>

      <style scoped>
        /* Law 2: one hue in, a complete treatment out. The sticky is a tint
           of --pretui-note-hue over --card, with ink derived from the same
           hue — so it holds contrast in light AND dark without a branch. */
        .note-page {
          --hue: var(--pretui-note-hue, var(--chart-3));
          display: flex;
          flex-direction: column;
          gap: var(--space-3, 10px);
          padding: var(--space-5, 18px);
          border-radius: var(--radius-surface, 10px);
          background: color-mix(in oklch, var(--hue) 14%, var(--card));
          color: color-mix(in oklch, var(--foreground) 16%, var(--hue));
          /* Law 1: depth is hairline + shadow, never contrast. */
          box-shadow: var(
            --pretui-shadow-card,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.2),
            0 2px 6px rgb(0 0 0 / 0.2)
          );
        }
        .note-page[data-addressed='true'] {
          --hue: var(--muted-foreground);
        }
        .note-head {
          display: flex;
          align-items: baseline;
          gap: var(--space-3, 10px);
        }
        .note-cap {
          font-size: var(--text-ui-xs, 11px);
          font-weight: 600;
          letter-spacing: var(--track-eyebrow, 0.06em);
          text-transform: uppercase;
          color: color-mix(
            in oklch,
            var(--foreground) 45%,
            var(--hue)
          );
        }
        .note-state,
        .note-when {
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          color: color-mix(
            in oklch,
            var(--foreground) 45%,
            var(--hue)
          );
        }
        .note-body {
          font-size: var(--text-ui-md, 12.5px);
          line-height: 1.6;
          color: var(--foreground);
        }
        .note-target {
          align-self: flex-start;
          padding: 4px 9px;
          border: 0;
          border-radius: var(--radius-control, 7px);
          background: var(--card);
          box-shadow: var(
            --pretui-shadow-control,
            0 0 0 1px var(--border)
          );
          font-size: var(--text-ui-xs, 11px);
          color: var(--foreground);
          cursor: pointer;
        }
        .note-target:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .note-fix {
          display: flex;
          flex-direction: column;
          gap: var(--space-2, 6px);
          padding-top: var(--space-3, 10px);
          box-shadow: inset 0 1px 0 0
            color-mix(in oklch, var(--hue) 30%, transparent);
        }
        .note-foot {
          font-size: var(--text-ui-xs, 11px);
          color: color-mix(
            in oklch,
            var(--foreground) 45%,
            var(--hue)
          );
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof PretuiNote> {
    get addressed() {
      return isAddressed(this.args.model.status);
    }
    <template>
      <div
        class='sticky'
        data-addressed={{if this.addressed 'true'}}
        data-test-pretui-note-embedded
      >
        <div class='sticky-body'><@fields.note /></div>
        {{#if this.addressed}}
          <span class='sticky-done'>addressed</span>
        {{/if}}
      </div>
      <style scoped>
        .sticky {
          --hue: var(--pretui-note-hue, var(--chart-3));
          display: flex;
          flex-direction: column;
          gap: var(--space-2, 6px);
          padding: var(--space-3, 10px);
          border-radius: var(--radius-surface, 10px);
          background: color-mix(in oklch, var(--hue) 14%, var(--card));
          box-shadow: var(
            --pretui-shadow-card,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.2)
          );
          font-size: var(--text-ui-md, 12.5px);
          line-height: 1.5;
          color: var(--foreground);
        }
        .sticky[data-addressed='true'] {
          --hue: var(--muted-foreground);
          color: var(--muted-foreground);
        }
        .sticky-done {
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          letter-spacing: var(--track-eyebrow, 0.06em);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof PretuiNote> {
    get addressed() {
      return isAddressed(this.args.model.status);
    }
    <template>
      <div
        class='nfit'
        data-addressed={{if this.addressed 'true'}}
        data-test-pretui-note-fitted
      >
        <span class='nfit-dot'></span>
        {{! the computed title is the note's first line, already flattened out
            of markdown — the raw field would show `#`/backtick furniture }}
        <span class='nfit-title'>{{if @model.title @model.title 'Sticky note'}}</span>
        <span class='nfit-on'>{{if
            @model.target.componentName
            @model.target.componentName
            ''
          }}</span>
      </div>
      <style scoped>
        .nfit {
          --hue: var(--pretui-note-hue, var(--chart-3));
          display: flex;
          align-items: center;
          gap: var(--space-2, 6px);
          width: 100%;
          height: 100%;
          padding: var(--space-3, 10px);
          background: color-mix(in oklch, var(--hue) 14%, var(--card));
          font-size: var(--text-ui-md, 12.5px);
          color: var(--foreground);
          overflow: hidden;
        }
        .nfit[data-addressed='true'] {
          --hue: var(--muted-foreground);
        }
        .nfit-dot {
          flex: none;
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: var(--hue);
        }
        .nfit-title {
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .nfit-on {
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          color: var(--muted-foreground);
          white-space: nowrap;
        }
      </style>
    </template>
  };
}
