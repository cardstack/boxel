import GlimmerComponent from '@glimmer/component';
import { IconButton } from '@cardstack/boxel-ui/components';
import { IconFunnel } from '@cardstack/boxel-ui/icons';
interface TriggerSignature {
  Args: {};
  Element: HTMLDivElement;
}

export class FilterTrigger extends GlimmerComponent<TriggerSignature> {
  <template>
    <div class='filter-trigger'>
      <IconButton @icon={{IconFunnel}} width='15px' height='15px' />
      Filter
    </div>

    <style scoped>
      .filter-trigger {
        display: flex;
        align-items: center;
      }
    </style>
    {{! template-lint-disable require-scoped-style }}
    <style>
      .ember-power-select-trigger {
        padding: 0;
      }
    </style>
  </template>
}
