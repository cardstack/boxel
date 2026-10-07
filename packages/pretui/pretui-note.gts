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
//   - Color is a tint of `--attention`, not a hardcoded yellow, so a sticky
//     re-tints with the theme and reads correctly in light or dark.
//   - `status` is an Open / Addressed enum. Anything that is not
//     'addressed' counts as open, so a note created with no status set still
//     shows up in the queue.
//   - The title is `cardTitle`: `cardInfo.name` when one is set, otherwise
//     the note's first line, so a note is never "Untitled" in a list.
import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import type { RealmResourceIdentifier } from '@cardstack/runtime-common';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import DateField from 'https://cardstack.com/base/date';
import enumField from 'https://cardstack.com/base/enum';
import { FittedCard } from '@cardstack/boxel-ui/components';
import StickyNoteIcon from '@cardstack/boxel-icons/sticky-note';
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { Button } from './components/button';
import { Chip } from './components/chip';
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

// The note's state as a chip: open is filled with the note's own attention
// tone, addressed with success.
const NoteStatus: TemplateOnlyComponent<{
  Args: { addressed: boolean };
  Element: HTMLSpanElement;
}> = <template>
  <Chip
    @label={{if @addressed 'Addressed' 'Open'}}
    @tone={{if @addressed 'success' 'attention'}}
    data-test-pretui-note-status
    ...attributes
  />
</template>;

export class PretuiNote extends CardDef {
  static displayName = 'Sticky Note';
  static icon = StickyNoteIcon;

