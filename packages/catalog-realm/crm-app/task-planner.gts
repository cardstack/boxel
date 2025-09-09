import {
  CardDef,
  CardContext,
  CreateCardFn,
  SaveCardFn,
} from 'https://cardstack.com/base/card-api';
import { CRMTaskStatusField } from './shared';
import GlimmerComponent from '@glimmer/component';
import { TaskPlanner, TaskCard } from './components/base-task-planner';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import type { Query, Filter } from '@cardstack/runtime-common/query';
import { DndItem } from '@cardstack/boxel-ui/components';
import { AppCard } from './app-card';
import { CRMTask } from './task';

export type TaskSortBy = 'dueDate' | 'priority';
export type TaskSortOrder = 'asc' | 'desc';
type TaskSort = {
  by?: TaskSortBy;
  order?: TaskSortOrder;
};

interface CRMTaskPlannerArgs {
  Args: {
    model: Partial<AppCard>;
    context: CardContext | undefined;
    realmURL: URL | undefined;
    editCard: () => void;
    searchFilter?: Filter[];
    taskFilter?: Filter[];
    sort?: TaskSort;
    createCard?: CreateCardFn;
    saveCard?: SaveCardFn;
  };
  Element: HTMLElement;
}

const sortByDueDate = (
  a: CardDef,
  b: CardDef,
  order: TaskSortOrder = 'asc',
) => {
  const crmTaskA = a as CRMTask;
  const crmTaskB = b as CRMTask;

  // Handle cases where one or both items don't have dates
  if (!crmTaskA.dateRange?.end && !crmTaskB.dateRange?.end) return 0;
  if (!crmTaskA.dateRange?.end) return 1; // null dates always go last
  if (!crmTaskB.dateRange?.end) return -1; // non-null dates always go first

  const comparison =
    crmTaskA.dateRange.end.getTime() - crmTaskB.dateRange.end.getTime();
  return order === 'asc' ? comparison : -comparison;
};

const sortByPriority = (
  a: CardDef,
  b: CardDef,
  order: TaskSortOrder = 'asc',
) => {
  const crmTaskA = a as CRMTask;
  const crmTaskB = b as CRMTask;

  // Handle cases where one or both items don't have priority
  // Check if priority or index is undefined/null, but allow 0 as valid value
  if (
    (crmTaskA.priority?.index === undefined ||
      crmTaskA.priority?.index === null) &&
    (crmTaskB.priority?.index === undefined ||
      crmTaskB.priority?.index === null)
  )
    return 0;

  if (
    crmTaskA.priority?.index === undefined ||
    crmTaskA.priority?.index === null
  )
    return 1;
  if (
    crmTaskB.priority?.index === undefined ||
    crmTaskB.priority?.index === null
  )
    return -1;

  const comparison = crmTaskA.priority.index - crmTaskB.priority.index;
  return order === 'asc' ? comparison : -comparison;
};

export class CRMTaskPlanner extends GlimmerComponent<CRMTaskPlannerArgs> {
  get parentId() {
    return this.args.model?.id;
  }

  get emptyStateMessage() {
    return 'Link a CRM App to continue';
  }

  get getTaskQuery(): Query {
    let everyArr = [];
    if (!this.args.realmURL) {
      throw new Error('No realm url');
    }

    if (!this.parentId) {
      console.log('No CRM App');
      everyArr.push({ eq: { 'crmApp.id': null } });
    } else {
      everyArr.push({ eq: { 'crmApp.id': this.parentId } });
    }

    if (this.args.searchFilter) {
      everyArr.push(...this.args.searchFilter);
    }

    if (this.args.taskFilter) {
      everyArr.push(...this.args.taskFilter);
    }

    return everyArr.length > 0
      ? {
          filter: {
            on: {
              module: this.config.taskSource.module,
              name: this.config.taskSource.name,
            },
            every: everyArr,
          },
        }
      : {
          filter: {
            type: {
              module: this.config.taskSource.module,
              name: this.config.taskSource.name,
            },
          },
        };
  }

