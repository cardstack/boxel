import type Owner from '@ember/owner';
import { next } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { consume } from 'ember-provide-consume-context';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import {
  GetCardsContextName,
  type getCards,
  type Query,
} from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/helpers/consume-context';

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

  @consume(GetCardsContextName) declare private getCards: getCards;

  @tracked private specResults: ReturnType<getCards> | undefined;

  private searchSpec = () => {
    this.specResults = this.getCards(
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
