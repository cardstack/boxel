import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { getContrastColor } from '../../helpers/contrast-color.ts';
import cssVar from '../../helpers/css-var.ts';
import { eq } from '../../helpers/truth-helpers.ts';

interface Signature {
  Args: {
    activeTabId?: string;
    headerBackgroundColor?: string;
    headerTitle?: string;
    setActiveTab: (tabId: string) => void;
    tabs: Array<{
      displayName: string;
      tabId: string;
    }>;
  };
  Blocks: {
    default: [];
    headerIcon: [];
    sideContent: [];
  };
  Element: HTMLElement;
}

// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export default class TabbedHeader extends Component<Signature> {
  <template>
    <header
      class='app-header'
      style={{cssVar
        boxel-header-background=@headerBackgroundColor
        boxel-header-foreground=(getContrastColor @headerBackgroundColor)
      }}
      ...attributes
    >
      {{#if @headerTitle}}
        <div class='app-title-group'>
          {{#if (has-block 'headerIcon')}}
            {{yield to='headerIcon'}}
          {{/if}}
          <h1 class='app-title'>{{@headerTitle}}</h1>
        </div>
      {{/if}}

      <div class='app-content'>
        <nav class='app-nav'>
          <ul class='app-tab-list'>
            {{#each @tabs as |tab|}}
              <li>
                <a
                  href='#{{tab.tabId}}'
                  {{on 'click' (fn @setActiveTab tab.tabId)}}
                  class={{if (eq @activeTabId tab.tabId) 'active'}}
                  data-tab-label={{tab.displayName}}
                  data-test-tab-label={{tab.displayName}}
                >
                  {{tab.displayName}}
                </a>
              </li>
            {{/each}}
          </ul>
        </nav>

        <div class='app-side-content'>
          {{#if (has-block 'sideContent')}}
            {{yield to='sideContent'}}
          {{/if}}
        </div>
      </div>
    </header>
    <style scoped>
      .app-header {
        --_header-background-color: var(
          --boxel-header-background,
          var(--sidebar, var(--card))
        );
        --_header-text-color: var(
          --boxel-header-foreground,
          var(--sidebar-foreground, var(--card-foreground))
        );
        padding-top: var(--boxel-sp-3xs);
        padding-inline: var(--boxel-sp-lg);
        background-color: var(--_header-background-color);
        color: var(--_header-text-color);
      }
      .app-title-group {
        padding: var(--boxel-sp-xs) 0;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .app-title {
        margin: 0;
        font-weight: var(--boxel-header-title-font-weight, 900);
        font-size: var(--boxel-header-title-font-size, var(--boxel-font-size));
        letter-spacing: var(--boxel-header-title-lsp, var(--boxel-lsp-xl));
        text-transform: var(--boxel-header-title-transform, uppercase);
      }
      .app-content {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        justify-content: space-between;
        gap: var(--boxel-sp-lg);
      }
      .app-nav {
        font-size: var(--boxel-font-size-sm);
        font-weight: 500;
        letter-spacing: var(--boxel-lsp-sm);
        flex: 1;
      }
      .app-tab-list {
        list-style-type: none;
        padding: 0;
        margin: 0;
        display: flex;
        gap: var(--boxel-sp);
        flex-flow: row wrap;
      }
      .app-tab-list a {
        display: block;
        height: 100%;
        padding: var(--boxel-sp-xs) var(--boxel-sp-2xs);
        border-bottom: 4px solid transparent;
        transition:
          border-bottom-color 0.3s ease-in-out,
          font-weight 0.3s ease-in-out;
      }
      .app-tab-list a.active {
        color: var(--_header-text-color);
        border-bottom-color: var(--_header-text-color);
        font-weight: 600;
      }
      .app-tab-list a:hover:not(:disabled) {
        color: var(--_header-text-color);
        font-weight: 600;
      }
      /* Reserve the bold width up front so the label doesn't reflow when it
         turns bold on hover/active. Sourced from data-tab-label (not the
         data-test-* attribute, which the consuming app strips in production
         builds — leaving the ghost empty and the shift unmitigated). */
      .app-tab-list a::after {
        display: block;
        content: attr(data-tab-label);
        height: 0;
        visibility: hidden;
        user-select: none;
        pointer-events: none;
        font-weight: 600;
      }
      .app-side-content {
        margin: var(--boxel-sp-xs) 0;
      }
    </style>
  </template>
}
