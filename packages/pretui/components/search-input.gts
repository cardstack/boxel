// Pretui — SearchInput: a search field with a clear button.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlAliasArgs } from '../pretui-primitives';

// BoxelInput @type='search' — boxel's search dress (leading magnifier
// icon) re-pointed at the Pretui field tokens via its --boxel-input-
// search-* knobs — plus the clear button boxel-ui doesn't ship: an overlay
// ✕ appears once the field holds text and resets it through @onInput('').
// Wave-0 adaptation (documented): no debounce knob — realm code takes no
// timers; debounce belongs to the consumer's data layer.

const SEARCH_METRICS = htmlSafe(
  'font: inherit; letter-spacing: inherit; line-height: 18px; padding-block: 4px; border-radius: var(--radius); padding-right: 28px;',
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
        @type='search'
        @value={{this.current}}
        @placeholder={{@placeholder}}
        @disabled={{this.disabled}}
        @onInput={{this.handleInput}}
        id={{@controlId}}
        style={{SEARCH_METRICS}}
      />
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
      /* EmailInput channel + boxel's search-specific knobs: the dark host
         pill re-dresses as the Pretui field face, magnifier in quiet ink. */
      .pretui-boxelwrap {
        position: relative;
        width: 100%;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        --background: var(--field, var(--boxel-light));
        --border: var(--input);
        --ring: var(--primary);
        --muted-foreground: var(--ink-3, var(--boxel-400));
        --boxel-input-search-background-color: var(--field, var(--boxel-light));
        --boxel-input-search-color: var(--foreground);
        --boxel-input-search-icon-color: var(--ink-3, var(--boxel-400));
        --boxel-icon-sm: 14px;
        --boxel-sp-xxl: 30px;
        --boxel-form-control-height: var(--control-h, 28px);
        --boxel-input-height: var(--control-h, 28px);
        --boxel-form-control-border-radius: var(--radius);
        --boxel-sp-xs: 5px;
        --boxel-sp-sm: 9px;
      }
      .pretui-searchclear {
        position: absolute;
        top: calc((var(--control-h, 28px) - 20px) / 2);
        right: 5px;
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border: 0;
        padding: 0;
        border-radius: 6px;
        background: none;
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .pretui-searchclear:hover {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
    </style>
  </template>
}
