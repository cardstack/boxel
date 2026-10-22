import { beacon } from '@cardstack/choreo';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

import { radioKeys } from '../lib/focus';

export interface PreferenceOption<T extends string> {
  label: string;
  value: T;
}

interface Signature<T extends string> {
  Args: {
    /** a Choreo beacon on the pill, for anything that flies out of it */
    beacon: string;
    icon: string;
    /** the menu's heading, and the start of the pill's accessible name */
    label: string;
    onChoose: (value: T) => void;
    options: PreferenceOption<T>[];
    value: T;
  };
  /** extra controls under the segments */
  Blocks: { default: [] };
  Element: HTMLDetailsElement;
}

/** closes the menu and puts focus back on its pill */
function closeMenu(menu: HTMLDetailsElement) {
  menu.removeAttribute('open');
  menu.querySelector('summary')?.focus();
}

/**
 * Escape in an open menu closes the menu and goes no further, so the host
 * does not also take it as Escape for the card the menu sits in. On a closed
 * pill it is the host's.
 */
function dismiss(event: Event) {
  let menu = event.currentTarget as HTMLDetailsElement;
  if (event instanceof KeyboardEvent && event.key === 'Escape' && menu.open) {
    event.preventDefault();
    event.stopPropagation();
    closeMenu(menu);
  }
}

/**
 * An open menu closes when the viewer moves on: focus going to a control
 * outside it, or a press anywhere outside it. Focus going nowhere in
 * particular (a click on a button Safari does not focus) leaves it open, so
 * a press inside the menu always lands.
 */
const closeOutside = modifier((menu: HTMLDetailsElement) => {
  let focusout = (event: FocusEvent) => {
    let next = event.relatedTarget;
    if (next instanceof Node && !menu.contains(next)) {
      menu.removeAttribute('open');
    }
  };
  let pointerdown = (event: PointerEvent) => {
    if (menu.open && !menu.contains(event.target as Node)) {
      menu.removeAttribute('open');
    }
  };
  menu.addEventListener('focusout', focusout);
  document.addEventListener('pointerdown', pointerdown, { capture: true });
  return () => {
    menu.removeEventListener('focusout', focusout);
    document.removeEventListener('pointerdown', pointerdown, {
      capture: true,
    });
  };
});

/**
 * A pill in the top bar that opens a small segmented menu, as the color
 * scheme's picker does. The segments are one radio group: Tab reaches the
 * chosen one, the arrows change the choice in place, and a click or Enter
 * makes the choice and closes the menu.
 */
export class PreferencePicker<T extends string> extends Component<
  Signature<T>
> {
  get current() {
    return this.args.options.find((option) => option.value === this.args.value)
      ?.label;
  }

  isOn = (value: T) => value === this.args.value;

  choose = (value: T, event: Event) => {
    this.args.onChoose(value);
    let menu = (event.currentTarget as HTMLElement).closest('details');
    if (menu) {
      closeMenu(menu);
    }
  };

  pickAt = (index: number) => {
    let option = this.args.options[index];
    if (option) {
      this.args.onChoose(option.value);
    }
  };

  <template>
    <details
      class='header-picker'
      ...attributes
      {{on 'keydown' dismiss}}
      {{closeOutside}}
    >
      <summary class='header-picker-pill' title={{@label}} {{beacon @beacon}}>
        <span aria-hidden='true' class='header-picker-icon'>{{@icon}}</span>
        <span class='sr-only'>{{@label}}:</span>
        <span>{{this.current}}</span><span
          aria-hidden='true'
          class='header-picker-chevron'
        >⌄</span>
      </summary>
      <div class='header-picker-menu'>
        <span class='header-picker-label' aria-hidden='true'>{{@label}}</span>
        <div
          class='header-picker-segments'
          role='radiogroup'
          aria-label={{@label}}
          {{radioKeys this.pickAt}}
        >
          {{#each @options as |option|}}
            <button
              type='button'
              role='radio'
              aria-checked={{if (this.isOn option.value) 'true' 'false'}}
              tabindex={{if (this.isOn option.value) '0' '-1'}}
              {{on 'click' (fn this.choose option.value)}}
            >{{option.label}}</button>
          {{/each}}
        </div>
        {{yield}}
      </div>
    </details>
    <style scoped>
      .header-picker {
        position: relative;
        flex: 0 0 auto;
      }

      .header-picker-pill {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 112px;
        height: 34px;
        padding: 0 12px;
        border: 1px solid var(--border-strong);
        border-radius: 999px;
        background: var(--inset);
        color: var(--foreground);
        font-size: 12px;
        cursor: pointer;
        list-style: none;
      }

      .header-picker-pill::-webkit-details-marker {
        display: none;
      }

      .header-picker-icon {
        width: 14px;
        text-align: center;
      }

      .header-picker-chevron {
        margin-left: auto;
        color: var(--subtle-foreground);
      }

      .header-picker-menu {
        position: absolute;
        right: 0;
        top: calc(100% + 10px);
        z-index: 200;
        width: 270px;
        padding: 14px;
        border: 1px solid var(--border-strong);
        border-radius: 16px;
        background: var(--canvas);
        box-shadow: 0 12px 40px
          rgba(var(--shadow-rgb), calc(0.27 * var(--shadow-a)));
      }

      .header-picker-label {
        display: block;
        margin-bottom: 10px;
        color: var(--subtle-foreground);
        font-size: 12px;
      }

      .header-picker-segments {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 3px;
        padding: 3px;
        background: var(--inset);
        border-radius: 999px;
      }

      .header-picker-segments button {
        border: 0;
        border-radius: 999px;
        padding: 9px 4px;
        /* --muted-foreground, not faint: the track is --inset, the darkest ground */
        color: var(--muted-foreground);
        background: transparent;
        font-size: 12px;
        cursor: pointer;
      }

      .header-picker-segments button[aria-checked='true'] {
        color: var(--foreground);
        background: var(--border-strong);
      }

      /* A NARROW BAR HAS NO ROOM BESIDE THE PILL. Hung from the pill, the
         menu runs off the bar's left edge, and on a phone off the screen, so
         here it hangs from the bar instead (the site frame's bar is the
         `site-bar` container, and the positioned box the menu falls back
         to), spanning it between the bar's gutters. A container query,
         because in a host stack the bar is narrower than the window. */
      @container site-bar (max-width: 600px) {
        .header-picker {
          position: static;
        }

        .header-picker-menu {
          left: var(--bar-gutter, 16px);
          right: var(--bar-gutter, 16px);
          top: calc(100% + 6px);
          width: auto;
        }

        .header-picker-pill {
          width: 94px;
          padding-inline: 9px;
          gap: 5px;
        }
      }
    </style>
  </template>
}
