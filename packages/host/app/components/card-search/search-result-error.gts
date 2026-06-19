import Component from '@glimmer/component';

import { ExclamationCircle } from '@cardstack/boxel-ui/icons';

import type { ErrorEntry } from '@cardstack/runtime-common';

interface Signature {
  Element: HTMLElement;
  Args: {
    // The result's identity URL — the diagnostic / test hook for the row.
    cardId: string;
    // The result's display name (its realm-local path, e.g. `Person/error`),
    // shown so the tile identifies which result failed. Absent → no name line.
    name?: string;
    // The result's error doc, when one rode along on the wire (the `item`'s
    // `meta.error`). Absent for an error rendering that carried no last-known-
    // good HTML and no item — the tile then shows a generic message.
    error?: ErrorEntry;
  };
}

// The terminal rung of the `<SearchResults>` resolution chain: prefer good
// `html` → last-known-good `html` (inert) → live `item` → THIS. Rendered when a
// result is in an error state with nothing renderable left. It is inert and
// non-hydratable — no gesture is wired and no card GET ever fires from here, so
// an error result can never become live.
export default class SearchResultError extends Component<Signature> {
  private get title(): string {
    return this.args.error?.error.title ?? 'Card Error';
  }

  private get message(): string {
    return this.args.error?.error.message ?? 'This card could not be rendered.';
  }

  <template>
    <div
      class='search-result-error'
      data-test-search-result-error={{@cardId}}
      data-hydration='none'
      ...attributes
    >
      <ExclamationCircle class='icon' role='presentation' />
      <div class='content'>
        <div class='title'>{{this.title}}</div>
        {{#if @name}}
          <div class='name' data-test-instance-error-name title={{@name}}>
            {{@name}}
          </div>
        {{/if}}
        <div class='message' title={{this.message}}>{{this.message}}</div>
      </div>
    </div>
    <style scoped>
      .search-result-error {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        height: 100%;
        color: var(--boxel-error-300);
        overflow: hidden;
      }
      .icon {
        flex-shrink: 0;
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
      }
      .content {
        min-width: 0;
      }
      .title {
        font: 600 var(--boxel-font-sm);
        line-height: 1.2;
      }
      .name {
        font: 500 var(--boxel-font-xs);
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .message {
        font: var(--boxel-font-xs);
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}
