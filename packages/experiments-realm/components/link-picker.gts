import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { debounce } from 'lodash-es';
import { guidFor } from '@ember/object/internals';
import { BoxelInput, Button } from '@cardstack/boxel-ui/components';
import ChevronDownIcon from '@cardstack/boxel-icons/chevron-down';
import Popover from '@cardstack/catalog/46f065-popover/popover';
import {
  identifyCard,
  type Filter,
  type Query,
  type getCards,
} from '@cardstack/runtime-common';
import type { CardContext, CardDef } from '@cardstack/base/card-api';

/**
 * A card's display title.
 *
 * `title` is not on `CardDef`'s public type — it is surfaced dynamically from
 * `cardInfo` — so reading it directly is a type error at every call site. One
 * narrow accessor is better than scattering assertions: the cast lives in one
 * place a reader can check.
 */
function titleOf(card: CardDef | undefined): string {
  return (card as { title?: string } | undefined)?.title ?? '';
}

interface Signature {
  Args: {
    /** Uppercase caption, matching the slab's other cells. */
    label: string;
    /** The currently linked card, if any. */
    value?: CardDef;
    /** What to show when nothing is linked — 'Unlinked', 'Unclaimed'. */
    emptyLabel: string;
    /** A second, quieter line under the value. */
    detail?: string;
    /** The type to search. A class, so subclasses are included. */
    cardClass: typeof CardDef;
    context?: CardContext;
    realms: string[];
    /** Called with the chosen card, or undefined when cleared. */
    onPick: (card: CardDef | undefined) => Promise<void> | void;
    /**
     * Create-and-link from the typed text, when this field is one a user may
     * legitimately invent mid-task.
     *
     * Deliberately opt-in per field rather than on by default. A customer who
     * has never called before is normal and the agent must be able to take
     * their ticket; a queue or a category invented during a phone call is a
     * routing rule nobody agreed to, and it silently breaks the SLA that
     * depends on it. So Customer passes this and the setup pickers do not.
     */
    onCreate?: (name: string) => Promise<void> | void;
    /** Noun for the create row: 'customer'. */
    createNoun?: string;
    disabled?: boolean;
  };
  Element: HTMLElement;
}

/**
 * Change what a ticket points at, without leaving the conversation.
 *
 * The thing being edited is the **link**, never the flattened mirror beside
 * it. `customerName` is `computeVia` off `customer`; typing into it would edit
 * a derived value — it could not persist, and the name would immediately
 * disagree with the card it claims to name. So the control is a card chooser
 * and the mirror updates itself.
 *
 * The floating surface is the catalog's `Popover` ComponentListing, not a
 * hand-rolled panel. The hand-rolled one worked in the middle of the screen
 * and broke at the edges: absolutely positioned at `top:100%; left:0` with no
 * flip, so the Queue picker — which already sits against the right edge of the
 * slab — clipped as soon as the window narrowed. Consuming the listing brings
 * Floating UI's flip/shift, outside-click dismissal, focus capture and
 * restore, and the ARIA roles, none of which this file should be re-deriving.
 *
 * The list comes from `getCards`, whose `instances` arrive already resolved.
 * `SearchCardsByQueryCommand` was the first attempt and it does not work here:
 * its result card exposes the matches as a `linksToMany`, so reading them
 * straight after the call races the async link load and yields an empty list —
 * the picker said "there are none of these to choose yet" while three sat in
 * the realm. The query thunk returns `undefined` while the picker is closed,
 * so a closed picker costs nothing and only the open one is subscribed.
 */
export class LinkPicker extends GlimmerComponent<Signature> {
  @tracked open = false;
  @tracked search = '';
  @tracked creating = false;
  @tracked problemText: string | undefined;

  /**
   * The popover finds its source with a CSS selector, so the trigger needs an
   * id that is unique across the page — four pickers share this component and
   * two of them could share a label if a host ever rendered two workspaces.
   */
  anchorId = `lp-${guidFor(this)}`;

  get anchorSelector(): string {
    return `[data-bx-popover-anchor='${this.anchorId}']`;
  }

