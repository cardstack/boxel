import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { Accordion } from '@cardstack/boxel-ui';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

import { getPlural, loadCard } from '@cardstack/runtime-common';

import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import CardAdoptionChain from '@cardstack/host/components/operator-mode/card-adoption-chain';
import { CardType, Type } from '@cardstack/host/resources/card-type';
import { Ready } from '@cardstack/host/resources/file';
import LoaderService from '@cardstack/host/services/loader-service';
import { calculateTotalOwnFields } from '@cardstack/host/utils/schema-editor';

import { BaseDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    file: Ready;
    cardTypeResource?: CardType;
    card: typeof BaseDef;
  };
}

type SelectedItem = 'schema-editor' | null;

export type CardInheritance = {
  cardType: Type;
  card: any;
};

export default class SchemaEditorColumn extends Component<Signature> {
  @tracked selectedItem: SelectedItem = 'schema-editor';
  @tracked cardInheritanceChain: CardInheritance[] = [];

  @service declare loaderService: LoaderService;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    this.loadInheritanceChain.perform();
  }

  @action selectItem(item: SelectedItem) {
    if (this.selectedItem === item) {
      this.selectedItem = null;
      return;
    }

    this.selectedItem = item;
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

  get totalFields() {
    return this.cardInheritanceChain.reduce(
      (total: number, data: CardInheritance) => {
        return total + calculateTotalOwnFields(data.card, data.cardType);
      },
      0,
    );
  }

  @cached
  get moduleSyntax() {
    return new ModuleSyntax(this.args.file.content);
  }

  <template>
    <Accordion class='accordion' as |A|>
      <A.Item
        class='accordion-item'
        @onClick={{fn this.selectItem 'schema-editor'}}
        @isOpen={{eq this.selectedItem 'schema-editor'}}
      >
        <:title>
          Schema Editor
          <div class='total-fields' data-test-total-fields>
            <span class='total-fields-value'>{{this.totalFields}}</span>
            <span class='total-fields-label'>{{getPlural
                'Field'
                this.totalFields
              }}</span>
          </div>
        </:title>
        <:content>
          <CardAdoptionChain
            class='accordion-content'
            @file={{@file}}
            @cardInheritanceChain={{this.cardInheritanceChain}}
            @moduleSyntax={{this.moduleSyntax}}
          />
        </:content>
      </A.Item>
    </Accordion>

    <style>
      .card-adoption-chain {
        background-color: var(--boxel-200);
        height: 100%;
        padding: var(--boxel-sp-sm);
      }
      .accordion-item:last-child {
        border-bottom: var(--boxel-border);
      }
      .accordion-content {
        padding: var(--boxel-sp-sm);
      }

      .total-fields {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xxxs);
        margin-left: auto;
      }

      .total-fields > * {
        margin: 0;
      }

      .total-fields-value {
        font: 600 var(--boxel-font);
      }

      .total-fields-label {
        font: var(--boxel-font-sm);
      }
    </style>
  </template>
}
