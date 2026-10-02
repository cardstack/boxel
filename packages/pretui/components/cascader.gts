// Pretui — Cascader: pick one path through a hierarchy — Continent / Country / City — as one value.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { focusWhen, listenDocument } from '../focus';

export interface CascaderOption {
  value: string;
  label: string;
  children?: CascaderOption[];
  disabled?: boolean;
}

export interface CascaderSignature {
  Args: {
    options: CascaderOption[];
    /** Controlled path of values, root first. Omit for uncontrolled. */
    value?: string[];
    defaultValue?: string[];
    /** Fires with the committed path and its labels. */
    onChange?: (path: string[], labels: string[]) => void;
    /** Commit a path that ends on a branch, not only on a leaf. */
    changeOnSelect?: boolean;
    /** The trigger's accessible name prefix and the columns' label. */
    label?: string;
    placeholder?: string;
    /** Between the labels in the trigger (default ' / '). */
    separator?: string;
    disabled?: boolean;
  };
  Element: HTMLDivElement;
}

interface Column {
  level: number;
  /** The parent option's label, which names the column; the first column takes @label. */
  label: string | undefined;
  options: {
    option: CascaderOption;
    id: string;
    active: boolean;
    branch: boolean;
    focused: boolean;
    level: number;
  }[];
}

/** The option objects along `path`, root first; stops at the first miss. */
function walk(options: CascaderOption[], path: string[]): CascaderOption[] {
  let out: CascaderOption[] = [];
  let level = options;
  for (let value of path) {
    let hit = level.find((o) => o.value === value);
    if (!hit) {
      break;
    }
    out.push(hit);
    level = hit.children ?? [];
  }
  return out;
}

/**
 * One value, a path: `['asia', 'japan', 'kyoto']`, shown as
 * "Asia / Japan / Kyoto". Tree browses a hierarchy without a value;
 * TreeSelect collects a checked set. Cascader is the enterprise form field
 * Ant made standard.
 *
 * The popup is one column per level, each a listbox. The keyboard moves
 * the way the columns read: ArrowUp / ArrowDown within a column, ArrowRight
 * or Enter into a branch, ArrowLeft back out, Enter on a leaf to commit,
 * Escape to close. Focus lands on the committed path's deepest option when
 * it opens, and returns to the trigger when it closes.
 */
export class Cascader extends Component<CascaderSignature> {
  private guid = guidFor(this);
  @tracked private internal: string[] = [...(this.args.defaultValue ?? [])];
  @tracked open = false;
  /** The path being browsed in the popup, root first. */
  @tracked activePath: string[] = [];
  /** Which column has keyboard focus. */
  @tracked focusLevel = 0;

  get value(): string[] {
    return this.args.value ?? this.internal;
  }
  get separator(): string {
    return this.args.separator ?? ' / ';
  }
  get committedLabels(): string[] {
    return walk(this.args.options ?? [], this.value).map((o) => o.label);
  }
  get display(): string {
    return this.committedLabels.join(this.separator);
  }
  get triggerName(): string {
    let label = this.args.label ?? 'Choose';
    return this.display ? `${label}: ${this.display}` : label;
  }
  get popupId(): string {
    return this.guid + '-popup';
  }
  optionId(level: number, value: string): string {
    return `${this.guid}-l${level}-${value}`;
  }

  get columns(): Column[] {
    let cols: Column[] = [];
    let level: CascaderOption[] | undefined = this.args.options ?? [];
    let depth = 0;
    while (level && level.length) {
      let activeValue = this.activePath[depth];
      let current = depth;
      let parentLabel = depth === 0 ? undefined : walk(this.args.options ?? [], this.activePath.slice(0, depth))[depth - 1]?.label;
      cols.push({
        level: current,
        label: parentLabel,
        options: level.map((option) => ({
          option,
          id: this.optionId(current, option.value),
          active: option.value === activeValue,
          branch: (option.children?.length ?? 0) > 0,
          focused: this.open && current === this.focusLevel && option.value === this.focusValue(current, level ?? []),
          level: current,
        })),
      });
      let next: CascaderOption | undefined = level.find((o) => o.value === activeValue);
      level = next?.children;
      depth++;
    }
    return cols;
  }

  /** The option in `level` that holds focus: the active one, else the first enabled. */
  private focusValue(depth: number, options: CascaderOption[]): string | undefined {
    return this.activePath[depth] ?? options.find((o) => !o.disabled)?.value;
  }

