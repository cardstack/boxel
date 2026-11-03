// Pretui — SearchInput: a search field with a clear button.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import SearchIcon from '@cardstack/boxel-icons/search';
import { htmlSafe } from '@ember/template';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlAliasArgs } from '../pretui-primitives';
import { TYPED_BLOCK_RULES } from '../internal/extras';
import { SEARCH_START_PADDING, SearchGlyph } from '../internal/search-glyph';
import { FieldDress } from '../internal/field-dress';

// A BoxelInput in Input's field style with the kit's own magnifier, plus the
// clear button boxel-ui doesn't ship: an overlay ✕ appears once the field
// holds text and resets it through @onInput(''). Wave-0 adaptation
// (documented): no debounce knob — realm code takes no timers; debounce
// belongs to the consumer's data layer.

const SEARCH_METRICS = htmlSafe(
  `${TYPED_BLOCK_RULES} ${SEARCH_START_PADDING} padding-inline-end: 1.75rem;`,
);

export interface SearchInputSignature {
  Args: ControlAliasArgs & {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    controlId?: string;
    /** show the clear button once the field holds text — true by default */
    clearable?: boolean;
    onInput?: (value: string) => void;
    /** 'field' (default) the whole field; 'collapsed' a square button
     * showing the magnifier, which opens the full field over the row on
     * click or focus; Escape or leaving it closes it again */
    display?: 'field' | 'collapsed';
  };
  Element: HTMLDivElement;
}

export class SearchInput extends Component<SearchInputSignature> {
  @tracked internal = this.args.value ?? '';
  @tracked open = false;
  // set while Escape hands focus back, so that focus doesn't reopen it
  private returning = false;

