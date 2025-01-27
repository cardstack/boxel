import { CardDef, CardContext } from 'https://cardstack.com/base/card-api';
import { CRMTaskStatusField } from './task';
import GlimmerComponent from '@glimmer/component';
import { TaskPlanner, TaskCard } from '../components/base-task-planner';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';
import { getCards } from '@cardstack/runtime-common';
import { DndItem } from '@cardstack/boxel-ui/components';
import { AppCard } from '../app-card';

interface CRMTaskPlannerArgs {
  Args: {
    model: Partial<AppCard>;
    context: CardContext | undefined;
    realmURL: URL | undefined;
    viewCard: () => void;
  };
  Element: HTMLElement;
}

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

          await this.args.context?.actions?.createCard?.(
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
            await this.args.context?.actions?.saveCard?.(cardInNewCol);
          }
        },
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
      @viewCard={{@viewCard}}
    />
  </template>
}

// getComponent = (card: CardDef) => card.constructor.getComponent(card);