  private levelOptions(depth: number): CascaderOption[] {
    if (depth === 0) {
      return this.args.options ?? [];
    }
    let parent = walk(this.args.options ?? [], this.activePath.slice(0, depth))[depth - 1];
    return parent?.children ?? [];
  }

  private commit(path: string[], close: boolean) {
    let labels = walk(this.args.options ?? [], path).map((o) => o.label);
    if (this.args.value === undefined) {
      this.internal = path;
    }
    this.args.onChange?.(path, labels);
    if (close) {
      this.close(true);
    }
  }

  toggle = () => {
    if (this.open) {
      this.close(false);
      return;
    }
    // open on the part of the value that still resolves; a stale tail would
    // leave no option focusable
    let hit = walk(this.args.options ?? [], this.value).map((o) => o.value);
    this.activePath = hit;
    this.focusLevel = Math.max(0, hit.length - 1);
    this.open = true;
  };

  close(returnFocus: boolean) {
    this.open = false;
    if (returnFocus) {
      document.getElementById(this.guid + '-trigger')?.focus();
    }
  }

  /** Make `option` at `depth` the active one; returns its path. */
  private activate(depth: number, option: CascaderOption): string[] {
    let path = [...this.activePath.slice(0, depth), option.value];
    this.activePath = path;
    return path;
  }

  choose = (depth: number, option: CascaderOption) => {
    if (option.disabled) {
      return;
    }
    let path = this.activate(depth, option);
    if (option.children?.length) {
      this.focusLevel = depth;
      if (this.args.changeOnSelect) {
        this.commit(path, false);
      }
      return;
    }
    this.commit(path, true);
  };

  onKeydown = (rawEvent: Event) => {
    let event = rawEvent as KeyboardEvent;
    let depth = this.focusLevel;
    let options = this.levelOptions(depth).filter((o) => !o.disabled);
    let currentValue = this.focusValue(depth, this.levelOptions(depth));
    let at = options.findIndex((o) => o.value === currentValue);
    let current = options[at];
    let handled = true;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      let step = event.key === 'ArrowDown' ? 1 : -1;
      let next = options[(at + step + options.length) % options.length];
      if (next) {
        this.activate(depth, next);
      }
    } else if (event.key === 'ArrowRight' || (event.key === 'Enter' && current?.children?.length)) {
      if (current?.children?.length) {
        let path = this.activate(depth, current);
        if (event.key === 'Enter' && this.args.changeOnSelect) {
          this.commit(path, false);
        }
        let first = current.children.find((o) => !o.disabled);
        if (first) {
          this.activePath = [...path, first.value];
          this.focusLevel = depth + 1;
        }
      }
    } else if (event.key === 'ArrowLeft') {
      if (depth > 0) {
        this.activePath = this.activePath.slice(0, depth);
        this.focusLevel = depth - 1;
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      // a branch commits only with @changeOnSelect; otherwise Space opens it like Enter
      if (current?.children?.length) {
        let path = this.activate(depth, current);
        if (this.args.changeOnSelect) {
          this.commit(path, false);
        }
        let first = current.children.find((o) => !o.disabled);
        if (first) {
          this.activePath = [...path, first.value];
          this.focusLevel = depth + 1;
        }
      } else if (current) {
        this.commit(this.activate(depth, current), true);
      }
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      this.close(true);
    } else if (event.key === 'Tab') {
      this.close(false);
      handled = false;
    } else {
      handled = false;
    }
    if (handled) {
      event.preventDefault();
    }
  };

  onOutside = (event: Event) => {
    if (!this.open) {
      return;
    }
    let target = event.target as Node | null;
    let root = target?.ownerDocument?.getElementById(this.guid);
    if (root && target && root.contains(target)) {
      return;
    }
    this.close(false);
  };

