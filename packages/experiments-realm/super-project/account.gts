import {
  CardDef,
  linksTo,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import { contains, StringField } from 'https://cardstack.com/base/card-api';
import { Component, BaseDef } from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';
import { field } from 'https://cardstack.com/base/card-api';
import { SuperProjectApp } from '../super-project-app';
import BuildingIcon from '@cardstack/boxel-icons/building';
import AccountHeader from '../components/account-header';
import { Query } from '@cardstack/runtime-common/query';
import { getCards } from '@cardstack/runtime-common';
import { SkeletonPlaceholder } from '@cardstack/boxel-ui/components';

const taskSource = {
  module: new URL('./task', import.meta.url).href,
  name: 'SuperProjectTask',
};

class EmbeddedTemplate extends Component<typeof SuperProjectAccount> {
  get realmURL(): URL {
    return this.args.model[realmURL]!;
  }

  get realmHrefs() {
    return [this.realmURL?.href];
  }

  get accountId() {
    return this.args.model.id;
  }

  get activeTasksQuery(): Query {
    let everyArr = [];
    if (this.accountId) {
      everyArr.push({
        eq: {
          'account.id': this.accountId,
        },
      });
    }
    return {
      filter: {
        on: taskSource,
        every: everyArr,
      },
    };
  }

  activeTasks = getCards(
    () => this.activeTasksQuery,
    () => this.realmHrefs,
    {
      isLive: true,
    },
  );

  get activeTasksCount() {
    const tasks = this.activeTasks;
    if (!tasks || tasks.isLoading) {
      return 0;
    }
    return tasks.instances?.length ?? 0;
  }

  get hasActiveTasks() {
    return this.activeTasksCount > 0;
  }

  <template>
    <AccountPageLayout>
      <:header>
        {{#if @model.name}}
          <h1 class='account-name'>{{@model.name}}</h1>
        {{else}}
          <h1 class='account-name default-value'>Missing Account Name</h1>
        {{/if}}
      </:header>
      <:summary>
        <article>
          {{#if this.activeTasks.isLoading}}
            <SkeletonPlaceholder class='skeleton-placeholder-task' />
          {{else}}
            <div class='task-container'>
              {{#if this.hasActiveTasks}}
                {{#each this.activeTasks.instances as |task|}}
                  {{#let (getComponent task) as |Component|}}
                    <Component
                      @format='embedded'
                      @displayContainer={{false}}
                      class='task-card-embedded'
                    />
                  {{/let}}
                {{/each}}
              {{else}}
                <div class='empty-card'>
                  <p class='description'>No Upcoming Tasks</p>
                </div>
              {{/if}}
            </div>
          {{/if}}
        </article>
      </:summary>
    </AccountPageLayout>
    <style scoped>
      h1,
      p {
        margin: 0;
      }
      .skeleton-placeholder-task {
        --skeleton-height: 55px;
      }
      .task-card-embedded,
      .empty-card {
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-radius);
        padding: var(--boxel-sp);
      }
      .task-card-fitted {
        background-color: var(--boxel-teal);
      }
      .empty-card {
        background-color: var(--boxel-300);
      }
    </style>
  </template>
}

export class SuperProjectAccount extends CardDef {
  static displayName = 'Super Project Account';
  @field superProjectApp = linksTo(() => SuperProjectApp);
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: SuperProjectAccount) {
      return this.name ?? `Untitled ${this.constructor.displayName}`;
    },
  });

  static embedded = EmbeddedTemplate;
}

interface AccountPageLayoutArgs {
  Blocks: {
    header: [];
    summary: [];
    tasks: [];
  };
  Element: HTMLElement;
}

class AccountPageLayout extends GlimmerComponent<AccountPageLayoutArgs> {
  <template>
    <div class='account-page-layout' ...attributes>
      {{yield to='header'}}
      {{yield to='summary'}}
      {{yield to='tasks'}}
    </div>

    <style scoped>
      .account-page-layout {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        width: 100%;
        padding: var(--account-page-layout-padding, 20px);
        box-sizing: border-box;
      }
    </style>
  </template>
}

function getComponent(cardOrField: BaseDef) {
  return cardOrField.constructor.getComponent(cardOrField);
}
