import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { RealmIcon } from '@cardstack/boxel-ui/components';
import { cn, not, eq, gt } from '@cardstack/boxel-ui/helpers';

import type { RealmInfo } from '@cardstack/runtime-common';

interface Signature {
  Args: {
    realm: RealmInfo;
    resultsCount: number;
  };
}

const CardCatalogResultsHeader: TemplateOnlyComponent<Signature> = <template>
  <header class='catalog-results-header'>
    <RealmIcon
      class={{cn realm-icon--is-empty=(not @realm.iconURL)}}
      @realmInfo={{@realm}}
    />
    <span class='realm-name' data-test-realm-name>
      {{@realm.name}}
    </span>
    <span class='results-count' data-test-results-count>
      {{#if (gt @resultsCount 1)}}
        {{@resultsCount}}
        results
      {{else if (eq @resultsCount 1)}}
        1 result
      {{else if (eq @resultsCount 0)}}
        No results
      {{/if}}
    </span>
  </header>

  <style scoped>
    .catalog-results-header {
      display: flex;
      align-items: center;
      gap: var(--boxel-sp-xxs);
    }
    .realm-icon--is-empty {
      box-shadow: inset 0 0 0 1px var(--boxel-dark);
      border-radius: 50%;
    }
    .realm-name {
      display: inline-block;
      font: 600 var(--boxel-font);
      letter-spacing: var(--boxel-lsp-xs);
    }
    .results-count {
      display: inline-block;
      font: var(--boxel-font);
      letter-spacing: var(--boxel-lsp-xs);
      margin-left: var(--boxel-sp-4xs);
    }
  </style>
</template>;

export default CardCatalogResultsHeader;
