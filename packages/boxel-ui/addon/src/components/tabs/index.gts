import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { eq } from '../../helpers/truth-helpers.ts';
interface Signature {
  Args: {
    activeTabIndex?: number;
    flexStyle?: FlexStyleOptions;
    onSetActiveTab?: (index: number) => void;
    tabs?: Array<{
      displayName: string;
      tabId: string;
    }>;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

export type FlexStyleOptions = 'default' | 'fill';

export default class Tabs extends Component<Signature> {
  <template>
    <nav class='tab-nav'>
      <ul class={{this.tabListClass}}>
        {{#each @tabs as |tab index|}}
          <li>
            <a
              href='#{{tab.tabId}}'
              {{on 'click' (fn this.setActiveTab index)}}
              class={{if (eq this.activeTabIndex index) 'active'}}
              data-tab-label={{tab.displayName}}
            >
              {{tab.displayName}}
            </a>
          </li>
        {{/each}}
      </ul>
    </nav>
    <style>
      .tab-nav {
        font-size: var(--boxel-tabs-font-size, var(--boxel-font-sm));
        font-weight: var(--boxel-tabs-font-weight, 700);
        letter-spacing: var(--boxel-tabs-letter-spacing, normal);
        --tab-active-color: var(--boxel-tabs-active-color, var(--boxel-dark));
        --tab-active-bg: var(--boxel-tabs-active-bg, transparent);
        --tab-active-border-color: var(
          --boxel-tabs-active-border-color,
          var(--boxel-dark)
        );
        --tab-color: var(--boxel-tabs-color, var(--boxel-dark));
        --tab-bg: var(--boxel-tabs-bg, transparent);
      }
      .tab-list {
        list-style-type: none;
        padding: 0;
        margin: 0;
        display: flex;
        gap: var(--boxel-sp);
        flex-flow: row wrap;
        gap: var(--boxel-tabs-gap, var(--boxel-sp-sm));
      }
      .tab-list.fill {
        width: 100%;
      }
      .tab-list.fill li {
        flex: 1 1 auto;
      }
      .tab-list.fill a {
        text-align: center;
        width: 100%;
        display: block;
      }
      .tab-list a {
        height: 100%;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-bottom: 4px solid transparent;
        transition:
          border-bottom-color 0.3s ease-in-out,
          background-color 0.3s ease-in-out,
          color 0.3s ease-in-out,
          font-weight 0.3s ease-in-out;
        color: var(--tab-color);
        background-color: var(--tab-bg);
        leading: none;
      }
      .tab-list a.active {
        color: var(--tab-active-color);
        background-color: var(--tab-active-bg);
        border-bottom-color: var(--tab-active-border-color);
      }
      .tab-list a:hover:not(:disabled) {
        color: var(--tab-hover-color);
        filter: brightness(98%);
      }
      /* this prevents layout shift when text turns bold on hover/active */
      .tab-list a::after {
        display: block;
        content: attr(data-tab-label);
        height: 0;
        visibility: hidden;
        user-select: none;
        pointer-events: none;
      }
    </style>
  </template>

  @tracked activeTabIndex = this.args.activeTabIndex ?? 0;

  @action setActiveTab(index: number) {
    this.activeTabIndex = index;
    this.args.onSetActiveTab?.(index);
  }

  get tabListClass() {
    return this.args.flexStyle === 'fill' ? 'tab-list fill' : 'tab-list';
  }
}
