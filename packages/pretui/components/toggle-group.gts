// Pretui — ToggleGroup: a set of toggle buttons, single or multiple selection.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { focusWhen, listen, rovingTabindex } from '../focus';
import { iconFor } from '../icon-registry';
import { Button } from './button';
import type { PretuiAppearance, PretuiSize, PretuiTone } from '../pretui-primitives';

// ─────────────────────────────────────────────────────────────────────────
// ToggleGroup
// ─────────────────────────────────────────────────────────────────────────

export interface ToggleOption {
  /** stable identity, and the value reported to the caller */
  value: string;
  /** the visible text, and the accessible name in `@iconOnly` mode */
  label: string;
  /** icon-registry name, drawn before the label */
  icon?: string;
  /** dimmed and inert — but still focusable and announced, per the kit's
   * `aria-disabled` law: removing a member from the tab order changes the
   * group's shape between visits, so it can never be learned */
  disabled?: boolean;
}

export interface ToggleGroupSignature {
  Args: {
    options: ToggleOption[];
    /**
     * The group's accessible name — **required**, not optional. The two
     * sources this replaces (`recurring-pattern`'s weekday row and
     * `tag-filter-group`) both shipped an unnamed pile of buttons; a group
     * whose name is optional is a group that is usually unnamed.
     */
    label: string;
    /**
     * Switches the whole ARIA contract, not just the arithmetic:
     *
     * | | single (default) | multiple |
     * |---|---|---|
     * | group role | `radiogroup` | `toolbar` |
     * | item role | `radio` + `aria-checked` | button + `aria-pressed` |
     * | arrows | move **and** choose | move only; Space/Enter toggles |
     *
     * This is React Aria's `useToggleButtonGroup` split, and it is the right
     * one: with one legal answer the arrows are the choice, and with many the
     * arrows cannot be, or a reader could never travel past an option without
     * turning it on.
     */
    multiple?: boolean;
    /** controlled single value; `null` is an explicit empty selection */
    value?: string | null;
    /** uncontrolled seed for the single value */
    defaultValue?: string;
    /** fires with the chosen value, or `undefined` when the group is cleared */
    onValueChange?: (value: string | undefined) => void;
    /** controlled multi-select values */
    values?: readonly string[];
    /** uncontrolled seed for the multi-select values */
    defaultValues?: readonly string[];
    /** fires with the full next selection, in `@options` order */
    onValuesChange?: (values: string[]) => void;
    /** arrow axis and visual flow (default `horizontal`) */
    orientation?: 'horizontal' | 'vertical';
    /**
     * Single-select only: re-activating the chosen option clears the group
     * (default `true`). This is the line between a ToggleGroup and a
     * `RadioGroup` — "left / centre / right, or none" is a toggle group;
     * "one of these must be true" is a radio group.
     */
    deselectable?: boolean;
    /** hue for every member, default `neutral` */
    tone?: PretuiTone;
    /** recipe worn at rest, default `outlined` */
    appearance?: PretuiAppearance;
    /** recipe worn while pressed, default `accent`. The pressed state is an
     * appearance swap rather than a tint, so it reads in greyscale. */
    pressedAppearance?: PretuiAppearance;
    /** size scale, default `m` */
    size?: PretuiSize;
    /** icons only; every label becomes its item's `sr-only` name and its
     * `title`. For formatting bars, where a word would not fit. */
    iconOnly?: boolean;
    /** let a long horizontal group wrap onto more lines rather than overflow */
    wrap?: boolean;
    /** dims and inerts the whole group */
    disabled?: boolean;
  };
  Blocks: {
    /** replaces the built-in "no options" line */
    empty: [];
  };
  Element: HTMLDivElement;
}

// **From:** `fields/recurring-pattern` (the weekday row) and
// `catalog-app/components/tag-filter-group.gts`.
//
// **Better than the inspiration.** Neither source had `aria-pressed` or
// `aria-checked` — selection was `@variant='primary'`, i.e. colour, inside no
// group at all: the weekday row announced as seven unrelated buttons with no
// name and no relationship. Both were also every-item-a-tab-stop with no
// arrow keys. `tag-filter-group`'s active chip painted `--boxel-dark`, a
// fixed-polarity token that inverts wrongly the moment a dark theme loads;
// here the pressed face is an Appendix-E appearance recipe over the tone
// channel, so it re-tints with a season it has never seen. Zero options used
// to render as silence — it now says so, and yields `:empty` for a caller who
// wants an `EmptyState` in that space. `:deep(.atom-format)` reaching into a
// child's chrome is gone: the only thing crossing the `Button` boundary here
// is inherited custom properties, which is what they are for.
export class ToggleGroup extends Component<ToggleGroupSignature> {
  @tracked private internalValue: string | undefined =
    this.args.defaultValue;
  @tracked private internalValues: string[] = [
    ...(this.args.defaultValues ?? []),
  ];
  /** the member holding the group's single tab stop */
  @tracked private focusIndex: number | undefined;
  /** true only while the keyboard is driving, so `focusWhen` never steals
   * focus on first paint or on a plain re-render */
  @tracked private navigating = false;

