import type { TemplateOnlyComponent } from '@ember/component/template-only';

import type { Icon } from '../../icons/types.ts';
import FilterListItem from './filter-list-item.gts';

export type Filter = {
  displayName: string;
  filters?: Filter[];
  icon?: Icon | string;
  isExpanded?: boolean;
};

interface Signature {
  Args: {
    activeFilter?: Filter;
    filters: Filter[] | undefined;
    onChanged: (filter: Filter) => void;
  };
  Element: HTMLElement;
}

const FilterList: TemplateOnlyComponent<Signature> = <template>
  <ul class='filter-list' role='tree' ...attributes>
    {{#each @filters key='displayName' as |filter|}}
      <FilterListItem
        @filter={{filter}}
        @onChanged={{@onChanged}}
        @activeFilter={{@activeFilter}}
      />
    {{/each}}
  </ul>
  <style scoped>
    @layer {
      .filter-list {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
        list-style-type: none;
        padding-inline-start: 0;
        margin-block: 0;
      }
      .filter-list :deep(.filter-list) {
        padding-inline-start: var(--boxel-sp);
      }
    }
  </style>
</template>;

export default FilterList;
