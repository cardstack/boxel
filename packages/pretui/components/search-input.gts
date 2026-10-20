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
    <div
      class='pretui-boxelwrap'
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
    </div>
    <style scoped>
      @layer PretComponent {
        /* Same re-skin channel as EmailInput — see that component's note. */
        .pretui-boxelwrap {
          position: relative;
          width: 100%;
          font-size: var(--boxel-font-size-xs);
          letter-spacing: var(--boxel-lsp-xs);
          --background: var(--field);
          --border: var(--input);
          --boxel-form-control-height: var(--boxel-form-control-height-sm);
          --boxel-input-height: var(--boxel-form-control-height-sm);
          --boxel-form-control-border-radius: calc(var(--radius) - 0.125rem);
          --boxel-sp-xs: var(--boxel-sp-3xs);
          --boxel-sp-sm: calc(0.625rem - 1px);
        }
        /* iOS zooms into inputs under 16px on focus */
        @media (pointer: coarse) {
          .pretui-boxelwrap {
            font-size: var(--boxel-form-control-touch-font-size);
          }
        }
        .pretui-searchclear {
          position: absolute;
          top: calc((var(--boxel-input-height) - 1.25rem) / 2);
          inset-inline-end: var(--boxel-sp-3xs);
          display: grid;
          place-items: center;
          width: 1.25rem;
          height: 1.25rem;
          border: 0;
          padding: 0;
          border-radius: var(--boxel-border-radius-sm);
          background: none;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-searchclear:hover {
          background-color: var(--hover);
          color: var(--foreground);
        }
      }
    </style>
  </template>
}
