// Pretui — Select: BoxelSelect (ember-power-select) behind Pretui's value API.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';
import { on } from '@ember/modifier';
import SearchIcon from '@cardstack/boxel-icons/search';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { emit, firstDefined } from '../pretui-primitives';
import { POPUPS_IN_PLACE } from '../internal/overlay';
import type { ControlNotifyArgs } from '../pretui-primitives';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectSignature {
  Args: ControlNotifyArgs & {
    options?: SelectOption[];
    /** alias — the collection noun the React contract calls canonical for a
     * flat list. Accepted so `@items` is not a silent empty select. */
    items?: SelectOption[];
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    disabled?: boolean;
    /** adds a search box above the list that takes focus when the list
     * opens and filters options by label. Off by default: typeahead on the
     * trigger covers most lists */
    searchEnabled?: boolean;
    /** the id your `<label for>` points at. The trigger keeps BoxelSelect's
     * own id, so this only finds the label, which then names the trigger
     * through aria-labelledby */
    controlId?: string;
    /** accessible name for the trigger, when there is no label */
    label?: string;
    /** id of an element that names the trigger; preferred over @label when
     * a visible or visually hidden label already exists */
    labelledBy?: string;
    /** alias — React Aria / Base UI spelling of @disabled */
    isDisabled?: boolean;
  };
  Element: HTMLDivElement;
}

// The flagship, rebuilt ON boxel-ui (standing reuse directive): wraps
// BoxelSelect (ember-power-select) for real listbox behavior — keyboard nav,
// scroll-into-view and trigger typeahead — while
// keeping Pretui's public API (value/defaultValue/onValueChange hybrid).
// The dropdown renders in BoxelSelect's wormhole, so no overflow-hidden
// ancestor clips it. BoxelSelect copies its --boxel-dropdown-* knobs from the
// trigger onto the wormhole on every open, and a custom property's computed
// value has its var() references resolved — so setting those knobs to theme
// tokens here carries the theme, dark mode included, onto the dropdown
// without any :deep() rule reaching it.
//
// Type-only cast: the CLI's bundled boxel-ui types import PowerSelectArgs
// from ember-power-select, which the realm type env cannot resolve, so
// BoxelSelect's visible args collapse to options/variant. Re-assert the
// power-select arg surface we actually use; runtime is the real BoxelSelect.
interface PoweredSelectSignature {
  Args: {
    options: SelectOption[];
    selected?: SelectOption;
    onChange: (option: SelectOption | null) => void;
    placeholder?: string;
    disabled?: boolean;
    searchEnabled?: boolean;
    searchField?: string;
    beforeOptionsComponent?: unknown;
    matchTriggerWidth?: boolean;
    dropdownClass?: string;
    renderInPlace?: boolean;
    ariaLabel?: string;
    ariaLabelledBy?: string;
  };
  Blocks: { default: [SelectOption] };
  Element: HTMLElement;
}
const PoweredSelect = BoxelSelect as unknown as new (
  owner: unknown,
  args: PoweredSelectSignature['Args'],
) => Component<PoweredSelectSignature>;

// The trigger is a role='combobox' div, which a <label> does not name, so a
// label pointing at @controlId (or wrapping the Select) is linked through
// aria-labelledby — label first, then the trigger itself, so the chosen
// value is still announced after the name.
const nameFromLabel = modifier(
  (wrap: HTMLElement, [controlId, explicit]: [string | undefined, boolean]) => {
    if (explicit) {
      return;
    }
    let trigger = wrap.querySelector<HTMLElement>(
      '[data-pretui-select-trigger]',
    );
    if (!trigger) {
      return;
    }
    let label =
      (controlId
        ? document.querySelector<HTMLElement>(
            `label[for="${CSS.escape(controlId)}"]`,
          )
        : null) ?? wrap.closest('label');
    if (!label) {
      return;
    }
    if (!label.id) {
      label.id = `${trigger.id}-label`;
    }
    trigger.setAttribute('aria-labelledby', `${label.id} ${trigger.id}`);
  },
);