  private cards: ReturnType<getCards> | undefined;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner as never, args as never);
    this.cards = this.args.context?.getCards(
      this,
      () => this.pickerQuery,
      () => this.args.realms,
      { isLive: true },
    );
  }

  private setSearchNow = debounce((value: string) => {
    this.search = value;
  }, 250);

  get pickerQuery(): Query | undefined {
    if (!this.open) {
      return undefined;
    }
    let ref = identifyCard(this.args.cardClass);
    if (!ref || !this.args.realms.length) {
      return undefined;
    }
    // No text -> a plain type filter. Text -> the type AND (full-document
    // `matches` OR title `contains`); `matches` finds a term buried in a
    // description, `contains` guarantees the title the reader obviously meant.
    let text = this.search.trim();
    let filter: Filter = text
      ? {
          every: [
            { type: ref },
            { any: [{ matches: text }, { contains: { cardTitle: text } }] },
          ],
        }
      : { type: ref };
    // `sort` without `on` returns an EMPTY result rather than an unsorted one.
    return { filter, sort: [{ by: 'title', on: ref, direction: 'asc' }] };
  }

  get results(): CardDef[] {
    return ((this.cards?.instances ?? []) as CardDef[]).filter(Boolean);
  }

  get isSearching(): boolean {
    return Boolean(this.cards?.isLoading);
  }

  get problem(): string | undefined {
    if (this.problemText) {
      return this.problemText;
    }
    return this.args.context
      ? undefined
      : 'Search is unavailable in this view.';
  }

  get typed(): string {
    return this.search.trim();
  }

  /**
   * Offer the create row when the typed text matches nothing exactly.
   *
   * Not "when there are no results at all": a search for "Kai" that already
   * returns "Kai Tan" should still offer to create "Kai" if that is a
   * different person. But an exact title match means the card is already
   * there, and offering to create it again is how a realm ends up holding the
   * same customer twice.
   */
  get canCreate(): boolean {
    if (!this.args.onCreate || !this.typed || this.isSearching) {
      return false;
    }
    let typed = this.typed.toLowerCase();
    return !this.results.some((c) => titleOf(c).trim().toLowerCase() === typed);
  }

  create = async (_event?: Event) => {
    if (!this.args.onCreate || !this.typed) {
      return;
    }
    this.creating = true;
    this.problemText = undefined;
    try {
      await this.args.onCreate(this.typed);
      this.open = false;
      this.search = '';
    } catch (error: any) {
      this.problemText = error?.message ?? String(error);
    } finally {
      this.creating = false;
    }
  };

  get displayValue(): string {
    return titleOf(this.args.value).trim() || this.args.emptyLabel;
  }

  get hasValue(): boolean {
    return Boolean(this.args.value);
  }

  toggle = (_event?: Event) => {
    if (this.args.disabled) {
      return;
    }
    this.open = !this.open;
    if (!this.open) {
      this.setSearchNow.cancel();
      this.search = '';
    }
    this.problemText = undefined;
  };

  close = (_event?: Event) => {
    this.open = false;
    this.setSearchNow.cancel();
    this.search = '';
  };

  // Debounce the tracked assignment, not the input's value — the box must feel
  // immediate; it is the query that waits.
  setSearch = (value: string) => {
    this.setSearchNow(value);
  };

  /**
   * Down-arrow out of the search box and into the list.
   *
   * `keyboardModel` is 'edit', not 'pick': this is search-first — the agent's
   * opening move is to type a name, so focus has to land in the input, and
   * 'pick' would hand it to the listbox instead. That leaves the list itself
   * unreachable by keyboard, which this closes: type, then press Down.
   */
  // Typed as `Event` because that is what `on` hands a listener; the
  // narrowing happens here rather than in the signature, where it would
  // not be assignable.
  fromSearch = (raw: Event) => {
    let event = raw as KeyboardEvent;
    if (event.key !== 'ArrowDown') {
      return;
    }
    let root = (event.target as HTMLElement)?.closest('[data-bx-popover]');
    let first = root?.querySelector<HTMLElement>('.lp-opt, .lp-new');
    if (first) {
      first.focus();
      event.preventDefault();
    }
  };

  /**
   * Reset the box on the way out, and survive a failing handler.
   *
   * `pick` and `clear` used to close without clearing `search`, unlike `close`
   * and `toggle` — so reopening the picker to change a link showed the
   * previous term still narrowing the list, and an existing contact read as
   * "Nothing matches. Try fewer words." An unhandled rejection from `onPick`
   * also escaped silently, leaving the picker shut with nothing said.
   */
  private async finish(chosen: CardDef | undefined) {
    this.open = false;
    this.setSearchNow.cancel();
    this.search = '';
    this.problemText = undefined;
    try {
      await this.args.onPick(chosen);
    } catch (error: any) {
      this.problemText = error?.message ?? String(error);
    }
  }

  pick = async (card: CardDef, _event?: Event) => {
    await this.finish(card);
  };

  clear = async (_event?: Event) => {
    await this.finish(undefined);
  };

  isCurrent = (card: CardDef) => card?.id === this.args.value?.id;

  <template>
    <div class='lp' ...attributes>
      <span class='lp-label' id='lp-{{@label}}'>{{@label}}</span>
      <button
        type='button'
        class='lp-trigger {{unless this.hasValue "lp-empty"}}'
        data-bx-popover-anchor={{this.anchorId}}
        aria-expanded={{if this.open 'true' 'false'}}
        aria-haspopup='listbox'
        aria-labelledby='lp-{{@label}}'
        disabled={{@disabled}}
        {{on 'click' this.toggle}}
      >
        <span class='lp-line'>
          <span class='lp-value'>{{this.displayValue}}</span>
          {{#unless @disabled}}
            <ChevronDownIcon class='lp-caret' role='presentation' />
          {{/unless}}
        </span>
        {{#if @detail}}
          <span class='lp-detail'>{{@detail}}</span>
        {{/if}}
      </button>

      {{! The catalog's Popover owns the surface: Floating UI placement with
          flip and shift, outside-click and Esc dismissal, focus in on open
          and back to the trigger on close. Content goes in the NAMED block —
          the default block renders nothing, which is the trap this listing
          sets for first-time consumers. }}
      <Popover
        @anchor={{this.anchorSelector}}
        @open={{this.open}}
        @kind='edit'
        @anchoring='beside'
        @placement='bottom-start'
        @size='auto'
        @elevation='raised'
        @keyboardModel='edit'
        @label='Choose {{@label}}'
        @onDismiss={{this.close}}
      >
        <:edit>
          <div class='lp-body'>
            <label class='sr-only' for='lp-q-{{this.anchorId}}'>Search
              {{@label}}</label>
            <BoxelInput
              class='lp-q'
              id='lp-q-{{this.anchorId}}'
              @type='search'
              @value={{this.search}}
              @onInput={{this.setSearch}}
              @placeholder='Search…'
              {{on 'keydown' this.fromSearch}}
            />

            {{#if this.problem}}
              <p class='lp-note lp-bad' role='alert'>{{this.problem}}</p>
            {{else if this.isSearching}}
              <p class='lp-note' role='status'>Searching…</p>
            {{else if this.results.length}}
              {{! Real listbox semantics: the popover's keyboard layer and any
                  screen reader both read the roles, not the class names. }}
              <ul class='lp-list' role='listbox' aria-label='{{@label}}'>
                {{#each this.results key='id' as |card|}}
                  <li role='presentation'>
                    <button
                      type='button'
                      role='option'
                      class='lp-opt {{if (this.isCurrent card) "lp-opt-on"}}'
                      aria-selected={{if (this.isCurrent card) 'true' 'false'}}
                      {{on 'click' (fn this.pick card)}}
                    >{{card.title}}</button>
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class='lp-note'>{{if
                  this.search
                  'Nothing matches. Try fewer words.'
                  'There are none of these to choose yet.'
                }}</p>
            {{/if}}

            {{#if this.canCreate}}
              {{! The create row is the LAST OPTION IN THE LIST, not a button
                  parked under it. Searching and creating are two outcomes of
                  one gesture; drawing the second as a separate control makes
                  it look like a different feature that happens to live in the
                  same popover. So it takes the option row's shape and sits
                  under a hairline, with the typed name carried as the
                  emphasis and a leading + to say what will happen. }}
              <button
                type='button'
                class='lp-new'
                disabled={{this.creating}}
                {{on 'click' this.create}}
              >
                <span class='lp-plus' aria-hidden='true'>+</span>
                <span class='lp-new-text'>
                  {{#if this.creating}}
                    Adding…
                  {{else}}
                    Add
                    <b>{{this.typed}}</b>
                    as a new
                    {{if @createNoun @createNoun 'record'}}
                  {{/if}}
                </span>
              </button>
            {{/if}}

            {{#if this.hasValue}}
              {{! Only Unlink survives. Close was doing what Esc and an
                  outside click now do for free, and a popover that ends in a
                  pair of buttons reads as a form waiting to be submitted when
                  every choice above it commits immediately. }}
              <div class='lp-foot'>
                <Button
                  @kind='text-only'
                  @size='extra-small'
                  {{on 'click' this.clear}}
                >Unlink</Button>
              </div>
            {{/if}}
          </div>
        </:edit>
      </Popover>
    </div>

    <style scoped>
      .lp {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }
      .lp-label {
        font-size: 0.5625rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-450));
      }
      /* Looks like what it is: a control you pick a value in.
         It used to be styled "quiet until approached" — transparent border,
         no affordance at rest — which put three editable fields next to two
         BoxelSelects in the same panel with completely different resting
         appearances. The reader's conclusion was that the quiet ones were
         disabled. They match the selects now; the plain-text treatment is
         reserved for when the field genuinely IS read-only. */
      .lp-trigger {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 1px;
        width: 100%;
        min-width: 0;
        padding: 3px 6px;
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm, 4px);
        background: var(--card, var(--boxel-light));
        color: inherit;
        font-family: inherit;
        text-align: start;
        cursor: pointer;
      }
      .lp-trigger:hover:not(:disabled) {
        border-color: var(--primary, var(--boxel-highlight));
      }
      .lp-trigger:focus-visible {
        outline: 2px solid var(--primary, var(--boxel-highlight));
        outline-offset: 1px;
      }
      /* Read-only: no box, no caret, no pointer — a value, not a control. */
      .lp-trigger:disabled {
        padding-inline: 0;
        border-color: transparent;
        background: none;
        cursor: default;
      }
      .lp-line {
        display: flex;
        align-items: center;
        gap: 0.35em;
        width: 100%;
        min-width: 0;
      }
      .lp-caret {
        flex: none;
        width: 0.8rem;
        height: 0.8rem;
        margin-left: auto;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .lp-value {
        max-width: 100%;
        font-weight: 700;
        font-size: var(--boxel-font-size-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* An unset link is a gap in the record, not a value. It says so. */
      .lp-empty .lp-value {
        font-weight: 600;
        font-style: italic;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .lp-detail {
        max-width: 100%;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* Only the CONTENT is styled here. Position, surface, shadow, radius
         and z-index belong to the popover listing — restating them would be
         the fork this refactor exists to undo. */
      .lp-body {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
        min-width: 17rem;
        padding: var(--boxel-sp-xs);
      }
      /* BoxelInput's search skin defaults to a near-black ground, which is
         correct on a dark toolbar and wrong inside a light popover — it drew a
         black slab as the first thing in the panel. Re-skinned through the
         component's own knobs, paired background and foreground together so a
         theme flip cannot produce black-on-black. */
      .lp-q {
        --boxel-input-search-background-color: var(--card, var(--boxel-light));
        --boxel-input-search-color: var(--foreground, var(--boxel-dark));
        --boxel-input-search-icon-color: var(
          --muted-foreground,
          var(--boxel-450)
        );
        --boxel-input-height: 2rem;
      }
      .lp-list {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: 13rem;
        overflow-y: auto;
      }
      .lp-opt {
        display: block;
        width: 100%;
        padding: 4px 6px;
        border: none;
        border-radius: var(--boxel-border-radius-sm, 4px);
        background: none;
        color: inherit;
        font-family: inherit;
        font-size: var(--boxel-font-size-xs);
        text-align: start;
        cursor: pointer;
      }
      .lp-opt:hover {
        background: var(--muted, var(--boxel-100));
      }
      .lp-opt:focus-visible {
        outline: 2px solid var(--primary, var(--boxel-highlight));
        outline-offset: -2px;
      }
      .lp-opt-on {
        font-weight: 700;
        background: color-mix(
          in oklch,
          var(--primary, var(--boxel-highlight)) 12%,
          var(--card, var(--boxel-light))
        );
      }
      .lp-note {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .lp-bad {
        color: var(--boxel-danger);
      }
      .lp-new {
        display: flex;
        align-items: center;
        gap: 0.45em;
        width: 100%;
        margin-top: 2px;
        padding: 5px 6px;
        border: none;
        border-top: 1px solid var(--border, var(--boxel-200));
        border-radius: 0;
        background: none;
        color: var(--foreground, var(--boxel-dark));
        font-family: inherit;
        font-size: var(--boxel-font-size-xs);
        text-align: start;
        cursor: pointer;
      }
      .lp-new:hover:not(:disabled) {
        background: var(--muted, var(--boxel-100));
      }
      .lp-new:focus-visible {
        outline: 2px solid var(--primary, var(--boxel-highlight));
        outline-offset: -2px;
      }
      .lp-new:disabled {
        color: var(--muted-foreground, var(--boxel-450));
        cursor: default;
      }
      .lp-plus {
        flex: none;
        width: 1rem;
        height: 1rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 3px;
        background: var(--muted, var(--boxel-100));
        color: var(--muted-foreground, var(--boxel-450));
        font-weight: 700;
        line-height: 1;
      }
      /* One line. A name long enough to wrap turns the row into a paragraph
         and the popover jumps height while the user is still typing. */
      .lp-new-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .lp-foot {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-4xs);
        margin-top: 2px;
        padding-top: 4px;
        border-top: 1px solid var(--border, var(--boxel-200));
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    </style>
  </template>
}

export default LinkPicker;
