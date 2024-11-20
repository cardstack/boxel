import GlimmerComponent from '@glimmer/component';
import { IconButton } from '@cardstack/boxel-ui/components';
import ListFilter from '@cardstack/boxel-icons/list-filter';
interface TriggerSignature {
  Args: {};
  Element: HTMLDivElement;
}

export class FilterTrigger extends GlimmerComponent<TriggerSignature> {
  <template>
    <div class='filter-trigger'>
      <IconButton @icon={{ListFilter}} width='13px' height='13px' />
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