  get collapsed() {
    return this.args.display === 'collapsed';
  }
  get showField() {
    return !this.collapsed || this.open;
  }
  get collapsedName() {
    let name = this.args.placeholder || 'Search';
    return this.current ? `${name}: ${this.current}` : name;
  }
  expand = () => {
    // focus and click both fire on one activation; writing open twice in
    // one render is an autotracking error
    if (this.open || this.returning || this.disabled) {
      return;
    }
    this.open = true;
  };
  // keydown and focusout from inside the field, on the wrapper
  closesOnLeave = modifier((root: HTMLElement) => {
    root.addEventListener('keydown', this.closeOnEscape);
    root.addEventListener('focusout', this.closeOnLeave);
    return () => {
      root.removeEventListener('keydown', this.closeOnEscape);
      root.removeEventListener('focusout', this.closeOnLeave);
    };
  });
  private closeOnEscape = (event: KeyboardEvent) => {
    if (!this.open || event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    let root = (event.currentTarget as HTMLElement).closest(
      '[data-pretui-search-collapsible]',
    );
    this.open = false;
    // the button renders in the same frame the field leaves
    requestAnimationFrame(() => {
      this.returning = true;
      root
        ?.querySelector<HTMLElement>('[data-pretui-search-toggle]')
        ?.focus();
      this.returning = false;
    });
  };
  private closeOnLeave = (event: FocusEvent) => {
    let root = event.currentTarget as HTMLElement;
    if (!root.contains(event.relatedTarget as Node | null)) {
      this.open = false;
    }
  };
  focusOnOpen = modifier((el: HTMLElement) => {
    el.querySelector('input')?.focus();
  });

  get current() {
    return this.args.value ?? this.internal;
  }
  get showClear() {
    return (
      (this.args.clearable ?? true) && this.current !== '' && !this.disabled
    );
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  private notify(value: string) {
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      value,
    );
  }
  handleInput = (value: string) => {
    this.internal = value;
    this.notify(value);
  };
  clear = (event: Event) => {
    this.internal = '';
    this.notify('');
    // the button leaves with the text; focus stays in the field
    (event.currentTarget as HTMLElement).parentElement
      ?.querySelector('input')
      ?.focus();
  };
  <template>
    {{#if this.collapsed}}
      <div
        class='pretui-searchcollapse'
        data-pretui-search-collapsible
        data-open={{if this.open 'true'}}
        {{this.closesOnLeave}}
        data-test-pretui-search-input
        ...attributes
      >
        {{#if this.open}}
          <FieldDress
            class='pretui-searchcollapse-field'
            data-filled={{if this.showClear 'true'}}
            {{this.focusOnOpen}}
          >
      <BoxelInput
        @value={{this.current}}
        @placeholder={{@placeholder}}
        @disabled={{this.disabled}}
        @onInput={{this.handleInput}}
        id={{@controlId}}
        style={{SEARCH_METRICS}}
      />
      <SearchGlyph @dimmed={{this.disabled}} />
      {{#if this.showClear}}
        <button
          type='button'
          class='pretui-searchclear'
          aria-label='Clear search'
          {{on 'click' this.clear}}
        >
          <svg width='12' height='12' viewBox='0 0 12 12' aria-hidden='true'><path
              d='M3 3l6 6M9 3l-6 6'
              fill='none'
              stroke='currentColor'
              stroke-width='1.5'
              stroke-linecap='round'
            /></svg>
        </button>
      {{/if}}
          </FieldDress>
        {{else}}
          <button
            type='button'
            class='pretui-searchtoggle'
            aria-label={{this.collapsedName}}
            title={{this.collapsedName}}
            disabled={{this.disabled}}
            data-pretui-search-toggle
            {{on 'click' this.expand}}
            {{on 'focus' this.expand}}
            data-test-pretui-search-toggle
          >
            <SearchIcon width='14' height='14' aria-hidden='true' />
          </button>
        {{/if}}
      </div>
    {{else}}
    <FieldDress
      data-filled={{if this.showClear 'true'}}
      data-test-pretui-search-input
      ...attributes
    >
      <BoxelInput
        @value={{this.current}}
        @placeholder={{@placeholder}}
        @disabled={{this.disabled}}
        @onInput={{this.handleInput}}
        id={{@controlId}}
        style={{SEARCH_METRICS}}
      />
      <SearchGlyph @dimmed={{this.disabled}} />
      {{#if this.showClear}}
        <button
          type='button'
          class='pretui-searchclear'
          aria-label='Clear search'
          {{on 'click' this.clear}}
        >
          <svg width='12' height='12' viewBox='0 0 12 12' aria-hidden='true'><path
              d='M3 3l6 6M9 3l-6 6'
              fill='none'
              stroke='currentColor'
              stroke-width='1.5'
              stroke-linecap='round'
            /></svg>
        </button>
      {{/if}}
    </FieldDress>
    {{/if}}
    <style scoped>
      @layer PretComponent {
        /* inset the same on the block and inline sides, with the field's
           corner less that inset, so the button and its ring sit concentric
           in the field */
        .pretui-searchclear {
          --_inset: calc((var(--boxel-input-height) - 1.25rem) / 2);
          position: absolute;
          top: var(--_inset);
          inset-inline-end: var(--_inset);
          display: grid;
          place-items: center;
          width: 1.25rem;
          height: 1.25rem;
          border: 0;
          padding: 0;
          border-radius: max(
            0rem,
            calc(var(--boxel-form-control-border-radius) - var(--_inset))
          );
          background: none;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        /* the kit's 2px --ring, drawn inside so it stays clear of the
           field's edge; host's global button focus rule reads its offset
           from --host-outline-offset */
        .pretui-searchclear:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
          --host-outline-offset: -2px;
        }
        /* @display 'collapsed': a square the height of the field; the open
           field lies over the row from the square's start */
        .pretui-searchcollapse {
          --_search-h: var(--pretui-field-h, var(--boxel-form-control-height-sm));
          position: relative;
          inline-size: var(--_search-h);
          block-size: var(--_search-h);
          flex: none;
        }
        .pretui-searchtoggle {
          display: grid;
          place-items: center;
          inline-size: 100%;
          block-size: 100%;
          padding: 0;
          border: 1px solid var(--input);
          border-radius: calc(var(--radius) - 0.125rem);
          background-color: var(--field);
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-searchtoggle:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -1px;
        }
        @media (hover: hover) {
          .pretui-searchtoggle:hover:not(:disabled) {
            background-color: var(--hover);
            color: var(--foreground);
          }
        }
        .pretui-searchtoggle:disabled {
          opacity: var(--boxel-disabled-opacity);
          cursor: default;
        }
        .pretui-searchcollapse-field {
          position: absolute;
          inset-block-start: 0;
          inset-inline-start: 0;
          z-index: var(--pretui-z-raised, 1);
          inline-size: var(--pretui-search-open-w, 15rem);
        }
        .pretui-searchclear:hover {
          background-color: var(--hover);
          color: var(--foreground);
        }
      }
    </style>
  </template>
}
