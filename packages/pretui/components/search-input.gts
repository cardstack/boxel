// Pretui — SearchInput: a search field with a clear button.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
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
  };
  Element: HTMLDivElement;
}

export class SearchInput extends Component<SearchInputSignature> {
  @tracked internal = this.args.value ?? '';

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
  clear = (_e: Event) => {
    this.internal = '';
    this.notify('');
  };
  <template>
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
        .pretui-searchclear:hover {
          background-color: var(--hover);
          color: var(--foreground);
        }
      }
    </style>
  </template>
}