// The search box ember-power-select renders above the options, with a
// search icon and focus on open. BoxelSelect's own before-options component
// turns autofocus off, which leaves the box reachable by pointer only: from
// the trigger, typing runs typeahead and Tab closes the list.
interface SelectSearchSignature {
  Args: {
    select: {
      searchText: string;
      isOpen: boolean;
      actions: { close: (e?: Event) => void; search: (term: string) => void };
    };
    searchEnabled?: boolean;
    onInput: (e: Event) => unknown;
    onKeydown: (e: Event) => unknown;
    onFocus: (e: Event) => void;
    onBlur: (e: Event) => void;
    listboxId?: string;
    ariaActiveDescendant?: string;
    ariaLabel?: string;
    ariaLabelledBy?: string;
    ariaDescribedBy?: string;
  };
  Element: HTMLDivElement;
}

class SelectSearch extends Component<SelectSearchSignature> {
  handleInput = (e: Event) => {
    this.args.onInput(e);
  };
  handleKeydown = (e: Event) => {
    if (this.args.onKeydown(e) === false) {
      return;
    }
    if (e instanceof KeyboardEvent && e.key === 'Enter') {
      this.args.select.actions.close(e);
    }
  };
  // No positional args, so this runs once per open; the frame delay lets
  // the dropdown finish positioning before focus moves into it.
  focusOnOpen = modifier((el: HTMLInputElement) => {
    let frame = requestAnimationFrame(() => el.focus());
    return () => {
      cancelAnimationFrame(frame);
      this.args.select.actions.search('');
    };
  });

