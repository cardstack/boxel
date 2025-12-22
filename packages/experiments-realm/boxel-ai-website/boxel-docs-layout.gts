import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';

import { eq } from '@cardstack/boxel-ui/helpers';

import { Site } from './site-config';
import { PageSectionField } from './fields/page-section-field';

class Isolated extends Component<typeof DocsLayoutCard> {
  <template>
    <div class='docs-layout'>
      {{#if @model.showSidebar}}
        <aside class='docs-sidebar'>
          <div class='sidebar-header'>{{@model.site.siteTitle}}</div>
          <div class='sidebar-nav'>
            {{#each @model.site.pages as |page|}}
              <a
                href={{page.pageUrl}}
                class={{if (eq page.pageId @model.currentPageId) 'active' ''}}
              >
                {{page.pageLabel}}
              </a>
            {{/each}}
          </div>
        </aside>
      {{/if}}

      <main class='docs-main'>
        <div class='sections-container'>
          {{#if @model.sections.length}}
            {{#each @fields.sections as |Section|}}
              <Section @format='embedded' />
            {{/each}}
          {{else}}
            <div class='empty-state'>No sections configured</div>
          {{/if}}
        </div>
      </main>
    </div>

    <style scoped>
      .docs-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-height: 100vh;
      }

      .docs-sidebar {
        padding: 1.5rem;
        background: var(--muted, #f6f6f6);
        border-right: 1px solid var(--border, #e5e5e5);
      }

      .sidebar-header {
        font-weight: 700;
        margin-bottom: 1rem;
      }

      .sidebar-nav {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .sidebar-nav a {
        color: var(--muted-foreground, #666);
        text-decoration: none;
        padding: 0.4rem 0.6rem;
        border-radius: 0.5rem;
      }

      .sidebar-nav a.active {
        color: var(--foreground, #111);
        background: var(--card, #fff);
        border: 1px solid var(--border, #e5e5e5);
      }

      .docs-main {
        padding: var(--section-padding-block, 3rem)
          var(--section-padding-inline, 1.5rem);
      }

      .sections-container {
        max-width: var(--section-max-width, 1200px);
        margin-inline: auto;
        display: flex;
        flex-direction: column;
        gap: var(--section-gap, 3rem);
      }

      .empty-state {
        padding: 2rem;
        text-align: center;
        color: var(--muted-foreground, #666);
      }

      @media (min-width: 960px) {
        .docs-layout {
          grid-template-columns: 280px 1fr;
        }
      }
    </style>
  </template>
}

export class DocsLayoutCard extends CardDef {
  static displayName = 'Docs Layout';
  static prefersWideFormat = true;

  @field site = linksTo(() => Site);
  @field currentPageId = contains(StringField);
  @field showSidebar = contains(BooleanField);
  @field sections = containsMany(PageSectionField);

  static isolated = Isolated;
}
