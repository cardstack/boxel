import type Owner from '@ember/owner';
import { next } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import type { getCards, Query } from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/helpers/consume-context';

import type StoreService from '@cardstack/host/services/store';

interface Signature {
  Args: {
    query: Query;
    realms: string[];
    createNewCard: () => void;
  };
}

export default class SpecSearch extends Component<Signature> {
  <template>
    {{consumeContext this.searchSpec}}
    {{#if this.specResults.isLoading}}
      <LoadingIndicator @color='var(--boxel-light)' />
    {{else if this.canGenerateSpec}}
      <CreateCard @createNewCard={{@createNewCard}} />
    {{/if}}
  </template>

  @service declare private store: StoreService;

  @tracked private specResults: ReturnType<getCards> | undefined;

  // Host code-submode UI searches through the store directly (uncapped). The
  // card caps live on the `@context` surfaces (`getCards` / `@context.store`),
  // which this host component does not consume.
  private searchSpec = () => {
    this.specResults = this.store.getSearchResource(
      this,
      () => this.args.query,
      () => this.args.realms,
    );
  };

  private get canGenerateSpec() {
    return (
      !this.specResults?.isLoading && this.specResults?.instances?.length === 0
    );
  }
}

interface CreateCardSignature {
  Args: {
    createNewCard: () => void;
  };
}
class CreateCard extends Component<CreateCardSignature> {
  constructor(owner: Owner, args: CreateCardSignature['Args']) {
    super(owner, args);
    // "next" here is a workaround. This code should be refactored to not mutate
    // tracked state during rendering. I'm adding the workaround instead because
    // I'm in the middle of trying to upgrade deps.
    next(() => {
      this.args.createNewCard();
    });
  }
}
