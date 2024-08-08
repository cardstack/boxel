import { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';

import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { WithBoundArgs } from '@glint/template';

import { trackedFunction } from 'ember-resources/util/function';
import { flatMap } from 'lodash';

import { PrerenderedCard, Query } from '@cardstack/runtime-common';

import { Format } from 'https://cardstack.com/base/card-api';

import CardService from '../services/card-service';
import LoaderService from '../services/loader-service';

const waiter = buildWaiter('prerendered-card-search:waiter');

interface PrerenderedCardComponentSignature {
  Element: undefined;
  Args: {
    card: PrerenderedCard;
    onCssLoaded?: () => void;
  };
}

// This is only exported for testing purposes. Do not use this component directly.
export class PrerenderedCardComponent extends Component<PrerenderedCardComponentSignature> {
  @service declare loaderService: LoaderService;

  constructor(
    owner: unknown,
    props: PrerenderedCardComponentSignature['Args'],
  ) {
    super(owner, props);

    this.ensureCssLoaded();
  }

  @tracked isCssLoaded = false;

  async ensureCssLoaded() {
    // cssModuleUrl is a URL-encoded string with CSS, for example: http://localhost:4201/drafts/person.gts.LnBlcnNvbi1jb250YWluZXIgeyBib3JkZXI6IDFweCBzb2xpZCBncmF5IH0.glimmer-scoped.css
    // These are created by glimmer scoped css and saved as a dependency of an instance in boxel index when the instance is indexed
    for (let cssModuleUrl of this.args.card.cssModuleUrls) {
      await this.loaderService.loader.import(cssModuleUrl); // This will be intercepted by maybeHandleScopedCSSRequest middleware in the host app which will load the css into the DOM
    }
    this.isCssLoaded = true;

    this.args.onCssLoaded?.();
  }

  <template>
    {{#if this.isCssLoaded}}
      {{htmlSafe @card.html}}
    {{/if}}
  </template>
}

interface ResultsSignature {
  Element: undefined;
  Args: {
    instances: PrerenderedCard[];
  };
  Blocks: {
    default: [
      item: WithBoundArgs<typeof PrerenderedCardComponent, 'card'>,
      cardId: string,
      index: number,
    ];
  };
}

const ResultsComponent: TemplateOnlyComponent<ResultsSignature> = <template>
  {{#each @instances as |instance i|}}
    {{yield (component PrerenderedCardComponent card=instance) instance.url i}}
  {{/each}}
</template>;

interface Signature {
  Element: undefined;
  Args: {
    query: Query;
    format: Format;
    realms: string[];
  };
  Blocks: {
    loading: [];
    response: [
      {
        count: number;
        Results: WithBoundArgs<typeof ResultsComponent, 'instances'>;
      },
    ];
  };
}

export default class PrerenderedCardSearch extends Component<Signature> {
  @service declare cardService: CardService;
  _lastSearchQuery: Query | null = null;

  private runSearch = trackedFunction(this, async () => {
    let { query, format, realms } = this.args;
    let token = waiter.beginAsync();
    try {
      let instances = flatMap(
        await Promise.all(
          realms.map(
            async (realm) =>
              await this.cardService.searchPrerendered(query, format, realm),
          ),
        ),
      );
      return { instances, isLoading: false };
    } finally {
      waiter.endAsync(token);
    }
  });

  private get searchResults() {
    return this.runSearch.value || { instances: null, isLoading: true };
  }

  <template>
    {{#if this.searchResults.isLoading}}
      {{yield to='loading'}}
    {{else}}
      {{yield
        (hash
          count=this.searchResults.instances.length
          Results=(component
            ResultsComponent instances=this.searchResults.instances
          )
        )
        to='response'
      }}
    {{/if}}
  </template>
}
