import GlimmerComponent from '@glimmer/component';
import { IconButton } from '@cardstack/boxel-ui/components';
import ListFilter from '@cardstack/boxel-icons/list-filter';

// power-select invokes its trigger component with these extra named args and
// a default block; they must be declared here (even though unused) for this
// component to satisfy its @triggerComponent contract
interface TriggerSignature {
  Args: {
    isLoading?: boolean;
    placeholder?: string;
    select?: unknown;
    selectedItemComponent?: unknown;
  };
  Blocks: {
    default: [unknown, any];
  };
  Element: HTMLDivElement;
}

export class FilterTrigger extends GlimmerComponent<TriggerSignature> {
  <template>
    <div class='filter-trigger'>
      <IconButton @icon={{ListFilter}} @width='13px' @height='13px' />
      <span class='filter-trigger-text'>
        {{#if @isLoading}}
          Loading...
        {{else}}
          Filter
        {{/if}}
      </span>
    </div>

    <style scoped>
      .filter-trigger {
        display: flex;
        align-items: center;
        font: 600 var(--boxel-font-sm);
        transition: background-color 0.5s ease-in-out;
        overflow: hidden;
      }
      .filter-trigger-text {
        padding-right: var(--boxel-sp-sm);
      }
      .filter-trigger:hover {
        cursor: pointer;
        background-color: var(--boxel-100);
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
