import { beacon } from '@cardstack/choreo';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

export interface PreferenceOption<T extends string> {
  label: string;
  value: T;
}

interface Signature<T extends string> {
  Args: {
    /** a Choreo beacon on the pill, for anything that flies out of it */
    beacon: string;
    icon: string;
    /** the menu's heading, and the pill's accessible name */
    label: string;
    onChoose: (value: T) => void;
    options: PreferenceOption<T>[];
    value: T;
  };
  /** extra controls under the segments */
  Blocks: { default: [] };
  Element: HTMLDetailsElement;
}

function dismiss(event: Event) {
  if (event instanceof KeyboardEvent && event.key === 'Escape') {
    const menu = event.currentTarget as HTMLDetailsElement;
    menu.removeAttribute('open');
    menu.querySelector('summary')?.focus();
  }
}

/**
 * A pill in the top bar that opens a small segmented menu — the page
 * transition's tempo and the color scheme are both one of these.
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
    (event.currentTarget as HTMLElement)
      .closest('details')
      ?.removeAttribute('open');
  };

  <template>
    <details
      name='header-preferences'
      class='header-picker'
      ...attributes
      {{on 'keydown' dismiss}}
    >
      <summary
        class='header-picker-pill'
        aria-label={{@label}}
        title={{@label}}
        {{beacon @beacon}}
      >
        <span aria-hidden='true' class='header-picker-icon'>{{@icon}}</span>
        <span>{{this.current}}</span><span
          aria-hidden='true'
          class='header-picker-chevron'
        >⌄</span>
      </summary>
      <div class='header-picker-menu'>
        <span class='header-picker-label'>{{@label}}</span>
        <div class='header-picker-segments' role='group' aria-label={{@label}}>
          {{#each @options as |option|}}
            <button
              type='button'
              aria-pressed={{if (this.isOn option.value) 'true' 'false'}}
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
        border: 1px solid var(--line-strong);
        border-radius: 999px;
        background: var(--bg-well);
        color: var(--ink);
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
        color: var(--ink-faint);
      }

      .header-picker-menu {
        position: absolute;
        right: 0;
        top: calc(100% + 10px);
        z-index: 200;
        width: 270px;
        padding: 14px;
        border: 1px solid var(--line-strong);
        border-radius: 16px;
        background: var(--bg);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.27);
      }

      .header-picker-label {
        display: block;
        margin-bottom: 10px;
        color: var(--ink-faint);
        font-size: 12px;
      }

      .header-picker-segments {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 3px;
        padding: 3px;
        background: var(--bg-well);
        border-radius: 999px;
      }

      .header-picker-segments button {
        border: 0;
        border-radius: 999px;
        padding: 9px 4px;
        color: var(--ink-faint);
        background: transparent;
        font-size: 12px;
        cursor: pointer;
      }

      .header-picker-segments button[aria-pressed='true'] {
        color: var(--ink);
        background: var(--line-strong);
      }

      @media (max-width: 600px) {
        .header-picker-pill {
          width: 94px;
          padding-inline: 9px;
          gap: 5px;
        }
      }
    </style>
  </template>
}
