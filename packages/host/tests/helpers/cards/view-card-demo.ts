export const viewCardDemoCardSource = `
  import { action } from '@ember/object';
  import { on } from '@ember/modifier';
  import { tracked } from '@glimmer/tracking';
  import {
    CardDef,
    field,
    contains,
    Component,
  } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";
  import { fn } from '@ember/helper'

  export class ViewCardDemo extends CardDef {
    static displayName = 'View Card Demo';

    @field cardTitle = contains(StringField);
    @field targetCardURL = contains(StringField);

    static isolated = class Isolated extends Component<typeof this> {
      tabs = [
        {
          id: 'overview',
          label: 'Overview',
          cardDescription:
            'This tab summarizes the key information that the card is showing.',
        },
        {
          id: 'details',
          label: 'Details',
          cardDescription:
            'Additional details about this card that help confirm interactive state.',
        },
        {
          id: 'history',
          label: 'History',
          cardDescription:
            'Historical context to make it easier to confirm tab state persists.',
        },
      ];

      @tracked activeTabId = 'overview';

      get activeTab() {
        return this.tabs.find((tab) => tab.id === this.activeTabId) ?? this.tabs[0];
      }

      isSelected = (tabId: string) => {
        return this.activeTabId === tabId;
      }

      @action selectTab(tabId: string) {
        this.activeTabId = tabId;
      }

      @action openTarget() {
        let viewCard = this.args.viewCard;
        let target = this.args.model.targetCardURL;

        if (!viewCard || !target) {
          return;
        }

        try {
          viewCard(new URL(target));
        } catch {
          // Intentionally swallow parsing errors to avoid breaking the card.
        }
      }

      <template>
        <article data-test-view-card-demo>
          <header>
            <h2 data-test-view-card-demo-title>{{@model.cardTitle}}</h2>
          </header>
          <div
            role="tablist"
            aria-label="View card demo tabs"
            class="tablist"
            data-test-view-card-demo-tablist
          >
            {{#each this.tabs as |tab|}}
              <button
                type="button"
                role="tab"
                aria-selected='{{if (this.isSelected tab.id) 'true' 'false'}}'
                class='{{if (this.isSelected tab.id) "is-active"}}'
                {{on "click" (fn this.selectTab tab.id)}}
                id="tab-{{tab.id}}"
                data-test-view-card-demo-tab={{tab.id}}
              >
                {{tab.label}}
              </button>
            {{/each}}
          </div>
          <section
            role="tabpanel"
            tabindex="0"
            aria-labelledby="tab-{{this.activeTab.id}}"
            class="tabpanel"
            data-test-view-card-demo-active-tab={{this.activeTab.id}}
          >
            <p data-test-view-card-demo-tab-content>
              {{this.activeTab.description}}
            </p>
          </section>
          <p data-test-view-card-demo-target>{{@model.targetCardURL}}</p>
          <button
            type="button"
            {{on "click" this.openTarget}}
            data-test-view-card-demo-button
          >
            View linked card
          </button>
        </article>
      </template>
    };
  }
`;
