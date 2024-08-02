import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import cn from '../../helpers/cn.ts';
import { getContrastColor } from '../../helpers/contrast-color.ts';
import cssVar from '../../helpers/css-var.ts';
import { eq } from '../../helpers/truth-helpers.ts';
import type { Icon } from '../../icons/types.ts';

interface Signature {
  Args: {
    activeTabIndex?: number;
    headerBackgroundColor?: string;
    iconBackgroundColor?: string;
    iconBorderColor?: string;
    iconComponent?: Icon;
    iconCoversAllAvailableSpace?: boolean;
    iconURL?: string;
    onSetActiveTab?: (index: number) => void;
    tabs?: Array<{
      displayName: string;
      tabId: string;
    }>;
    title: string;
  };
  Element: HTMLDivElement;
}

export default class TabbedHeader extends Component<Signature> {
  <template>
    <header
      class='app-header'
      style={{cssVar
        header-background-color=@headerBackgroundColor
        header-text-color=(getContrastColor @headerBackgroundColor)
      }}
    >
      <div class='app-title-group'>
        {{#if @iconURL}}
          <img
            src={{@iconURL}}
            alt='logo'
            width='25'
            height='25'
            class={{cn 'app-icon' cover=@iconCoversAllAvailableSpace}}
            style={{cssVar
              icon-background-color=@iconBackgroundColor
              icon-border-color=@iconBorderColor
            }}
          />
        {{else if @iconComponent}}
          <@iconComponent
            width='25'
            height='25'
            class={{cn 'app-icon' cover=@iconCoversAllAvailableSpace}}
            style={{cssVar
              icon-color=(getContrastColor @headerBackgroundColor)
              icon-background-color=@iconBackgroundColor
              icon-border-color=@iconBorderColor
            }}
            role='presentation'
          />
        {{/if}}
        <h1 class='app-title'>{{@title}}</h1>
      </div>
      <nav class='app-nav'>
        <ul class='app-tab-list'>
          {{#each @tabs as |tab index|}}
            <li>
              <a
                href='#{{tab.tabId}}'
                {{on 'click' (fn this.setActiveTab index)}}
                class={{if (eq this.activeTabIndex index) 'active'}}
                data-tab-label={{tab.displayName}}
                {{! do not remove data-tab-label attribute }}
              >
                {{tab.displayName}}
              </a>
            </li>
          {{/each}}
        </ul>
      </nav>
    </header>
    <style>
      .app-header {
        padding: 0 var(--boxel-sp-lg);
        background-color: var(--header-background-color, var(--boxel-light));
        color: var(--header-text-color, var(--boxel-dark));
      }
      .app-title-group {
        padding: var(--boxel-sp-xs) 0;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .app-icon {
        flex-shrink: 0;
        object-fit: contain;
        object-position: center;
        background-color: var(--icon-background-color);
        padding: 1px; /* to prevent potential border from clipping the icon */
        border: 1px solid var(--icon-border-color);
        border-radius: 4px;
      }
      .app-icon.cover {
        object-fit: cover;
        padding: 0;
      }
      .app-title {
        margin: 0;
        font: 900 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
      .app-nav {
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
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
        height: 100%;
        padding: var(--boxel-sp-xs) var(--boxel-sp-xxs);
      }
      .app-tab-list a.active,
      .app-tab-list a:hover:not(:disabled) {
        color: var(--header-text-color, var(--boxel-dark));
        border-bottom: 4px solid var(--header-text-color, var(--boxel-dark));
        font-weight: 700;
      }
      /* this prevents layout shift when text turns bold on hover/active */
      .app-tab-list a::after {
        display: block;
        content: attr(data-tab-label);
        height: 0;
        visibility: hidden;
        user-select: none;
        pointer-events: none;
        font-weight: 700;
      }
    </style>
  </template>

  @tracked activeTabIndex =
    this.args.activeTabIndex && this.args.activeTabIndex !== -1
      ? this.args.activeTabIndex
      : 0;

  @action setActiveTab(index: number) {
    this.activeTabIndex = index;
    this.args.onSetActiveTab?.(index);
  }
}
