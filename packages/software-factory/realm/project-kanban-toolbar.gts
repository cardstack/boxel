import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import SquareKanban from '@cardstack/boxel-icons/square-kanban';

import {
  ContextButton,
  Pill,
  SortDropdown,
  Switch,
} from '@cardstack/boxel-ui/components';

import { StatusPill } from './status-pill';

type GroupByOption = {
  displayName: string;
  sort: string;
};

interface Signature {
  Args: {
    model: {
      projectCode?: string | null;
      projectStatus?: string | null;
    };
    cardCount: number;
    hideEmptyColumns: boolean;
    groupByOptions: GroupByOption[];
    selectedGroupByOption?: GroupByOption;
    statusColor?: string;
    onToggleHideEmptyColumns: () => void;
    onGroupByChange: (option: GroupByOption) => void;
    onToggleSettings: () => void;
    projectStatusField: unknown;
    cardTitleField: unknown;
  };
}

const ProjectKanbanToolbar: TemplateOnlyComponent<Signature> = <template>
  <header class='kanban-toolbar'>
    <div class='toolbar-left'>
      <div class='kanban-heading'>
        <div class='kanban-meta-top'>
          <Pill @size='extra-small'>
            {{if @model.projectCode @model.projectCode 'BOARD'}}
          </Pill>
          <StatusPill @color={{@statusColor}}>
            {{#if @model.projectStatus}}
              <@projectStatusField @format='atom' />
            {{else}}
              Planning
            {{/if}}
          </StatusPill>
        </div>
        <h2 class='kanban-title'>
          <SquareKanban />
          <@cardTitleField />
        </h2>
      </div>
      <div>
        <span class='card-count'>{{@cardCount}} cards</span>
      </div>
    </div>
    <div class='toolbar-right'>
      <div class='column-visibility-toggle'>
        <span class='group-by-label'>Hide empty</span>
        <Switch
          @isEnabled={{@hideEmptyColumns}}
          @onChange={{@onToggleHideEmptyColumns}}
          @label='Hide empty columns'
        />
      </div>
      <div class='group-by-picker'>
        <SortDropdown
          @options={{@groupByOptions}}
          @selectedOption={{@selectedGroupByOption}}
          @onSelect={{@onGroupByChange}}
        />
      </div>
      <ContextButton
        class='settings-button'
        @label='Toggle column settings'
        @icon='context-menu-vertical'
        @variant='ghost'
        {{on 'click' @onToggleSettings}}
      />
    </div>
  </header>

  <style scoped>
    .kanban-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.625rem 1rem;
      border-bottom: 1px solid var(--kanban-border-color);
      background: var(--popup, var(--kanban-card-bg));
      color: var(--popup-foreground, var(--kanban-card-foreground));
      flex-shrink: 0;
    }
    .toolbar-left {
      display: flex;
      gap: 0.5rem;
    }
    .kanban-heading {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .kanban-meta-top {
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }
    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }
    .group-by-picker {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 11rem;
    }
    .column-visibility-toggle {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .group-by-label {
      font-size: 0.75rem;
      color: var(--kanban-muted-foreground);
      white-space: nowrap;
    }
    .group-by-picker :deep(.sort-options-label) {
      color: var(--kanban-muted-foreground);
      font-size: 0.75rem;
    }
    .group-by-picker :deep(.sort-button) {
      min-width: 8rem;
    }
    .kanban-title {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.875rem;
      font-weight: 600;
      margin: 0;
      letter-spacing: -0.01em;
    }
    .card-count {
      font-size: 0.75rem;
      color: var(--kanban-muted-foreground);
      padding: 0.125rem 0.5rem;
      background: var(--kanban-muted-bg);
      border-radius: 0.25rem;
    }
    .settings-button {
      color: var(--kanban-muted-foreground);
    }
  </style>
</template>;

export { ProjectKanbanToolbar };
