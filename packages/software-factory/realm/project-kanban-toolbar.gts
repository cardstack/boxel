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
          <span class='card-count'>{{@cardCount}} cards</span>
        </div>
        <h2 class='kanban-title'>
          <SquareKanban />
          <@cardTitleField />
        </h2>
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
      gap: 0.75rem 1rem;
      flex-wrap: wrap;
      padding: 0.625rem 1rem;
      border-bottom: 1px solid var(--kanban-border-color);
      background: var(--popup, var(--kanban-card-bg));
      color: var(--popup-foreground, var(--kanban-card-foreground));
      flex-shrink: 0;
      container-type: inline-size;
    }
    .toolbar-left {
      display: flex;
      align-items: center;
      flex: 1 1 18rem;
      gap: 0.5rem;
      min-width: 0;
    }
    .kanban-heading {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 0;
    }
    .kanban-meta-top {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.375rem;
    }
    .toolbar-right {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex: 0 1 auto;
      flex-wrap: wrap;
      gap: 0.375rem;
      min-width: 0;
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
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-right: 0.75rem;
    }
    .group-by-label {
      font-size: 0.75rem;
      font-weight: 500;
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
      min-width: 0;
    }
    .kanban-title :deep(svg) {
      flex-shrink: 0;
    }
    .kanban-title :deep(*) {
      min-width: 0;
    }
    .kanban-title :deep(.card-boundary) {
      min-width: 0;
    }
    .kanban-title :deep(.field-value) {
      display: inline-block;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card-count {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--kanban-muted-foreground);
      padding: 0.125rem 0.5rem;
      background: var(--kanban-muted-bg);
      border-radius: 0.25rem;
      white-space: nowrap;
    }
    .settings-button {
      opacity: 0.6;
    }
    .settings-button:hover {
      opacity: 1;
    }
    @container (max-width: 48rem) {
      .toolbar-left,
      .toolbar-right {
        flex-basis: 100%;
      }
      .toolbar-right {
        justify-content: space-between;
      }
    }
    @container (max-width: 34rem) {
      .kanban-toolbar {
        padding: 0.75rem;
      }
      .toolbar-left {
        align-items: flex-start;
      }
      .toolbar-right {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.5rem;
      }
      .column-visibility-toggle,
      .group-by-picker {
        width: 100%;
        min-width: 0;
        margin-right: 0;
      }
      .group-by-picker :deep(.sort-button),
      .group-by-picker :deep(.boxel-select),
      .group-by-picker :deep(.ember-basic-dropdown-trigger) {
        width: 100%;
      }
      .settings-button {
        justify-self: end;
      }
    }
  </style>
</template>;

export { ProjectKanbanToolbar };
