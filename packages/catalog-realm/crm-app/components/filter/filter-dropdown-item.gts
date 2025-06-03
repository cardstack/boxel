import GlimmerComponent from '@glimmer/component';
import { CheckMark } from '@cardstack/boxel-ui/icons';
import { cn } from '@cardstack/boxel-ui/helpers';

interface CheckBoxArgs {
  Args: {
    isSelected: boolean;
  };
  Element: Element;
}

class CheckboxIndicator extends GlimmerComponent<CheckBoxArgs> {
  <template>
    <div class='checkbox-indicator'>
      <span class={{cn 'check-icon' check-icon--selected=@isSelected}}>
        <CheckMark width='12' height='12' />
      </span>
    </div>
    <style scoped>
      .checkbox-indicator {
        width: 16px;
        height: 16px;
        border: 1px solid var(--boxel-500);
        border-radius: 3px;
        margin-right: var(--boxel-sp-xs);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .checkbox-indicator:hover,
      .checkbox-indicator:focus {
        box-shadow: 0 0 0 2px var(--boxel-dark-teal);
      }
      .check-icon {
        --icon-color: var(--boxel-dark-teal);
        visibility: collapse;
        display: contents;
      }
      .check-icon--selected {
        visibility: visible;
      }
    </style>
  </template>
}

interface StatusPillArgs {
  Args: {
    isSelected: boolean;
    label: string;
  };
  Element: Element;
}

export class StatusPill extends GlimmerComponent<StatusPillArgs> {
  <template>
    <span class='status-pill'>
      <div class='status-pill-content'>
        <CheckboxIndicator @isSelected={{@isSelected}} />
        <div class='status-name'>{{@label}}</div>
      </div>
    </span>

    <style scoped>
      .status-pill {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: var(--boxel-font-size-sm);
        cursor: pointer;
        width: 100%;
      }
      .status-pill.selected {
        background-color: var(--boxel-highlight);
      }
      .status-pill-content {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
      }
      .status-avatar {
        width: var(--boxel-sp-sm);
        height: var(--boxel-sp-sm);
        border-radius: 50%;
        background-color: var(--avatar-bg-color, var(--boxel-light));
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-xs);
      }
      .status-name {
        flex-grow: 1;
      }
    </style>
  </template>
}
