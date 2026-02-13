import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { eq } from '@cardstack/boxel-ui/helpers';

import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    icon?: ComponentLike<{ Element: Element }>;
    iconURL?: string;
    title: string;
    totalCount: number;
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
    <div
      class='search-sheet-section-header'
      data-test-search-sheet-section-header
    >
      <div class='icon'>
        {{#if @iconURL}}
          <img src={{@iconURL}} alt='' class='realm-image' />
        {{else if @icon}}
          {{#let @icon as |IconComponent|}}
            <IconComponent class='icon-svg' />
          {{/let}}
        {{/if}}
      </div>
      <div class='title'>{{@title}}</div>
      <div
        class='count'
        data-test-search-sheet-section-count
        data-test-results-count
      >
        {{@totalCount}}
        {{if (eq @totalCount 1) 'result' 'results'}}
      </div>
      {{#if @showOnlyLabel}}
        <label class='show-only'>
          <input
            type='checkbox'
            checked={{@showOnlyChecked}}
            {{on 'change' this.handleShowOnlyChange}}
            data-test-search-sheet-show-only
          />
          <span class='show-only-label'>Show only
            <strong>{{@showOnlyLabel}}</strong></span>
        </label>
      {{/if}}
    </div>
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
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        flex-shrink: 0;
      }
      .realm-image {
        width: 100%;
        height: 100%;
        object-fit: contain;
        border-radius: var(--boxel-border-radius-sm);
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
