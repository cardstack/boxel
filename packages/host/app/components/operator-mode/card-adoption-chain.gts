import { service } from '@ember/service';
import Component from '@glimmer/component';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';

import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { loadCard } from '@cardstack/runtime-common/code-ref';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import CardSchemaEditor from '@cardstack/host/components/operator-mode/card-schema-editor';

import { type CardType, type Type } from '@cardstack/host/resources/card-type';
import type { Ready } from '@cardstack/host/resources/file';

import LoaderService from '@cardstack/host/services/loader-service';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    file: Ready;
    cardTypeResource?: CardType;
    card: typeof BaseDef;
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

    <div class='card-adoption-chain' ...attributes>
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
    let { card, cardTypeResource } = this.args;

    await cardTypeResource!.ready;
    let cardType = cardTypeResource!.type;

    if (!cardType) {
      throw new Error('Card type not found');
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
