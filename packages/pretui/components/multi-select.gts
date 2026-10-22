// Pretui — MultiSelect.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { guidFor } from '@ember/object/internals';
import { OwnedTimers, TypeaheadBuffer, ownsTimers, typeaheadIndex } from '../focus';
import { Popup } from './popup';
import type { SelectOption } from './select';

// ── MultiSelect ──────────────────────────────────────────────────────────
// Fresh on the Popup primitive, mirroring Pretui Select's structure: same
// trigger dress (pretui-input face, focus ring while open), same listbox
// with the traveling highlight — plus removable chips in the trigger
// (FilterChips capsule dress) and checkbox-marked options that keep the
// list open across toggles. The trigger is a role='combobox' div rather
// than a button so the chip-remove buttons can nest inside it legally.
export interface MultiSelectSignature {
  Args: {
    options: SelectOption[];
    value?: string[];
    defaultValue?: string[];
    placeholder?: string;
    /** accessible name for the combobox; falls back to @placeholder */
    label?: string;
    disabled?: boolean;
    onValueChange?: (values: string[]) => void;
  };
  Element: HTMLDivElement;
}

export class MultiSelect extends Component<MultiSelectSignature> {
  get listboxId() {
    return `${guidFor(this)}-listbox`;
  }
  optionId = (index: number) => `${guidFor(this)}-opt-${index}`;
  get activeId(): string | undefined {
    return this.open && this.args.options.length ? this.optionId(this.hi) : undefined;
  }
  get accessibleName(): string {
    return this.args.label ?? this.args.placeholder ?? 'Select items';
  }
  get countText(): string {
    return `${this.values.length} selected`;
  }
  private timers = new OwnedTimers();
  private typeahead = new TypeaheadBuffer(this.timers);
  @tracked internal: string[] = this.args.defaultValue ?? [];
  @tracked open = false;
  @tracked hi = 0;

