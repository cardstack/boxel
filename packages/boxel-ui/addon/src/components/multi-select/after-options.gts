import { BoxelButton } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import type { Select } from 'ember-power-select/components/power-select';

export interface BoxelAfterOptionComponentArgs {
  Args: {
    allowClosing: () => void;
    select: Select;
  };
}

// Component for additional options at the bottom of the dropdown
export class BoxelAfterOptionsComponent extends Component<BoxelAfterOptionComponentArgs> {
  @action
  onClearAll() {
    this.args.select.actions.select([]);
  }

  @action
  onClose() {
    this.args.select.actions.close();
    this.args.allowClosing();
  }
  <template>
    <div class='control-buttons'>
      <BoxelButton
        @kind='secondary-light'
        @size='extra-small'
        class='control-button'
        {{on 'click' this.onClearAll}}
      >
        Clear
      </BoxelButton>

      <BoxelButton
        @kind='secondary-light'
        @size='extra-small'
        class='control-button'
        {{on 'click' this.onClose}}
      >
        Close
      </BoxelButton>
    </div>
    <style scoped>
      .control-buttons {
        display: flex;
        justify-content: start;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-xs);
        border-top: 1px solid var(--boxel-100);
      }
      .control-button {
        flex-grow: 1;
      }
    </style>
  </template>
}
