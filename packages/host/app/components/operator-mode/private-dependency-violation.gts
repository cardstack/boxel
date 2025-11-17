import Component from '@glimmer/component';

import pluralize from 'pluralize';

import type { PrivateDependencyViolation } from '@cardstack/host/services/realm';

interface Signature {
  Element: HTMLLIElement;
  Args: {
    violation: PrivateDependencyViolation;
    privateRealmURLs: string[];
  };
}

export default class PrivateDependencyViolationComponent extends Component<Signature> {
  get hasPrivateRealmDependencies() {
    return this.args.privateRealmURLs.length > 0;
  }

  <template>
    <li
      class='violation'
      data-test-private-dependency-resource={{@violation.resource}}
    >
      <span class='resource'>{{@violation.resource}}</span>
      {{#if this.hasPrivateRealmDependencies}}
        <div class='realm-list'>
          Private
          {{pluralize 'workspace' @privateRealmURLs.length}}:
          {{#each @privateRealmURLs as |realmURL|}}
            <span class='realm' data-test-private-dependency-realm={{realmURL}}>
              {{realmURL}}
            </span>
          {{/each}}
        </div>
      {{/if}}
    </li>

    <style scoped>
      .violation {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxxs);
        padding: var(--boxel-sp-xxs) 0;
        font-size: var(--boxel-font-size-sm);
        word-break: break-word;
        overflow-wrap: anywhere;
      }

      .violation:first-child {
        border-top: none;
      }

      .resource {
        font-weight: var(--boxel-font-weight-bold);
      }

      .realm-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxxs);
      }

      .realm {
        background: rgba(0, 0, 0, 0.04);
        border: 1px solid var(--boxel-150);
        border-radius: var(--boxel-border-radius-xs);
        color: var(--boxel-550);
        padding: 2px var(--boxel-sp-xxs);
        font-size: var(--boxel-font-size-xs);
        white-space: nowrap;
      }
    </style>
  </template>
}
