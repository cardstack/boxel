import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

import { getPlural, loadCard } from '@cardstack/runtime-common';

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

  <template>
    {{! The linter is unexpectedly complaining there is whitespace in this template, which is odd. Let's ignore }}
    {{! template-lint-disable no-whitespace-for-layout }}
    <div class='accordion'>
      <div
        class='accordion-item
          {{if (eq this.selectedItem "schema-editor") "opened"}}'
      >
        <button
          class='accordion-item-title'
          {{on 'click' (fn this.selectItem 'schema-editor')}}
        >
          <span class='caret'>
            {{svgJar 'dropdown-arrow-down' width='20' height='20'}}
          </span>

          Schema Editor

          <div class='total-fields' data-test-total-fields>
            <span class='total-fields-value'>{{this.totalFields}}</span>
            <span class='total-fields-label'>{{getPlural
                'Field'
                this.totalFields
              }}</span>
          </div>
        </button>

        <div class='accordion-item-content'>
          <CardAdoptionChain
            @file={{@file}}
            @cardInheritanceChain={{this.cardInheritanceChain}}
          />
        </div>
      </div>
    </div>

    <style>
      .accordion {
        background-color: var(--boxel-light);
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius-xl);
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .accordion-item {
        height: 55px; /* This should ideally be dynamic based on content but seems like a good default to accomodate for many of the tested cases  */
        cursor: pointer;
        display: flex;
        flex-direction: column;
        transition: 0.4s;
        border-top: var(--boxel-border);
      }

      .accordion-item:first-child {
        border-top: none;
      }

      .accordion-item.opened {
        height: 125px; /* This should ideally be dynamic based on content but seems like a good default to accomodate for many of the tested cases  */
        flex: 1;
      }

      .accordion-item.opened .accordion-item-content {
        transition: 0.4s;
        opacity: 1;
        overflow: auto;
        pointer-events: all;
      }

      .accordion-item.opened > .accordion-item-title > .caret {
        transform: rotate(0deg);
      }

      .accordion-item-title {
        display: flex;
        align-items: center;
        padding: var(--boxel-sp-sm);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
        border: 0;
        background-color: transparent;
      }

      .accordion-item-content {
        pointer-events: none;
        flex: 1;
        opacity: 0;
        padding: var(--boxel-sp-sm);
        background-color: var(--boxel-200);
      }

      .caret {
        --icon-color: var(--boxel-highlight);
        margin-right: var(--boxel-sp-xxxs);
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        transform: rotate(-90deg);
        transition: transform var(--boxel-transition);
        display: inline-block;
        margin-left: -4px;
      }

      .accordion :deep(.card-adoption-chain:first-child) {
        padding-top: var(--boxel-sp-xxxs);
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
