import {
  contains,
  field,
  CardDef,
  linksToMany,
  StringField,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { Component } from 'https://cardstack.com/base/card-api';
import { Spec } from 'https://cardstack.com/base/spec';

import { action } from '@ember/object';

import AppListingHeader from '../components/app-listing-header';

import { Publisher } from './publisher';
import { Category, Tag } from './category';
import { License } from './license';

class EmbeddedTemplate extends Component<typeof Listing> {
  @action addToWorkspace() {
    console.log('addToWorkspace');
  }

  get appName(): string {
    return this.args.model.name || '';
  }

  get publisherName(): string {
    return this.args.model.publisher?.name || '';
  }

  <template>
    <div class='app-listing-embedded'>
      <AppListingHeader
        @name={{this.appName}}
        @publisher={{this.publisherName}}
        @onButtonClick={{this.addToWorkspace}}
        @buttonText='Add to Workspace'
      />

      <div class='app-listing-info'>
        <div class='app-listing-summary'>
          <h2>Summary</h2>
          {{@model.summary}}
        </div>

        <div class='license-statistic'>
          {{! Todo: Add license section while getting the real data }}
          <div class='license-section'>
            <h2>License</h2>
            {{@model.license.name}}
          </div>

          {{! Todo: Add statistics section while getting the real data }}
          <div class='statistics-section'>
            <h2>Statistics</h2>
            <div class='stats-container'>
              <div class='stat-item'>
                <span class='stat-label'>Downloads</span>
                <span class='stat-value'>16,842</span>
              </div>
              <div class='stat-item'>
                <span class='stat-label'>Subscriptions</span>
                <span class='stat-value'>5,439</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      h2 {
        font-weight: 600;
        margin: 0;
        margin-bottom: var(--boxel-sp);
      }
      /* container */
      .app-listing-embedded {
        container-name: app-listing-embedded;
        container-type: inline-size;
      }
      .app-listing-info {
        margin-left: 60px;
        padding: var(--boxel-sp);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xl);
        container-name: app-listing-info;
        container-type: inline-size;
      }
      .app-listing-summary {
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
        background-color: var(--boxel-100);
      }
      .license-statistic {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp);
      }
      .stats-container {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp);
      }
      .stat-item {
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-sm);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .stat-label {
        font: 500 var(--boxel-font-xs);
        color: var(--boxel-400);
      }
      .stat-value {
        font: 600 var(--boxel-font);
      }

      @container app-listing-embedded (inline-size <= 500px) {
        .app-listing-info {
          margin-left: 0;
        }
      }
      @container app-listing-info (inline-size <= 500px) {
        .license-statistic,
        .stats-container {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

export class Listing extends CardDef {
  static displayName = 'Listing';
  @field name = contains(StringField);
  @field summary = contains(MarkdownField);
  @field specs = linksToMany(() => Spec);
  @field publisher = linksTo(() => Publisher);
  @field categories = linksToMany(() => Category);
  @field tags = linksToMany(() => Tag);
  @field license = linksTo(() => License);
  //   @field pricing = contains(PricingField)
  //   @field images = containsMany(StringField) // thumbnailURLs

  @field title = contains(StringField, {
    computeVia(this: Listing) {
      return this.name;
    },
  });

  static embedded = EmbeddedTemplate;
}