  get realmHref() {
    return this.args.realmURL?.href;
  }

  get realmHrefs() {
    if (!this.args.realmURL) {
      return [];
    }
    return [this.args.realmURL.href];
  }

  assigneeQuery = this.args.context?.getCards(
    this,
    () => {
      return {
        filter: {
          type: this.config.filters.assignee.codeRef,
        },
      };
    },
    () => this.realmHrefs,
    { isLive: true },
  );

  get assigneeCards() {
    return this.assigneeQuery?.instances ?? [];
  }

  getOrderBy() {
    if (this.args.sort?.by === 'dueDate') {
      return (a: CardDef, b: CardDef) =>
        sortByDueDate(a, b, this.args.sort?.order);
    }
    if (this.args.sort?.by === 'priority') {
      return (a: CardDef, b: CardDef) =>
        sortByPriority(a, b, this.args.sort?.order);
    }
    return undefined;
  }

  get config() {
    return {
      status: {
        values: CRMTaskStatusField.values,
      },
      cardOperations: {
        hasColumnKey: (card: TaskCard, key: string) => {
          return card.status?.label === key;
        },
        onCreateTask: async (statusLabel: string) => {
          if (this.args.realmURL === undefined) {
            return;
          }

          let index = this.config.status.values.find((value) => {
            return value.label === statusLabel;
          })?.index;

          let doc: LooseSingleCardDocument = {
            data: {
              type: 'card',
              attributes: {
                name: null,
                details: null,
                status: {
                  index,
                  label: statusLabel,
                },
                priority: {
                  index: null,
                  label: null,
                },
                description: null,
                thumbnailURL: null,
              },
              relationships: {
                assignee: {
                  links: {
                    self: null,
                  },
                },
                crmApp: {
                  links: {
                    self: this.parentId ?? null,
                  },
                },
              },
              meta: {
                adoptsFrom: this.config.taskSource,
              },
            },
          };

          await this.args.createCard?.(
            this.config.taskSource,
            new URL(this.config.taskSource.module),
            {
              realmURL: this.args.realmURL,
              doc,
            },
          );
        },
        onMoveCard: async ({
          draggedCard,
          targetColumn,
        }: {
          draggedCard: DndItem;
          targetColumn: DndItem;
        }) => {
          let cardInNewCol = targetColumn.cards.find(
            (c: CardDef) => c.id === draggedCard.id,
          );
          // TODO: status label does not apply to all cards
          if (
            cardInNewCol &&
            cardInNewCol.status.label !== targetColumn.title
          ) {
            let statusValue = this.config.status.values.find(
              (value) => value.label === targetColumn.title,
            );
            cardInNewCol.status = new CRMTaskStatusField(statusValue);
            await this.args.saveCard?.(cardInNewCol);
          }
        },
        orderBy: this.getOrderBy(),
      },
      taskSource: {
        module: new URL('./task', import.meta.url).href,
        name: 'CRMTask',
        getQuery: () => this.getTaskQuery,
      },
      filters: {
        status: {
          searchKey: 'label',
          label: 'Status',
          codeRef: {
            module: new URL('./task', import.meta.url).href,
            name: 'Status',
          },
          options: () => CRMTaskStatusField.values,
        },
        assignee: {
          searchKey: 'name',
          label: 'Assignee',
          codeRef: {
            module: new URL('./representative', import.meta.url).href,
            name: 'Representative',
          },
          options: () => this.assigneeCards,
        },
      },
    };
  }

  <template>
    <TaskPlanner
      @config={{this.config}}
      @realmURL={{@realmURL}}
      @parentId={{this.parentId}}
      @context={{@context}}
      @emptyStateMessage={{this.emptyStateMessage}}
      @editCard={{@editCard}}
    />
  </template>
}
