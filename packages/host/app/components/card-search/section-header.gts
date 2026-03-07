import { action } from '@ember/object';
import Component from '@glimmer/component';

import { BoxelInput, RealmIcon } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import type { RealmSectionInfo } from './search-content';
import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    hideCount?: boolean;
    icon?: ComponentLike<{ Element: Element }>;
    realmInfo?: RealmSectionInfo;
    title: string;
    totalCount?: number;
    showOnlyLabel?: string;
    showOnlyChecked?: boolean;
    onShowOnlyChange?: (checked: boolean) => void;
  };
  Blocks: {};
}

export default class SearchSheetSectionHeader extends Component<Signature> {
  @action
  handleShowOnlyChange(e: Event) {
    const target = e.target as HTMLInputElement;
    this.args.onShowOnlyChange?.(target.checked);
  }

  <template>
    <header
      class='search-sheet-section-header'
      data-test-search-sheet-section-header
    >
      <div class='icon'>
        {{#if @realmInfo}}
          <RealmIcon @realmInfo={{@realmInfo}} />
        {{else if @icon}}
          {{#let @icon as |IconComponent|}}
            <IconComponent class='icon-svg' />
          {{/let}}
        {{/if}}
      </div>
      <div class='title'>{{@title}}</div>
      {{#unless @hideCount}}
        <div
          class='count'
          data-test-search-sheet-section-count
          data-test-results-count
        >
          {{#if (eq @totalCount 0)}}
            No results
          {{else}}
            {{@totalCount}}
            {{if (eq @totalCount 1) 'result' 'results'}}
          {{/if}}
        </div>
      {{/unless}}
      {{#if @showOnlyLabel}}
        <label class='show-only'>
          <span class='show-only-label'>Show only
            <strong>{{@showOnlyLabel}}</strong></span>
          <BoxelInput
            @type='checkbox'
            @value={{@showOnlyChecked}}
            @onChange={{this.handleShowOnlyChange}}
            data-test-search-sheet-show-only
          />
        </label>
      {{/if}}
    </header>
    <style scoped>
      .search-sheet-section-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp) 0 var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-lg);
      }
      .icon {
        --boxel-realm-icon-size: 1.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        flex-shrink: 0;
      }
      .icon-svg {
        width: 1.5rem;
        height: 1.5rem;
      }
      .title {
        font: 600 var(--boxel-font);
      }
      .count {
        font: 500 var(--boxel-font);
        color: var(--boxel-450);
      }
      .show-only {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        cursor: pointer;
        font: var(--boxel-font-sm);
      }
      .show-only-label {
        user-select: none;
      }
    </style>
  </template>
}