  get orientation(): 'horizontal' | 'vertical' {
    return this.args.orientation ?? 'horizontal';
  }
  get options(): ToggleOption[] {
    return this.args.options ?? [];
  }
  get hasOptions(): boolean {
    return this.options.length > 0;
  }
  get isMultiple(): boolean {
    return this.args.multiple ?? false;
  }
  get deselectable(): boolean {
    return this.args.deselectable ?? true;
  }
  get restAppearance(): PretuiAppearance {
    return this.args.appearance ?? 'outlined';
  }
  get pressedAppearance(): PretuiAppearance {
    return this.args.pressedAppearance ?? 'accent';
  }
  get tone(): PretuiTone {
    return this.args.tone ?? 'neutral';
  }

  get selected(): string | undefined {
    let controlled = this.args.value;
    if (controlled !== undefined) {
      return controlled ?? undefined;
    }
    return this.internalValue;
  }
  get selectedMany(): readonly string[] {
    return this.args.values ?? this.internalValues;
  }

  isActive = (option: ToggleOption): boolean =>
    this.isMultiple
      ? this.selectedMany.includes(option.value)
      : this.selected === option.value;
  isOff = (option: ToggleOption): boolean =>
    Boolean(option.disabled || this.args.disabled);
  appearanceFor = (option: ToggleOption): PretuiAppearance =>
    this.isActive(option) ? this.pressedAppearance : this.restAppearance;
  // typed `any` by the registry itself (icon-registry.gts)
  iconOf = (option: ToggleOption) => iconFor(option.icon);
  pressedAttr = (option: ToggleOption): string | undefined =>
    this.isMultiple ? (this.isActive(option) ? 'true' : 'false') : undefined;
  checkedAttr = (option: ToggleOption): string | undefined =>
    this.isMultiple ? undefined : this.isActive(option) ? 'true' : 'false';

  /** indices that can take focus — a disabled member is skipped by the
   * arrows but stays in the DOM and stays announced */
  get navigable(): number[] {
    let out: number[] = [];
    this.options.forEach((option, index) => {
      if (!this.isOff(option)) {
        out.push(index);
      }
    });
    return out;
  }
  /** The single tab stop: wherever the reader last was, else the pressed
   * member (APG's rule for a radiogroup), else the first reachable one. */
  get rovingIndex(): number {
    let order = this.navigable;
    let current = this.focusIndex;
    if (current !== undefined && order.includes(current)) {
      return current;
    }
    let active = order.find((index) => this.isActive(this.options[index]));
    return active ?? order[0] ?? 0;
  }
  isRoving = (index: number): boolean => index === this.rovingIndex;
  isFocusTarget = (index: number): boolean =>
    this.navigating && index === this.rovingIndex;

  private commitSingle(next: string | undefined) {
    if (this.args.value === undefined) {
      this.internalValue = next;
    }
    this.args.onValueChange?.(next);
  }
  private commitMany(next: string[]) {
    if (this.args.values === undefined) {
      this.internalValues = next;
    }
    this.args.onValuesChange?.(next);
  }

  activate = (option: ToggleOption, index: number) => {
    if (this.isOff(option)) {
      return;
    }
    // the pointer already moved focus — do not let focusWhen fire again
    this.navigating = false;
    this.focusIndex = index;
    if (this.isMultiple) {
      let wasOn = this.selectedMany.includes(option.value);
      // rebuilt in @options order, so the callback never depends on the
      // order the reader happened to click in
      let next = this.options
        .filter((candidate) =>
          candidate.value === option.value
            ? !wasOn
            : this.selectedMany.includes(candidate.value),
        )
        .map((candidate) => candidate.value);
      this.commitMany(next);
      return;
    }
    if (this.selected === option.value) {
      if (this.deselectable) {
        this.commitSingle(undefined);
      }
      return;
    }
    this.commitSingle(option.value);
  };

  private moveTo(index: number) {
    this.navigating = true;
    this.focusIndex = index;
    // radiogroup: travelling IS choosing (APG). toolbar: focus only, because
    // with several legal answers a reader must be able to pass an option by.
    if (!this.isMultiple) {
      let option = this.options[index];
      if (option) {
        this.commitSingle(option.value);
      }
    }
  }

