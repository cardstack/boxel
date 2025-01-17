import { CardDef } from 'https://cardstack.com/base/card-api';
import type Owner from '@ember/owner';
import { CRMTaskStatusField } from './crm-task';
import LayoutKanbanIcon from '@cardstack/boxel-icons/layout-kanban';
import {
  BaseTaskPlannerIsolated,
  TaskPlannerConfig,
  TaskCard,
} from '../components/base-task-planner';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';
import { getCards } from '@cardstack/runtime-common';

export class CRMTaskPlannerIsolated extends BaseTaskPlannerIsolated<
  typeof CRMTaskPlanner
> {
  constructor(owner: Owner, args: any) {
    const config: TaskPlannerConfig = {
      status: {
        values: CRMTaskStatusField.values,
      },
      cardOperations: {
        hasColumnKey: (card: TaskCard, key: string) => {
          return card.status?.label === key;
        },
        onCreateTask: async (statusLabel: string) => {
          if (this.realmURL === undefined) {
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

          await this.args.context?.actions?.createCard?.(
            this.config.taskSource,
            new URL(this.config.taskSource.module),
            {
              realmURL: this.realmURL,
              doc,
            },
          );
        },
        onMoveCard: async ({ draggedCard, targetColumn }) => {
          let cardInNewCol = targetColumn.cards.find(
            (c: CardDef) => c.id === draggedCard.id,
          );
          if (
            cardInNewCol &&
            cardInNewCol.status.label !== targetColumn.title
          ) {
            let statusValue = this.config.status.values.find(
              (value) => value.label === targetColumn.title,
            );
            cardInNewCol.status = new CRMTaskStatusField(statusValue);
            await this.args.context?.actions?.saveCard?.(cardInNewCol);
          }
        },
      },
      taskSource: {
        module: new URL('./crm-task', import.meta.url).href,
        name: 'CRMTask',
        getQuery: () => this.getTaskQuery,
      },
      filters: {
        status: {
          searchKey: 'label',
          label: 'Status',
          codeRef: {
            module: new URL('./crm-task', import.meta.url).href,
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
    super(owner, args, config);
  }

  get parentId() {
    return this.args.model?.id;
  }

  override get emptyStateMessage() {
    return 'Link a CRM App to continue';
  }

  override get getTaskQuery(): Query {
    let everyArr = [];
    if (!this.realmURL) {
      throw new Error('No realm url');
    }

    if (!this.parentId) {
      console.log('No CRM App');
      everyArr.push({ eq: { 'crmApp.id': null } });
    } else {
      everyArr.push({ eq: { 'crmApp.id': this.parentId } });
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

  assigneeQuery = getCards(
    {
      filter: {
        type: this.config.filters.assignee.codeRef,
      },
    },
    this.realmHrefs,
    { isLive: true },
  );

  get assigneeCards() {
    return this.assigneeQuery?.instances ?? [];
  }
}

export class CRMTaskPlanner extends CardDef {
  static displayName = 'Task Planner';
  static icon = LayoutKanbanIcon;
  static headerColor = '#ff7f7b';
  static prefersWideFormat = true;
  static isolated = CRMTaskPlannerIsolated;
}

export default CRMTaskPlanner;
