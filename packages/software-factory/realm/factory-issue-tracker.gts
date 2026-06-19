import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';

import {
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import {
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
  type RealmResourceIdentifier,
  type RenderableSearchEntryLike,
} from '@cardstack/runtime-common';

import { IssueTracker } from './issue-tracker';
import IssueTrackerBoard from './issue-tracker-board';
import { issueStatusOptions as columns } from './kanban-config';

class FactoryIssueTrackerIsolated extends Component<
  typeof FactoryIssueTracker
> {
  @tracked hideEmpty = false;

  toggleHideEmpty = (): void => {
    this.hideEmpty = !this.hideEmpty;
  };

  get factoryRunIssuesQuery(): SearchEntryWireQuery {
    let targetRealmUrl = this.args.model.targetRealmUrl;
    if (!targetRealmUrl) {
      return searchEntryWireQueryFromQuery({});
    }
    let origin = new URL(targetRealmUrl).origin;
    let moduleString =
      `${origin}/software-factory/issue-tracker` as RealmResourceIdentifier;
    return {
      ...searchEntryWireQueryFromQuery(
        {
          filter: {
            type: {
              module: moduleString,
              name: 'Issue',
            },
          },
        },
        {
          fields: ['html', 'item.status', 'item.priority', 'item.issueType'],
        },
      ),
      realms: [targetRealmUrl],
    };
  }

  openCard = (entries: RenderableSearchEntryLike[], index: number): void => {
    let entry = entries[index];
    if (entry?.id) {
      this.args.viewCard?.(new URL(entry.id), 'isolated');
    }
  };

  <template>
    <div class='factory-issue-tracker'>
      {{#if @model.targetRealmUrl}}
        <@context.searchResultsComponent
          @query={{this.factoryRunIssuesQuery}}
          @mode='none'
          as |results|
        >
          {{#if results.isLoading}}
            <p class='empty-state'>Loading issue tracker board…</p>
          {{else if results.entries}}
            <IssueTrackerBoard
              @boardTitle={{@model.cardTitle}}
              @cards={{results.entries}}
              @columns={{columns}}
              @hideEmpty={{this.hideEmpty}}
              @onToggleHideEmpty={{this.toggleHideEmpty}}
              @onOpen={{fn this.openCard results.entries}}
            />
          {{else}}
            <p class='empty-state'>No issues yet.</p>
          {{/if}}
        </@context.searchResultsComponent>
      {{else}}
        <p class='empty-state'>No target realm linked. Edit this card to connect
          one.</p>
      {{/if}}
    </div>
    <style scoped>
      .factory-issue-tracker {
        height: 100%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .empty-state {
        padding: var(--boxel-sp-xl);
        text-align: center;
        color: var(--muted-foreground, var(--boxel-500));
        font-size: 0.875rem;
      }
    </style>
  </template>
}

export class FactoryIssueTracker extends IssueTracker {
  static displayName = 'Factory Issue Tracker';

  @field targetRealmUrl = contains(StringField);
  static isolated = FactoryIssueTrackerIsolated as any;
}