  <template>
    <div id={{this.guid}} class='pretui-cascader' data-open={{if this.open 'true' 'false'}} data-test-pretui-cascader ...attributes>
      <button
        id='{{this.guid}}-trigger'
        type='button'
        class='pretui-cascader-trigger'
        aria-haspopup='listbox'
        aria-expanded={{if this.open 'true' 'false'}}
        aria-controls={{if this.open this.popupId}}
        aria-label={{this.triggerName}}
        disabled={{@disabled}}
        data-test-pretui-cascader-trigger
        {{on 'click' this.toggle}}
      >
        {{#if this.display}}
          <span class='pretui-cascader-value' data-test-pretui-cascader-value>{{this.display}}</span>
        {{else}}
          <span class='pretui-cascader-placeholder'>{{if @placeholder @placeholder 'Select'}}</span>
        {{/if}}
        <span class='pretui-cascader-caret' aria-hidden='true'></span>
      </button>
      {{#if this.open}}
        {{! template-lint-disable no-invalid-interactive }}
        <div
          id={{this.popupId}}
          class='pretui-cascader-popup'
          data-test-pretui-cascader-popup
          {{on 'keydown' this.onKeydown}}
          {{listenDocument 'pointerdown' this.onOutside true}}
        >
          {{#each this.columns key='level' as |col|}}
            <ul class='pretui-cascader-col' role='listbox' aria-label={{if col.label col.label (if @label @label 'Options')}} data-test-pretui-cascader-col={{col.level}}>
              {{#each col.options key='id' as |opt|}}
                <li
                  id={{opt.id}}
                  class='pretui-cascader-option'
                  role='option'
                  tabindex={{if opt.focused '0' '-1'}}
                  aria-selected={{if opt.active 'true' 'false'}}
                  aria-disabled={{if opt.option.disabled 'true'}}
                  data-branch={{if opt.branch 'true' 'false'}}
                  data-test-pretui-cascader-option={{opt.option.value}}
                  {{focusWhen opt.focused}}
                  {{on 'click' (fn this.choose opt.level opt.option)}}
                >
                  <span class='pretui-cascader-label'>{{opt.option.label}}</span>
                  {{#if opt.branch}}<span class='pretui-cascader-more' aria-hidden='true'>›</span>{{/if}}
                </li>
              {{/each}}
            </ul>
          {{/each}}
        </div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-cascader {
          position: relative;
          display: inline-block;
          min-inline-size: 12rem;
          font-family: var(--font-sans);
          font-size: var(--text-ui-md, 0.78rem);
        }
        .pretui-cascader-trigger {
          display: flex;
          align-items: center;
          gap: var(--space-2, 0.375rem);
          inline-size: 100%;
          min-block-size: var(--pretui-control-h, 2.25rem);
          padding-inline: var(--space-3, 0.5rem);
          border: 0;
          border-radius: var(--radius-control, 6px);
          background: var(--input-background, var(--card));
          box-shadow: 0 0 0 1px var(--input, var(--border));
          color: var(--foreground);
          font: inherit;
          text-align: start;
          cursor: pointer;
        }
        .pretui-cascader-trigger:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-cascader-trigger:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .pretui-cascader-value {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .pretui-cascader-placeholder {
          flex: 1;
          color: var(--muted-foreground);
        }
        .pretui-cascader-caret {
          inline-size: 0.4rem;
          block-size: 0.4rem;
          border-inline-end: 1.5px solid var(--muted-foreground);
          border-block-end: 1.5px solid var(--muted-foreground);
          rotate: 45deg;
          translate: 0 -0.1rem;
        }
        .pretui-cascader-popup {
          position: absolute;
          inset-block-start: calc(100% + 0.25rem);
          inset-inline-start: 0;
          z-index: var(--pretui-z-dropdown, 60);
          display: flex;
          max-inline-size: min(90vw, 44rem);
          overflow-x: auto;
          border-radius: var(--radius-surface, 10px);
          background: var(--popover);
          color: var(--popover-foreground);
          box-shadow: var(--pretui-shadow-raised, 0 0 0 1px var(--border), 0 6px 20px rgb(16 24 40 / 0.12));
        }
        .pretui-cascader-col {
          flex: none;
          min-inline-size: 10rem;
          max-block-size: 16rem;
          overflow-y: auto;
          margin: 0;
          padding: 0.25rem;
          list-style: none;
        }
        .pretui-cascader-col + .pretui-cascader-col {
          border-inline-start: 1px solid var(--border);
        }
        .pretui-cascader-option {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-2, 0.375rem);
          padding: 0.375rem var(--space-3, 0.5rem);
          border-radius: var(--radius-control, 6px);
          cursor: pointer;
        }
        .pretui-cascader-option:hover,
        .pretui-cascader-option:focus-visible {
          background: var(--hover, color-mix(in oklch, var(--foreground) 8%, transparent));
          outline: 0;
        }
        .pretui-cascader-option:focus-visible {
          box-shadow: inset 0 0 0 2px var(--ring);
        }
        .pretui-cascader-option[aria-selected='true'] {
          color: var(--primary);
          font-weight: 600;
        }
        .pretui-cascader-option[aria-disabled='true'] {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .pretui-cascader-more {
          color: var(--muted-foreground);
        }
      }
    </style>
  </template>
}
