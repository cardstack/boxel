import { service } from '@ember/service';
import Component from '@glimmer/component';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';

import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { loadCard } from '@cardstack/runtime-common/code-ref';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import CardSchemaEditor from '@cardstack/host/components/operator-mode/card-schema-editor';
import { getCardType } from '@cardstack/host/resources/card-type';
import { type Type } from '@cardstack/host/resources/card-type';
import type { Ready } from '@cardstack/host/resources/file';

import LoaderService from '@cardstack/host/services/loader-service';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    file: Ready;
    importedModule: Record<string, any>;
  };
}

export default class CardAdoptionChain extends Component<Signature> {
  <template>
    <style>
      .card-adoption-chain {
        height: 100%;
        background-color: var(--boxel-200);
        overflow-y: auto;
      }
    </style>

    <div class='card-adoption-chain'>
      {{#each this.cardInheritanceChain as |data|}}
        <CardSchemaEditor
          @card={{data.card}}
          @cardType={{data.cardType}}
          @file={{@file}}
          @moduleSyntax={{this.moduleSyntax}}
        />
      {{/each}}
    </div>
  </template>

  @service declare loaderService: LoaderService;
  @tracked cardInheritanceChain: {
    cardType: Type;
    card: any;
  }[] = [];

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    this.loadInheritanceChain.perform();
  }

  @cached
  get moduleSyntax() {
    return new ModuleSyntax(this.args.file.content);
  }

  loadInheritanceChain = restartableTask(async () => {
    let fileUrl = this.args.file.url;
    let module = this.args.importedModule;

    let card = cardsFromModule(module)[0]; // TODO: this must come from the export selection in the left column
    let cardTypeResource = getCardType(this, () => card);
    await cardTypeResource.ready;

    let cardType = cardTypeResource.type;
    if (!cardType) {
      throw new Error(
        `Bug: should never get here because we waited for it to be ready`,
      );
    }

    // Chain goes from most specific to least specific
    let cardInheritanceChain = [
      {
        cardType,
        card,
      },
    ];

    while (cardType.super) {
      cardType = cardType.super;

      let superCard = await loadCard(cardType.codeRef, {
        loader: this.loaderService.loader,
        relativeTo: new URL(fileUrl), // because the module can be relative
      });

      cardInheritanceChain.push({
        cardType,
        card: superCard,
      });
    }

    this.cardInheritanceChain = cardInheritanceChain;
  });
}

function cardsFromModule(
  module: Record<string, any>,
  _never?: never,
): (typeof BaseDef)[] {
  return Object.values(module).filter(
    (maybeCard) => typeof maybeCard === 'function' && 'baseDef' in maybeCard,
  );
}