  /** what you want changed, in your own words */
  @field note = contains(MarkdownField);
  /** the component this note is stuck to */
  @field target = linksTo(() => PretUISpec);
  /** 'open' (default, and anything unrecognised) or 'addressed' */
  @field status = contains(
    enumField(StringField, {
      options: [
        { value: 'open', label: 'Open' },
        { value: 'addressed', label: 'Addressed' },
      ],
    }),
  );
  /** what the agent actually did about it — written when the note is closed */
  @field resolution = contains(MarkdownField);
  /** the date the note was left. Stamped at creation by the page that
   *  creates it, never read from the clock at render time. */
  @field noted = contains(DateField);
  /** who left it, when that is worth recording */
  @field author = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: PretuiNote) {
      return this.cardInfo?.name?.trim() || noteSummary(this.note);
    },
  });

  static isolated = class Isolated extends Component<typeof PretuiNote> {
    private openTarget = () => {
      let id = this.args.model.target?.id;
      if (!id) return;
      this.args.viewCard?.(id as RealmResourceIdentifier, 'isolated');
    };

    get addressed() {
      return isAddressed(this.args.model.status);
    }

    <template>
      <div class='note-isolated'>
        <article
          class='note-page'
          data-addressed={{if this.addressed 'true'}}
          data-test-pretui-note-page
        >
          <header class='note-head'>
            <span class='note-cap'>Sticky note</span>
            <NoteStatus @addressed={{this.addressed}} />
            {{#if @model.noted}}
              <span class='note-when'><@fields.noted /></span>
            {{/if}}
          </header>

          <h1><@fields.cardTitle /></h1>
          {{#if @model.cardDescription}}
            <p class='note-summary'><@fields.cardDescription /></p>
          {{/if}}

          <div><@fields.note /></div>

          {{#if @model.target}}
            <Button
              class='note-target'
              @tone='neutral'
              @appearance='outlined'
              @size='xs'
              {{on 'click' this.openTarget}}
              data-test-pretui-note-target
            >
              Open
              <strong>{{if
                  @model.target.componentName
                  @model.target.componentName
                  'a component'
                }}</strong>
            </Button>
          {{/if}}

          {{#if @model.resolution}}
            <section class='note-fix'>
              <h2 class='note-cap'>What got fixed</h2>
              <div><@fields.resolution /></div>
            </section>
          {{/if}}

          {{#if @model.author}}
            <footer class='note-foot'>— <@fields.author /></footer>
          {{/if}}
        </article>
      </div>

      <style scoped>
        /* the isolated page owns the scroll and the margin; the sticky sits
           on it as a card */
        .note-isolated {
          --note-page-max-w: 40rem;

          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp-lg);
        }
        /* The sticky is a tint of --attention over --card with --foreground
           text and --attention-ink labels, which hold contrast in light and
           dark. An addressed note goes to the neutral --muted surface. */
        .note-page {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
          max-inline-size: var(--note-page-max-w);
          margin-inline: auto;
          padding: var(--boxel-sp);
          border-radius: var(--boxel-border-radius);
          background-color: color-mix(
            in oklch,
            var(--attention) 14%,
            var(--card)
          );
          color: var(--foreground);
          box-shadow:
            0 0 0 1px var(--border),
            var(--shadow-sm);
        }
        .note-page[data-addressed='true'] {
          background-color: var(--muted);
        }
        .note-page[data-addressed='true']
          :is(.note-cap, .note-when, .note-foot) {
          color: var(--muted-foreground);
        }
        .note-head {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
        }
        /* the sticky's own labels read in its attention ink; the title and
           body keep the surface's --foreground */
        .note-cap,
        .note-when,
        .note-foot {
          color: var(--attention-ink);
        }
        .note-cap {
          font-family: var(--boxel-eyebrow-font-family);
          font-size: var(--boxel-eyebrow-font-size);
          font-weight: var(--boxel-eyebrow-font-weight);
          line-height: var(--boxel-eyebrow-line-height);
          letter-spacing: var(--boxel-eyebrow-letter-spacing);
          text-transform: uppercase;
        }
        .note-when {
          font-family: var(--font-mono);
          font-size: var(--boxel-caption-font-size);
        }
        .note-summary {
          color: var(--muted-foreground);
        }
        .note-target {
          align-self: flex-start;
        }
        .note-fix {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-2xs);
          padding-block-start: var(--boxel-sp-xs);
          box-shadow: inset 0 1px 0 0 var(--border);
        }
        .note-foot {
          font-size: var(--boxel-caption-font-size);
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
        <NoteStatus class='sticky-status' @addressed={{this.addressed}} />
        <div class='sticky-body'><@fields.note /></div>
      </div>
      <style scoped>
        .sticky {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-2xs);
          padding: var(--boxel-sp-xs);
          background-color: color-mix(
            in oklch,
            var(--attention) 14%,
            var(--card)
          );
          color: var(--foreground);
        }
        .sticky[data-addressed='true'] {
          background-color: var(--muted);
        }
        .sticky-status {
          align-self: flex-start;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof PretuiNote> {
    get addressed() {
      return isAddressed(this.args.model.status);
    }
    <template>
      <FittedCard
        class='nfit'
        @titleTag='h3'
        @imageUrl={{@model.cardThumbnailURL}}
        data-addressed={{if this.addressed 'true'}}
        data-test-pretui-note-fitted
      >
        <:badgeRow><NoteStatus @addressed={{this.addressed}} /></:badgeRow>
        <:title><@fields.cardTitle /></:title>
        <:subtitle>
          {{#if @model.cardDescription}}
            <@fields.cardDescription />
          {{else if @model.target.componentName}}
            On
            {{@model.target.componentName}}
          {{/if}}
        </:subtitle>
        <:footer>
          {{#if @model.author}}<span><@fields.author /></span>{{/if}}
          {{#if @model.noted}}<@fields.noted />{{/if}}
        </:footer>
      </FittedCard>
      <style scoped>
        /* FittedCard's fade knob doubles as the surface color, so a
           thumbnail fades into the same tint the card is painted with */
        .nfit {
          --fc-image-fade-color: color-mix(
            in oklch,
            var(--attention) 14%,
            var(--card)
          );

          background-color: var(--fc-image-fade-color);
          color: var(--card-foreground);
        }
        .nfit[data-addressed='true'] {
          --fc-image-fade-color: var(--muted);

          color: var(--foreground);
        }
      </style>
    </template>
  };
}
