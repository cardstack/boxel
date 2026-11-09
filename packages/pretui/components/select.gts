// Pretui — Select: BoxelSelect (ember-power-select) behind Pretui's value API.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { guidFor } from '@ember/object/internals';
import { consume } from 'ember-provide-consume-context';
import { on } from '@ember/modifier';
import { schedule } from '@ember/runloop';
import SearchIcon from '@cardstack/boxel-icons/search';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { emit, firstDefined } from '../pretui-primitives';
import { POPUPS_IN_PLACE } from '../internal/overlay';
import type { ControlNotifyArgs } from '../pretui-primitives';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type { ComponentLike } from '@glint/template';

export interface SelectOption {
  value: string;
  label: string;
  /** a muted second part after the label, on the trigger and in the list —
   * an address that tells two options with the same label apart. The
   * search matches the label alone. */
  meta?: string;
}

export const SELECT_DISPLAYS = ['full', 'icon'] as const;
export type SelectDisplay = (typeof SELECT_DISPLAYS)[number];
type SelectIcon = ComponentLike<{ Element: SVGSVGElement }>;

// The trigger's face under @display 'icon'; the list keeps its labels.
const SelectIconFace: TemplateOnlyComponent<{ Args: { icon: SelectIcon } }> =
  <template>
    <@icon
      width='1.25em'
      height='1.25em'
      aria-hidden='true'
    />
  </template>;

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
    /** 'full' (default) shows the chosen label on the trigger; 'icon' shows
     * @icon alone, with the current value in the trigger's name and title.
     * The list opens unchanged. Needs @icon. */
    display?: SelectDisplay;
    /** the trigger's icon under @display 'icon' */
    icon?: SelectIcon;
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
    onOpen?: (select: SelectApi) => void;
    ariaLabel?: string;
    ariaLabelledBy?: string;
    selectedItemComponent?: unknown;
  };
  Blocks: { default: [SelectOption] };
  Element: HTMLElement;
}
// The part of power-select's public API that Select reads on open.
interface SelectApi {
  uniqueId: string;
  actions: { reposition: () => void };
}

const PoweredSelect = BoxelSelect as unknown as new (
  owner: unknown,
  args: PoweredSelectSignature['Args'],
) => Component<PoweredSelectSignature>;

// The trigger is a role='combobox' div, which a <label> does not name, so a
// label pointing at @controlId (or wrapping the Select) is linked through
// aria-labelledby — label first, then the trigger itself, so the chosen
// value is still announced after the name. An icon face shows no value, so
// there the hidden value span (tailId) follows the label instead.
const nameFromLabel = modifier(
  (
    wrap: HTMLElement,
    [controlId, explicit, tailId]: [string | undefined, boolean, string?],
  ) => {
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
    trigger.setAttribute(
      'aria-labelledby',
      `${label.id} ${tailId ?? trigger.id}`,
    );
  },
);

// The search box ember-power-select renders above the options, with a
// search icon and focus on open. BoxelSelect's own before-options component
// turns autofocus off, which leaves the box reachable by pointer only: from
// the trigger, typing runs typeahead and Tab closes the list.
// The space kept between an open list and the window's edge, in px.
const LIST_WINDOW_MARGIN = 8;

