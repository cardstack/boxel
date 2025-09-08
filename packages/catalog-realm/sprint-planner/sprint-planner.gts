import { action } from '@ember/object';
import { DndItem } from '@cardstack/boxel-ui/components';
import LayoutKanbanIcon from '@cardstack/boxel-icons/layout-kanban';
import { LooseSingleCardDocument } from '@cardstack/runtime-common';
import {
  AnyFilter,
  CardTypeFilter,
  Query,
  EqFilter,
} from '@cardstack/runtime-common/query';
import {
  field,
  CardDef,
  Component,
  linksTo,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import { SprintTaskStatusField, Project } from './sprint-task';
import { TaskPlanner, TaskCard } from './components/base-task-planner';

class SprintPlannerIsolated extends Component<typeof SprintPlanner> {
  get parentId() {
    return this.args.model?.project?.id;
  }

  get emptyStateMessage() {
    return 'Link a project to continue';
  }

  get currentRealm() {
    return this.args.model[realmURL];
  }

  get getTaskQuery(): Query {
    let everyArr: (AnyFilter | CardTypeFilter | EqFilter)[] = [];
    if (!this.currentRealm) {
      throw new Error('No realm url');
    }
    if (!this.parentId) {
      console.log('No project');
      everyArr.push({ eq: { 'project.id': null } });
    } else {
      everyArr.push({ eq: { 'project.id': this.parentId } });
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
    return this.currentRealm?.href;
  }

  get realmHrefs() {
    if (!this.currentRealm) {
      return [];
    }
    return [this.currentRealm.href];
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

  get config() {
    return {
      status: {
        values: SprintTaskStatusField.values,
      },
      cardOperations: {
        hasColumnKey: (card: TaskCard, key: string) => {
          return card.status?.label === key;
        },
        onCreateTask: async (statusLabel: string) => {
          if (this.currentRealm === undefined) {
            return;
          }

          try {
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
                  project: {
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
                realmURL: this.currentRealm,
                doc,
              },
            );
          } catch (error) {
            console.error('Error creating card:', error);
          }
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
          if (
            cardInNewCol &&
            cardInNewCol.status.label !== targetColumn.title
          ) {
            let statusValue = this.config.status.values.find(
              (value) => value.label === targetColumn.title,
            );
            cardInNewCol.status = new SprintTaskStatusField(statusValue);
            await this.args.saveCard?.(cardInNewCol);
          }
        },
      },
      taskSource: {
        module: new URL('./sprint-task', import.meta.url).href,
        name: 'SprintTask',
        getQuery: () => this.getTaskQuery,
      },
      filters: {
        status: {
          searchKey: 'label',
          label: 'Status',
          codeRef: {
            module: new URL('./sprint-task', import.meta.url).href,
            name: 'Status',
          },
          options: () => SprintTaskStatusField.values,
        },
        assignee: {
          searchKey: 'name',
          label: 'Assignee',
          codeRef: {
            module: new URL('./sprint-task', import.meta.url).href,
            name: 'TeamMember',
          },
          options: () => this.assigneeCards,
        },
      },
    };
  }

  @action editCard() {
    if (!this.args.model.id) {
      throw new Error('No card id');
    }
    this.args.editCard?.(this.args.model as CardDef);
  }

  <template>
    <TaskPlanner
      @config={{this.config}}
      @realmURL={{this.currentRealm}}
      @parentId={{this.parentId}}
      @context={{@context}}
      @emptyStateMessage={{this.emptyStateMessage}}
      @editCard={{this.editCard}}
    />
  </template>
}

export class SprintPlanner extends CardDef {
  static displayName = 'Sprint Planner';
  static icon = LayoutKanbanIcon;
  static headerColor = '#ff7f7b';
  static prefersWideFormat = true;
  static isolated = SprintPlannerIsolated;
  @field project = linksTo(() => Project);
}
