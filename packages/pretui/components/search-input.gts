// Pretui — SearchInput: a search field with a clear button.
import Component from '@glimmer/component';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
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
import { Popup } from '../components/popup';
import { FieldDress } from '../internal/field-dress';

// A BoxelInput in Input's field style with the kit's own magnifier, plus the
// clear button boxel-ui doesn't ship: an overlay ✕ appears once the field
// holds text and resets it through @onInput(''). Wave-0 adaptation
// (documented): no debounce knob — realm code takes no timers; debounce
// belongs to the consumer's data layer.

const SEARCH_METRICS = htmlSafe(
  `${TYPED_BLOCK_RULES} ${SEARCH_START_PADDING} padding-inline-end: 1.75rem;`,
);

interface SearchFieldSignature {
  Args: {
    value: string;
    placeholder?: string;
    disabled?: boolean;
    controlId?: string;
    showClear: boolean;
    onInput: (value: string) => void;
    onClear: (event: Event) => void;
  };
  Element: HTMLDivElement;
}

// the field both displays share; the input is named from the placeholder
// unless the caller labels it through @controlId
const SearchField: TemplateOnlyComponent<SearchFieldSignature> = <template>
  <FieldDress data-filled={{if @showClear 'true'}} ...attributes>
    <BoxelInput
      @value={{@value}}
      @placeholder={{@placeholder}}
      @disabled={{@disabled}}
      @onInput={{@onInput}}
      id={{@controlId}}
      aria-label={{unless @controlId (if @placeholder @placeholder 'Search')}}
      style={{SEARCH_METRICS}}
    />
    <SearchGlyph @dimmed={{@disabled}} />
    {{#if @showClear}}
      <button
        type='button'
        class='pretui-searchclear'
        aria-label='Clear search'
        data-test-pretui-search-clear
        {{on 'click' @onClear}}
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
        /* a 24px target around the 20px glyph box (WCAG 2.5.8) */
        .pretui-searchclear::before {
          content: '';
          position: absolute;
          inset: -0.125rem;
        }
        .pretui-searchclear:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
          --host-outline-offset: -2px;
        }
        @media (hover: hover) {
          .pretui-searchclear:hover {
            background-color: var(--hover);
            color: var(--foreground);
          }
        }
      }
    </style>
</template>;

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
     * click; Escape or leaving it closes it again */
    display?: 'field' | 'collapsed';
  };
  Element: HTMLDivElement;
}

export class SearchInput extends Component<SearchInputSignature> {
  @tracked internal = this.args.value ?? '';
  @tracked open = false;
  // where the open field lies over the square, read from the square on open
  @tracked openPlacement = 'right-start';
  @tracked openDistance = 0;

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
  expand = (event: Event) => {
    // a second activation inside one render would write open twice, an
    // autotracking error
    if (this.open || this.disabled) {
      return;
    }
    let square = event.currentTarget as HTMLElement;
    // the panel is placed beside the square, pulled back by the square's own
    // width so the field starts over it; toward the inline end, so RTL opens
    // leftward, and Popup flips it to the other side when that end has no room
    this.openPlacement =
      getComputedStyle(square).direction === 'rtl' ? 'left-start' : 'right-start';
    this.openDistance = -square.getBoundingClientRect().width;
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
    // keep an enclosing dialog or card from also closing on this Escape
    event.stopPropagation();
    let root = (event.currentTarget as HTMLElement).closest(
      '[data-pretui-search-collapsible]',
    );
    this.open = false;
    // the button renders in the same frame the field leaves
    requestAnimationFrame(() => {
      root?.querySelector<HTMLElement>('[data-pretui-search-toggle]')?.focus();
    });
  };
  private closeOnLeave = (event: FocusEvent) => {
    let root = event.currentTarget as HTMLElement;
    // Deferred: unmounting the toggle fires focusout while the field is still
    // rendering, and tracked state can't change inside that render. By the
    // microtask focusOnOpen has moved focus into the field. Safari and Firefox
    // on macOS don't focus a button on mouse press, so activeElement is body
    // while the pointer is down on the clear button; :active covers that.
    queueMicrotask(() => {
      if (!root.contains(document.activeElement) && !root.matches(':active')) {
        this.open = false;
      }
    });
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
        {{! the open field is a Popup panel (position: fixed), so the clip of
            an enclosing LayoutControl can't cut it or its clear button; the
            anchor keeps the square's size while the toggle is swapped out }}
        <Popup
          class='pretui-searchcollapse-anchor'
          @open={{this.open}}
          @placement={{this.openPlacement}}
          @distance={{this.openDistance}}
        >
          <:anchor>
            {{#unless this.open}}
              {{! a raw button, not Button: the square is the field's own face
                  (--field, --input), which Button's variants don't draw }}
              <button
                type='button'
                class='pretui-searchtoggle'
                id={{@controlId}}
                aria-label={{unless @controlId this.collapsedName}}
                title={{this.collapsedName}}
                disabled={{this.disabled}}
                data-pretui-search-toggle
                {{on 'click' this.expand}}
                data-test-pretui-search-toggle
              >
                <SearchIcon width='14' height='14' aria-hidden='true' />
              </button>
            {{/unless}}
          </:anchor>
          <:default>
            <SearchField
              class='pretui-searchcollapse-field'
              @value={{this.current}}
              @placeholder={{@placeholder}}
              @disabled={{this.disabled}}
              @onInput={{this.handleInput}}
              @controlId={{@controlId}}
              @showClear={{this.showClear}}
              @onClear={{this.clear}}
              {{this.focusOnOpen}}
            />
          </:default>
        </Popup>
      </div>
    {{else}}
      <SearchField
        @value={{this.current}}
        @placeholder={{@placeholder}}
        @disabled={{this.disabled}}
        @onInput={{this.handleInput}}
        @controlId={{@controlId}}
        @showClear={{this.showClear}}
        @onClear={{this.clear}}
        data-test-pretui-search-input
        ...attributes
      />
    {{/if}}
    <style scoped>
      @layer PretComponent {
        /* @display 'collapsed': a square the height of the field; the open
           field lies over the square from its start, in a fixed Popup panel */
        .pretui-searchcollapse {
          --_search-h: var(
            --pretui-field-h,
            var(--boxel-form-control-height-sm)
          );
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
        .pretui-searchcollapse-anchor {
          display: block;
          inline-size: 100%;
          block-size: 100%;
        }
        /* capped to the viewport, so Popup can always shift it on screen */
        .pretui-searchcollapse-field {
          inline-size: var(--pretui-search-open-w, 15rem);
          max-inline-size: calc(100vw - 1rem);
        }
      }
    </style>
  </template>
}