  onKeydown = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (ev.altKey || ev.metaKey || ev.ctrlKey) {
      return;
    }
    let order = this.navigable;
    if (!order.length) {
      return;
    }
    let here = order.indexOf(this.rovingIndex);
    let at = here < 0 ? 0 : here;
    let sideways = this.orientation === 'horizontal';
    let key = ev.key;
    let step: number | undefined;
    if (key === (sideways ? 'ArrowRight' : 'ArrowDown')) {
      step = at + 1;
    } else if (key === (sideways ? 'ArrowLeft' : 'ArrowUp')) {
      step = at - 1;
    } else if (key === 'Home') {
      step = 0;
    } else if (key === 'End') {
      step = order.length - 1;
    }
    if (step === undefined) {
      return;
    }
    ev.preventDefault();
    // both patterns wrap: a toolbar and a radiogroup are rings, not lines
    let wrapped = (step + order.length) % order.length;
    this.moveTo(order[wrapped]);
  };

  // Keeps the tab stop where the reader left it, including after tabbing in
  // from elsewhere. The early return is load-bearing: `focusWhen`'s
  // `el.focus()` dispatches `focusin` synchronously inside the render
  // transaction, and writing tracked state there is a backtracking re-render.
  onFocusIn = (event: Event) => {
    let target = event.target as HTMLElement | null;
    let member = target?.closest('[data-tg-index]') as HTMLElement | null;
    if (!member) {
      return;
    }
    let index = Number(member.dataset.tgIndex);
    if (Number.isNaN(index) || index === this.rovingIndex) {
      return;
    }
    this.navigating = false;
    this.focusIndex = index;
  };

  <template>
    <div
      class='pretui-tg'
      role={{if @multiple 'toolbar' 'radiogroup'}}
      aria-label={{@label}}
      aria-orientation={{this.orientation}}
      aria-disabled={{if @disabled 'true'}}
      data-orientation={{this.orientation}}
      data-mode={{if @multiple 'multiple' 'single'}}
      data-icon-only={{if @iconOnly 'true'}}
      data-wrap={{if @wrap 'true'}}
      data-test-pretui-toggle-group
      ...attributes
      {{listen 'keydown' this.onKeydown}}
      {{listen 'focusin' this.onFocusIn}}
    >
      {{#if this.hasOptions}}
        {{#each this.options key='value' as |option index|}}
          <Button
            class='pretui-tg-item'
            @tone={{this.tone}}
            @appearance={{this.appearanceFor option}}
            @size={{@size}}
            role={{unless @multiple 'radio'}}
            aria-pressed={{this.pressedAttr option}}
            aria-checked={{this.checkedAttr option}}
            aria-disabled={{if (this.isOff option) 'true'}}
            title={{if @iconOnly option.label}}
            data-tg-index={{index}}
            data-state={{if (this.isActive option) 'active'}}
            data-test-pretui-toggle-item={{option.value}}
            {{rovingTabindex (this.isRoving index)}}
            {{focusWhen (this.isFocusTarget index)}}
            {{on 'click' (fn this.activate option index)}}
          >
            {{!-- Button wraps its yield in one label span, so the glyph and
                  the text need a flex face of their own to sit on. --}}
            <span class='pretui-tg-face'>
              {{#let (this.iconOf option) as |Glyph|}}
                {{#if Glyph}}
                  <Glyph class='pretui-tg-icon' role='presentation' />
                {{/if}}
              {{/let}}
              {{#if @iconOnly}}
                <span class='pretui-tg-sr'>{{option.label}}</span>
              {{else}}
                <span class='pretui-tg-text'>{{option.label}}</span>
              {{/if}}
            </span>
          </Button>
        {{/each}}
      {{else}}
        {{#if (has-block 'empty')}}
          {{yield to='empty'}}
        {{else}}
          <p class='pretui-tg-none' data-test-pretui-toggle-group-empty>
            No options
          </p>
        {{/if}}
      {{/if}}
    </div>
    <style scoped>
      /* above Button's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        .pretui-tg {
          display: inline-flex;
          align-items: center;
          gap: var(--pretui-togglegroup-gap, 4px);
        }
        .pretui-tg[data-orientation='vertical'] {
          flex-direction: column;
          align-items: stretch;
        }
        .pretui-tg[data-wrap='true'] {
          flex-wrap: wrap;
        }
        /* Icon-only squares the members through the token channel rather than
           a rule that would have to out-specify Button's own padding: at the
           m size a 1.14em glyph plus 2 × 0.55em padding lands on 2.24em, which
           IS the control height. */
        .pretui-tg[data-icon-only='true'] {
          --pretui-button-px: 0.55em;
        }
        .pretui-tg-item {
          flex: none;
        }
        .pretui-tg-face {
          display: inline-flex;
          align-items: center;
          gap: 0.4em;
          min-width: 0;
        }
        .pretui-tg-icon {
          width: 1.14em;
          height: 1.14em;
          flex: none;
        }
        .pretui-tg-text {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-tg-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
        .pretui-tg-none {
          margin: 0;
          font-size: var(--text-ui-sm, 11.5px);
          font-style: italic;
          color: var(--muted-foreground);
        }
        /* Coarse pointers get a real hit target without moving the fine one.
           Height is Button's own token, so this never fights its cascade. */
        @media (any-pointer: coarse) {
          .pretui-tg {
            --pretui-button-h: 2.75em;
            gap: var(--pretui-togglegroup-gap, 6px);
          }
        }
      }
    </style>
  </template>
}