  get values(): string[] {
    return this.args.value ?? this.internal;
  }
  get selectedOptions() {
    return this.args.options.filter((o) => this.values.includes(o.value));
  }
  get highlightStyle() {
    return htmlSafe(`transform: translateY(${4 + this.hi * 28}px); height: 28px; top: 0`);
  }
  isChecked = (option: SelectOption) => this.values.includes(option.value);
  toggleOpen = () => {
    if (this.args.disabled) {
      return;
    }
    this.open = !this.open;
    if (this.open) {
      this.hi = Math.max(0, this.args.options.findIndex((o) => this.isChecked(o)));
    }
  };
  close = () => {
    this.open = false;
  };
  toggleValue = (option: SelectOption) => {
    if (this.args.disabled) {
      return;
    }
    let next = this.isChecked(option)
      ? this.values.filter((v) => v !== option.value)
      : [...this.values, option.value];
    if (this.args.value === undefined) {
      this.internal = next;
    }
    this.args.onValueChange?.(next);
    // multi-select semantics: the listbox stays open across toggles
  };
  remove = (option: SelectOption, e: Event) => {
    e.stopPropagation();
    this.toggleValue(option);
  };
  hover = (index: number) => {
    this.hi = index;
  };
  onKey = (e: Event) => {
    let ev = e as KeyboardEvent;
    let opts = this.args.options;
    if (!this.open && (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'ArrowDown')) {
      ev.preventDefault();
      this.toggleOpen();
      return;
    }
    if (!this.open) {
      return;
    }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.hi = Math.min(opts.length - 1, this.hi + 1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.hi = Math.max(0, this.hi - 1);
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      this.hi = 0;
    } else if (ev.key === 'End') {
      ev.preventDefault();
      this.hi = Math.max(0, opts.length - 1);
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      let o = opts[this.hi];
      if (o) {
        this.toggleValue(o);
      }
    } else if (ev.key === 'Escape') {
      this.close();
    } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      let prefix = this.typeahead.push(ev.key);
      let next = typeaheadIndex(
        opts.map((o) => o.label),
        prefix,
        this.hi,
        this.typeahead.isCycling,
      );
      if (next >= 0) {
        this.hi = next;
      }
    }
  };

  <template>
    <div class='pretui-selectwrap' data-test-pretui-multi-select {{ownsTimers this.timers}} ...attributes>
      <Popup @open={{this.open}} @matchWidth={{true}} @distance={{4}}>
        <:anchor>
          <div
            role='combobox'
            tabindex='0'
            class='pretui-input pretui-mstrigger'
            data-state={{if this.open 'open' 'closed'}}
            data-disabled={{if @disabled 'true'}}
            aria-haspopup='listbox'
            aria-controls={{this.listboxId}}
            aria-expanded={{if this.open 'true' 'false'}}
            aria-disabled={{if @disabled 'true' 'false'}}
            aria-label={{this.accessibleName}}
            aria-activedescendant={{this.activeId}}
            {{on 'keydown' this.onKey}}
            {{on 'click' this.toggleOpen}}
          >
            {{#if this.selectedOptions.length}}
              {{#each this.selectedOptions as |option|}}
                <span class='pretui-mschip'>
                  {{option.label}}
                  <button
                    type='button'
                    class='pretui-mschip-x'
                    aria-label='Remove {{option.label}}'
                    tabindex='-1'
                    {{on 'click' (fn this.remove option)}}
                  >
                    <svg width='8' height='8' viewBox='0 0 8 8' aria-hidden='true'><path d='M1.5 1.5 6.5 6.5 M6.5 1.5 1.5 6.5' fill='none' stroke='currentColor' stroke-width='1.4' stroke-linecap='round' /></svg>
                  </button>
                </span>
              {{/each}}
            {{else}}
              <span class='pretui-placeholder'>{{if @placeholder @placeholder 'Select…'}}</span>
            {{/if}}
            <svg width='10' height='10' viewBox='0 0 10 10' class='pretui-caret' aria-hidden='true'><path d='M2 3.5 5 6.5 8 3.5' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' /></svg>
          </div>
        </:anchor>
        <:default>
          <button type='button' class='pretui-select-backdrop' aria-label='Close' tabindex='-1' {{on 'click' this.close}}></button>
          <div
            class='pretui-listbox'
            id={{this.listboxId}}
            role='listbox'
            aria-multiselectable='true'
          >
            <div class='pretui-listbox-hl' style={{this.highlightStyle}}></div>
            {{#each @options as |option index|}}
              <div
                id={{this.optionId index}}
                role='option'
                aria-selected={{if (this.isChecked option) 'true' 'false'}}
                class='pretui-option'
                data-state={{if (this.isChecked option) 'checked'}}
                {{on 'mouseenter' (fn this.hover index)}}
                {{on 'click' (fn this.toggleValue option)}}
              >
                <span class='pretui-msbox' data-state={{if (this.isChecked option) 'checked'}}>
                  {{#if (this.isChecked option)}}<span class='pretui-msbox-check'></span>{{/if}}
                </span>
                {{option.label}}
              </div>
            {{/each}}
          </div>
        </:default>
      </Popup>
      <span class='pretui-ms-count' role='status'>{{this.countText}}</span>
    </div>
    <style scoped>
      /* above Popup's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        .pretui-selectwrap {
          min-width: 0;
        }
        .pretui-ms-count {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        .pretui-input {
          display: flex;
          align-items: center;
          gap: 6px;
          height: var(--control-h, 28px);
          padding: 0 9px;
          border: 0;
          border-radius: var(--radius);
          font: inherit;
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--foreground);
          background: var(--field, var(--boxel-light));
          box-shadow: 0 0 0 1px var(--input);
          width: 100%;
        }
        /* trigger grows with wrapped chips; keeps the h28 rest state */
        .pretui-mstrigger {
          height: auto;
          min-height: var(--control-h, 28px);
          flex-wrap: wrap;
          gap: 3px;
          padding: 3px 9px 3px 4px;
          cursor: pointer;
        }
        /* The ring is a box-shadow so it costs no layout — but a box-shadow is
           not painted at all in forced-colors mode, which would leave this
           trigger with no focus indicator in high contrast. The transparent
           outline is the standard fix: it paints nothing in normal rendering
           and it never participates in layout, while forced-colors forces
           outline-color to a system colour and the ring reappears. boxel-ui
           uses exactly this device on its own invalid-input focus state. */
        .pretui-mstrigger:focus-visible {
          outline: 2px solid transparent;
          outline-offset: 1px;
          box-shadow: 0 0 0 2px var(--primary), var(--pretui-shadow-inset, inset 0 1px 2px rgb(0 0 0 / 0.16));
        }
        .pretui-mstrigger[data-state='open'] {
          box-shadow: 0 0 0 2px var(--primary), var(--pretui-shadow-inset, inset 0 1px 2px rgb(0 0 0 / 0.16));
        }
        .pretui-mstrigger[data-disabled] {
          opacity: 0.45;
          cursor: default;
        }
        .pretui-placeholder {
          color: var(--ink-3, var(--boxel-400));
          padding-left: 5px;
        }
        .pretui-caret {
          flex: none;
          margin-left: auto;
          color: var(--ink-3, var(--boxel-400));
        }
        /* selected chips — FilterChips capsule dress, cut down to 20px */
        .pretui-mschip {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          height: 20px;
          border-radius: 10px;
          padding: 0 3px 0 calc(4px * var(--pretui-capsule-base, 1.35) + 10px * var(--pretui-radius-encroach, 0.35));
          background: var(--card);
          box-shadow: var(--pretui-shadow-control, 0 0 0 1px var(--border));
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 500;
          color: var(--foreground);
          flex: none;
        }
        .pretui-mschip-x {
          border: 0;
          background: none;
          padding: 0;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          display: inline-grid;
          place-content: center;
          color: var(--ink-3, var(--boxel-400));
          cursor: pointer;
          flex: none;
        }
        .pretui-mschip-x:hover {
          background: var(--hover, var(--boxel-100));
          color: var(--foreground);
        }
        .pretui-select-backdrop {
          /* wave-0 backdrop-close: viewport-covering close target instead of a
             document listener; fixed is intentional (lint warns, accepted) */
          position: fixed;
          inset: 0;
          background: transparent;
          border: 0;
          /* kit stacking scale (pretui-css.gts). A scrim always sits one tier
             BELOW the surface it dismisses — the bare 49 this replaced
             outranked the listbox's auto z, so the scrim painted over the
             options it was meant to sit behind. */
          z-index: var(--pretui-z-scrim, 50);
          cursor: default;
        }
        .pretui-listbox {
          /* positioned by the Popup primitive (fixed, clip-proof, matchWidth) */
          position: relative;
          z-index: var(--pretui-z-dropdown, 60);
          background: var(--popover);
          border-radius: 10px;
          box-shadow: var(--pretui-shadow-overlay, 0 0 0 1px var(--border), 0 8px 28px rgb(0 0 0 / 0.16));
          padding: 4px;
          min-width: 100%;
        }
        .pretui-listbox-hl {
          position: absolute;
          left: 4px;
          right: 4px;
          border-radius: 6px;
          background: var(--hover, var(--boxel-100));
          transition: transform var(--pretui-dur-snap, 180ms) var(--pretui-ease-snap, ease);
          pointer-events: none;
        }
        .pretui-option {
          position: relative;
          display: flex;
          align-items: center;
          gap: 7px;
          height: 28px;
          padding: 0 8px;
          border-radius: 6px;
          font-size: var(--text-ui-md, 12.5px);
          cursor: pointer;
          color: var(--foreground);
        }
        /* checkbox marker — the pretui-checkbox recipe at option scale */
        .pretui-msbox {
          width: 15px;
          height: 15px;
          border-radius: 5px;
          background: var(--pretui-control-rest, var(--field, var(--boxel-light)));
          box-shadow: 0 0 0 1px var(--pretui-control-border, var(--input));
          display: inline-grid;
          place-content: center;
          flex: none;
          transition: background var(--pretui-dur-snap, 180ms) var(--pretui-ease-snap, ease);
        }
        .pretui-msbox[data-state='checked'] {
          background: var(--primary);
          box-shadow: 0 0 0 1px color-mix(in oklch, var(--primary) 70%, var(--border)),
            var(--pretui-edge-highlight, inset 0 1px 0 rgb(255 255 255 / 0.14));
        }
        .pretui-msbox-check {
          width: 9px;
          height: 9px;
          background: var(--primary-foreground);
          clip-path: polygon(14% 47%, 38% 70%, 86% 18%, 96% 30%, 39% 89%, 4% 58%);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-listbox-hl,
          .pretui-msbox {
            transition: none;
          }
        }
        .pretui-selectwrap :deep(.pretui-popup-anchor) {
          display: block;
          width: 100%;
        }
      }
    </style>
  </template>
}