interface SelectSearchSignature {
  Args: {
    select: {
      searchText: string;
      isOpen: boolean;
      actions: {
        close: (e?: Event) => void;
        search: (term: string) => void;
        reposition?: () => void;
      };
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
  // Runs as the list opens, from a marker this template always renders
  // inside it. It gives the list the marker's scope attribute: the list
  // renders outside any template of this module, so without it this
  // module's scoped rules for the list wouldn't reach it. Then, once the list
  // is placed, a list wider than the room right of where it starts is held
  // to that room, so its lines wrap rather than run past the window.
  fitList = modifier((marker: HTMLElement) => {
    let list = marker.closest<HTMLElement>('.ember-power-select-dropdown');
    if (!list) {
      return;
    }
    for (let { name } of [...marker.attributes]) {
      if (name.startsWith('data-scopedcss-')) {
        list.setAttribute(name, '');
      }
    }
    let frame = requestAnimationFrame(() => {
      let { left, right } = list.getBoundingClientRect();
      let edge = document.documentElement.clientWidth - LIST_WINDOW_MARGIN;
      if (left >= LIST_WINDOW_MARGIN && right > edge) {
        let room = `${Math.floor(edge - left)}px`;
        list.style.setProperty('min-width', room);
        list.style.setProperty('max-width', room);
        this.args.select.actions.reposition?.();
      }
    });
    return () => cancelAnimationFrame(frame);
  });

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
    <span class='pretui-selectlist-scope' hidden {{this.fitList}}></span>
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
        /* The list renders in the wormhole, outside Select's subtree, and
           BoxelSelect has no knobs for its type or row metrics. This
           template renders inside the list, and its marker gives the list
           this template's scope attribute, so these are plain scoped rules,
           which every compiler of this module keeps, the realm's included.
           The options take the trigger's type, inline padding and height. */
        .pretui-select-dropdown.ember-power-select-dropdown {
          /* the trigger's padding and default height, restated: the wrapper's
             knobs do not reach the wormhole */
          --_select-px: 0.625rem;
          --_select-h: var(--boxel-form-control-height-sm);
          /* the list matches the trigger's width as a floor, never a ceiling:
             a trigger sized to a short value must not clip the other labels.
             It never runs past the window, though: an option's meta wraps
             on its own line under the label instead. */
          min-width: max-content;
          max-width: calc(100vw - 2 * var(--boxel-sp));
          --boxel-select-option-text-display: block;
        }
        /* in the list, an option's meta sits on a line of its own and wraps,
           since the part that tells two options apart may be at its end */
        .pretui-select-dropdown :deep(.pretui-select-meta) {
          display: block;
          margin-inline-start: 0;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        /* the trigger's type, copied onto the list on each open */
        .pretui-select-dropdown :deep(.boxel-select-option-item) {
          font-size: var(--pretui-select-list-font-size);
          line-height: var(--pretui-select-list-line-height);
          letter-spacing: var(--boxel-lsp-xs);
          min-height: var(--_select-h);
          padding-block: 0;
          padding-inline: var(--_select-px);
        }
        /* the options' rows grow on touch screens, as Autocomplete's do */
        @media (pointer: coarse) {
          .pretui-select-dropdown :deep(.boxel-select-option-item) {
            padding-block: 0.6em;
          }
        }
        .pretui-selectsearch {
          position: relative;
        }
        .pretui-selectsearch-icon {
          color: var(--muted-foreground);
          position: absolute;
          /* the box's padding, then the input's */
          inset-inline-start: calc(var(--boxel-sp-xs) + var(--_select-px));
          top: 50%;
          translate: 0 -50%;
          pointer-events: none;
        }
        /* the trigger's type, its 1px edge, and its 2px focus ring laid
           over it */
        .ember-power-select-search-input {
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
          letter-spacing: var(--boxel-lsp-xs);
          min-height: var(--_select-h);
          padding-block: 0;
          border: 1px solid var(--border);
        }
        .ember-power-select-search-input:focus {
          outline: 2px solid var(--ring);
          outline-offset: -1px;
        }
        /* iOS zooms into inputs under 16px on focus */
        @media (pointer: coarse) {
          .ember-power-select-search-input {
            font-size: var(--boxel-form-control-touch-font-size);
            line-height: var(--boxel-form-control-line-height-sm);
          }
        }
        /* BoxelSelect's dropdown rules set the input's padding; this makes
           room for the icon */
        .pretui-selectsearch .ember-power-select-search-input {
          /* less the box's 1px border */
          padding-inline-start: calc(var(--_select-px) + 1rem + var(--boxel-sp-2xs) - 1px);
          padding-inline-end: calc(var(--_select-px) - 1px);
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
  private wrap: HTMLElement | null = null;
  trackWrap = modifier((wrap: HTMLElement) => {
    this.wrap = wrap;
    return () => {
      this.wrap = null;
    };
  });
  // The options take the trigger's type size. The list renders outside the
  // trigger's subtree, so each open copies the size onto it once it has
  // rendered, before it paints, then repositions it: a list that opened
  // above the trigger would otherwise be left short of it.
  matchListType = (select: SelectApi) => {
    schedule('afterRender', () => {
      let trigger = this.wrap?.querySelector<HTMLElement>(
        '[data-pretui-select-trigger]',
      );
      let list = document.getElementById(
        `ember-basic-dropdown-content-${select.uniqueId}`,
      );
      if (!trigger || !list) {
        return;
      }
      let style = getComputedStyle(trigger);
      for (let name of [
        '--pretui-select-list-font-size',
        '--pretui-select-list-line-height',
      ]) {
        list.style.setProperty(name, style.getPropertyValue(name));
      }
      select.actions.reposition();
    });
  };
  get explicitName(): boolean {
    return (
      this.args.label !== undefined ||
      this.args.labelledBy !== undefined
    );
  }
  get iconFace(): SelectIcon | undefined {
    return this.args.display === 'icon' ? this.args.icon : undefined;
  }
  get iconValue(): string {
    return this.selectedOption?.label ?? this.args.placeholder ?? 'Select…';
  }
  // with no visible value, the name and title say it: 'Region: Europe'
  get iconName(): string | undefined {
    if (!this.iconFace) {
      return undefined;
    }
    return this.args.label
      ? `${this.args.label}: ${this.iconValue}`
      : this.iconValue;
  }
  // The trigger is one line, so a chosen option's meta can end in an
  // ellipsis there; its title, like its name, carries the whole of it.
  get triggerTitle(): string | undefined {
    if (this.iconFace) {
      return this.iconName;
    }
    let chosen = this.selectedOption;
    return chosen?.meta ? `${chosen.label} ${chosen.meta}` : undefined;
  }
  valueId = `${guidFor(this)}-value`;
  // an icon face shows no value, so a caller's label is read with it
  get iconLabelledBy(): string | undefined {
    if (!this.iconFace || !this.args.labelledBy) {
      return this.iconFace ? undefined : this.args.labelledBy;
    }
    return `${this.args.labelledBy} ${this.valueId}`;
  }
  get placeholder() {
    if (this.iconFace) {
      return undefined;
    }
    return this.args.placeholder ? this.args.placeholder : 'Select…';
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
      data-display={{if this.iconFace 'icon'}}
      {{nameFromLabel
        @controlId
        this.explicitName
        (if this.iconFace this.valueId)
      }}
      {{this.keepFocusInList}}
      {{this.trackWrap}}
      data-test-pretui-select
      ...attributes
    >
      {{! no id here: BoxelSelect finds the trigger by its own id to copy the
          theme onto the wormhole. A label[for=@controlId] still names it,
          through the aria-labelledby that nameFromLabel sets. }}
      {{#if this.iconFace}}
        <span id={{this.valueId}} hidden>{{this.iconValue}}</span>
      {{/if}}
      <PoweredSelect
        class='pretui-selecttrigger'
        @options={{this.options}}
        @selected={{this.selectedOption}}
        @onChange={{this.choose}}
        @placeholder={{this.placeholder}}
        @disabled={{this.disabled}}
        @searchEnabled={{@searchEnabled}}
        @searchField='label'
        @beforeOptionsComponent={{SelectSearch}}
        @matchTriggerWidth={{true}}
        @dropdownClass='pretui-select-dropdown'
        @renderInPlace={{this.popupsInPlace}}
        @onOpen={{this.matchListType}}
        @ariaLabel={{if this.iconFace this.iconName @label}}
        @ariaLabelledBy={{this.iconLabelledBy}}
        @selectedItemComponent={{if
          this.iconFace
          (component SelectIconFace icon=this.iconFace)
        }}
        title={{this.triggerTitle}}
        data-pretui-select-trigger
        data-test-pretui-select-trigger
        as |option|
      >
        <span data-test-pretui-select-option>{{option.label}}</span>
        {{#if option.meta}}
          <span
            class='pretui-select-meta'
            data-test-pretui-select-option-meta
          >{{option.meta}}</span>
        {{/if}}
      </PoweredSelect>
    </div>
    <style scoped>
      @layer PretComponent {
        /* the icon and the caret, no wider */
        .pretui-selectwrap[data-display='icon'] {
          inline-size: max-content;
        }
        .pretui-selectwrap {
          min-width: 0;
          /* BoxelSelect's knobs, set to theme tokens. The --boxel-dropdown-*
             ones and the radius travel to the wormhole, values resolved. */
          --boxel-form-control-border-radius: calc(var(--radius) - 0.125rem);
          /* Select's 0.625rem text inset, less the trigger's 1px border */
          --boxel-select-trigger-padding: 0 calc(0.625rem - 1px);
          --boxel-select-trigger-gap: var(--boxel-sp-2xs);
          --boxel-select-trigger-font-size: var(
            --pretui-field-font-size,
            var(--boxel-font-size-xs)
          );
          --boxel-select-trigger-line-height: var(--boxel-line-height-xs);
          --boxel-select-trigger-letter-spacing: var(--boxel-lsp-xs);
          /* the options' type follows the trigger's */
          --pretui-select-list-font-size: var(--boxel-select-trigger-font-size);
          --pretui-select-list-line-height: var(--boxel-select-trigger-line-height);
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
          /* per-instance knob, inherited (LayoutControl sets it); falls back to
             the shared field knob so a row-level --pretui-field-h sizes Select
             with Input and Search */
          height: var(
            --pretui-select-h,
            var(--pretui-field-h, var(--boxel-form-control-height-sm))
          );
          border: 1px solid var(--input);
          width: 100%;
          text-align: start;
          transition: border-color var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, ease);
        }
        /* before the expanded and focus rules, which win the tie */
        @media (hover: hover) {
          .pretui-selectwrap :deep(.pretui-selecttrigger:hover) {
            border-color: var(--_select-edge-hover);
          }
        }
        .pretui-selectwrap :deep(.pretui-selecttrigger[aria-expanded='true']),
        .pretui-selectwrap :deep(.pretui-selecttrigger:focus-visible) {
          outline: 2px solid var(--ring);
          outline-offset: -1px;
        }
        .pretui-selectwrap :deep(.pretui-selecttrigger[aria-disabled='true']) {
          opacity: var(--boxel-disabled-opacity);
          /* BoxelSelect paints disabled on --muted; this rule outranks it, so
             the field surface holds and only the opacity says disabled */
          background-color: var(--field);
          color: var(--foreground);
        }
        .pretui-selectwrap :deep(.boxel-trigger) {
          width: 100%;
        }
        .pretui-selectwrap :deep(.boxel-trigger-content) {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-selectwrap :deep(.boxel-trigger-placeholder) {
          color: var(--muted-foreground);
        }
        .pretui-selectwrap :deep(.pretui-selecttrigger svg) {
          --icon-color: var(--muted-foreground);

          flex: none;
        }
        /* 16px on touch screens, as on Input and Autocomplete, with Input's
           line-height; the trigger's height is fixed, so it doesn't grow */
        @media (pointer: coarse) {
          .pretui-selectwrap {
            --boxel-select-trigger-font-size: var(
              --boxel-form-control-touch-font-size
            );
            --boxel-select-trigger-line-height: var(
              --boxel-form-control-line-height-sm
            );
          }
        }
        /* an option's meta follows its label on the same line, a shade
           quieter; it takes the row's color, so it reads on a highlighted
           row too */
        .pretui-select-meta {
          margin-inline-start: var(--boxel-sp-2xs);
          opacity: 0.7;
        }
      }
    </style>
  </template>
}