  <template>
    {{#if @searchEnabled}}
      <div
        class='ember-power-select-search pretui-selectsearch'
        data-test-pretui-select-search
        ...attributes
      >
        <SearchIcon
          class='pretui-selectsearch-icon'
          width='16'
          height='16'
          aria-hidden='true'
        />
        {{! template-lint-disable require-input-label }}
        <input
          type='search'
          class='ember-power-select-search-input'
          value={{@select.searchText}}
          placeholder='Search…'
          autocomplete='off'
          autocorrect='off'
          autocapitalize='off'
          spellcheck='false'
          role='combobox'
          aria-activedescendant={{@ariaActiveDescendant}}
          aria-controls={{@listboxId}}
          aria-owns={{@listboxId}}
          aria-autocomplete='list'
          aria-haspopup='listbox'
          aria-expanded={{if @select.isOpen 'true' 'false'}}
          aria-label={{if @ariaLabel @ariaLabel 'Search options'}}
          aria-labelledby={{@ariaLabelledBy}}
          aria-describedby={{@ariaDescribedBy}}
          {{on 'input' this.handleInput}}
          {{on 'keydown' this.handleKeydown}}
          {{on 'focus' @onFocus}}
          {{on 'blur' @onBlur}}
          {{this.focusOnOpen}}
          data-test-pretui-select-search-input
        />
      </div>
    {{/if}}
    <style scoped>
      @layer PretComponent {
        .pretui-selectsearch {
          position: relative;
        }
        .pretui-selectsearch-icon {
          --icon-color: var(--muted-foreground);

          position: absolute;
          /* the box's padding, then the input's */
          inset-inline-start: calc(var(--boxel-sp-xs) + var(--_select-px));
          top: 50%;
          translate: 0 -50%;
          pointer-events: none;
        }
        /* BoxelSelect's dropdown rules set the input's padding; this makes
           room for the icon */
        .pretui-selectsearch .ember-power-select-search-input {
          padding-inline-start: calc(var(--_select-px) + 1rem + var(--boxel-sp-2xs));
          padding-inline-end: var(--_select-px);
        }
      }
    </style>
  </template>
}

export class Select extends Component<SelectSignature> {
  @tracked internal = this.args.defaultValue;
  // True under a Dialog, Drawer, CommandPalette or EditInPlace editor; see
  // POPUPS_IN_PLACE for why the list renders in place there.
  @consume(POPUPS_IN_PLACE) popupsInPlace?: boolean;
  // Options are not focusable, so pressing one would move focus to the page
  // and an editor around the Select would read that as leaving. Keep focus where it is;
  // the option is still chosen on click. The search input still takes focus.
  keepFocusInList = modifier((wrap: HTMLElement) => {
    let onPress = (e: MouseEvent) => {
      let target = e.target as HTMLElement | null;
      if (target?.closest('input')) {
        return;
      }
      if (target?.closest("[role='listbox'], [data-option-index]")) {
        e.preventDefault();
      }
    };
    wrap.addEventListener('mousedown', onPress);
    return () => wrap.removeEventListener('mousedown', onPress);
  });
  get explicitName(): boolean {
    return this.args.label !== undefined || this.args.labelledBy !== undefined;
  }

  get options(): SelectOption[] {
    return firstDefined(this.args.options, this.args.items) ?? [];
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get value() {
    return this.args.value ?? this.internal;
  }
  // power-select selects the option OBJECT; the public API speaks in values
  get selectedOption() {
    return this.options.find((o) => o.value === this.value);
  }
  choose = (option: SelectOption | null) => {
    if (!option) {
      return;
    }
    if (this.args.value === undefined) {
      this.internal = option.value;
    }
    emit([this.args.onValueChange, this.args.onChange], option.value);
  };

  <template>
    <div
      class='pretui-selectwrap'
      {{nameFromLabel @controlId this.explicitName}}
      {{this.keepFocusInList}}
      data-test-pretui-select
      ...attributes
    >
      {{! no id here: BoxelSelect finds the trigger by its own id to copy the
          theme onto the wormhole. A label[for=@controlId] still names it,
          through the aria-labelledby that nameFromLabel sets. }}
      <PoweredSelect
        class='pretui-selecttrigger'
        @options={{this.options}}
        @selected={{this.selectedOption}}
        @onChange={{this.choose}}
        @placeholder={{if @placeholder @placeholder 'Select…'}}
        @disabled={{this.disabled}}
        @searchEnabled={{@searchEnabled}}
        @searchField='label'
        @beforeOptionsComponent={{SelectSearch}}
        @matchTriggerWidth={{true}}
        @dropdownClass='pretui-select-dropdown'
        @renderInPlace={{this.popupsInPlace}}
        @ariaLabel={{@label}}
        @ariaLabelledBy={{@labelledBy}}
        data-pretui-select-trigger
        data-test-pretui-select-trigger
        as |option|
      >
        <span data-test-pretui-select-option>{{option.label}}</span>
      </PoweredSelect>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-selectwrap {
          /* per-instance knob: the trigger's height */
          --pretui-select-h: 1.75rem;

          min-width: 0;
          /* BoxelSelect's knobs, set to theme tokens. The --boxel-dropdown-*
             ones and the radius travel to the wormhole, values resolved. */
          --boxel-form-control-border-radius: calc(var(--radius) - 2px);
          /* the trigger spends its hairline as a box-shadow with border: 0,
             so it pads 1px more than a bordered Input to line its text up */
          --boxel-select-trigger-padding: 0 0.625rem;
          --boxel-select-trigger-gap: var(--boxel-sp-2xs);
          /* one block line, so a long label ends in an ellipsis */
          --boxel-select-trigger-content-display: block;
          --boxel-select-background-color: var(--field);
          /* hover pulls the hairline toward --foreground, so it strengthens
             in both schemes, the way a Button's edge answers the pointer */
          --_select-edge-hover: color-mix(
            in oklch,
            var(--foreground) 30%,
            var(--input)
          );
          --boxel-select-text-color: var(--foreground);
          --boxel-dropdown-background-color: var(--popover);
          --boxel-dropdown-text-color: var(--popover-foreground);
          --boxel-dropdown-border-color: var(--border);
          --boxel-dropdown-hover-color: var(--hover);
          --boxel-dropdown-hover-text-color: var(--popover-foreground);
          /* the selected row is a --primary fill; its text and checkmark
             take --primary-foreground through currentColor. Hovered or
             keyboard-highlighted, it darkens a shade in both schemes, the
             accent Button's hover; a mix toward --foreground would lighten
             it in dark mode instead. */
          --_select-primary-hover: oklch(from var(--primary) calc(l * 0.9) c h);
          --boxel-dropdown-highlight-color: var(--primary);
          --boxel-dropdown-highlight-hover-color: var(--_select-primary-hover);
          --boxel-dropdown-selected-text-color: var(--primary-foreground);
          --boxel-dropdown-selected-highlighted-color: var(--_select-primary-hover);
          --boxel-dropdown-selected-hover-color: var(--_select-primary-hover);
          --boxel-dropdown-focus-border-color: var(--ring);
        }
        /* BoxelSelect has no knobs for the trigger's height and hairline, so
           these reach its trigger, dressed to match Input. */
        .pretui-selectwrap :deep(.pretui-selecttrigger) {
          align-items: center;
          height: var(--pretui-select-h);
          border: 0;
          box-shadow: 0 0 0 1px var(--input);
          width: 100%;
          text-align: start;
          transition: box-shadow var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, ease);
        }
        /* before the expanded and focus rules, which win the tie */
        @media (hover: hover) {
          .pretui-selectwrap :deep(.pretui-selecttrigger:hover) {
            box-shadow: 0 0 0 1px var(--_select-edge-hover);
          }
        }
        .pretui-selectwrap :deep(.pretui-selecttrigger[aria-expanded='true']),
        .pretui-selectwrap :deep(.pretui-selecttrigger:focus-visible) {
          /* forced-colors paints no box-shadow, so a transparent outline keeps
             a focus indicator there */
          outline: 1.5px solid transparent;
          outline-offset: 1px;
          box-shadow: 0 0 0 1.5px var(--ring);
        }
        .pretui-selectwrap :deep(.pretui-selecttrigger[aria-disabled='true']) {
          opacity: 0.45;
          /* BoxelSelect paints disabled on --muted; this rule outranks it, so
             the field surface holds and only the opacity says disabled */
          background-color: var(--field);
          color: var(--foreground);
        }
        /* the trigger's type; the dropdown rule below repeats it, since the
           wormhole is outside this subtree */
        .pretui-selectwrap :deep(.boxel-trigger) {
          width: 100%;
          font-family: inherit;
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .pretui-selectwrap :deep(.boxel-trigger-content) {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-selectwrap :deep(.boxel-trigger-placeholder) {
          color: var(--muted-foreground);
          font-family: inherit;
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .pretui-selectwrap :deep(.pretui-selecttrigger svg) {
          --icon-color: var(--muted-foreground);

          flex: none;
        }
      }
    </style>
    {{! template-lint-disable require-scoped-style }}
    <style>
      @layer PretComponent {
        /* Unscoped: the dropdown renders in the wormhole, outside this
           component's subtree, and BoxelSelect has no knobs for its type or
           row metrics. The options and the search box take the trigger's
           type, inline padding and height. */
        .pretui-select-dropdown.ember-power-select-dropdown {
          /* the trigger's padding and default height, restated: the wrapper's
             knobs do not reach the wormhole */
          --_select-px: 0.625rem;
          --_select-h: 1.75rem;
          /* the list matches the trigger's width as a floor, never a ceiling:
             a trigger sized to a short value must not clip the other labels */
          min-width: max-content;
        }
        .pretui-select-dropdown.ember-power-select-dropdown .boxel-select-option-item,
        .pretui-select-dropdown.ember-power-select-dropdown .ember-power-select-search-input {
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .pretui-select-dropdown.ember-power-select-dropdown .boxel-select-option-item {
          min-height: var(--_select-h);
          padding-block: 0;
          padding-inline: var(--_select-px);
        }
        /* the hairline and ring are shadows, as on the trigger, so focus
           thickens the edge to the trigger's 1.5px instead of stacking a
           shadow on a border */
        .pretui-select-dropdown.ember-power-select-dropdown .ember-power-select-search-input {
          min-height: var(--_select-h);
          padding-block: 0;
          border: 0;
          box-shadow: 0 0 0 1px var(--border);
        }
        .pretui-select-dropdown.ember-power-select-dropdown .ember-power-select-search-input:focus {
          border: 0;
          outline: 1.5px solid transparent;
          outline-offset: 1px;
          box-shadow: 0 0 0 1.5px var(--ring);
        }
        /* iOS zooms into inputs under 16px on focus */
        @media (pointer: coarse) {
          .pretui-select-dropdown.ember-power-select-dropdown .ember-power-select-search-input {
            font-size: var(--boxel-font-size);
          }
        }
      }
    </style>
    {{! template-lint-enable require-scoped-style }}
  </template>
}
