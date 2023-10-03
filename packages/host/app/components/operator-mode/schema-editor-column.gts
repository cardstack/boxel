import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Accordion } from '@cardstack/boxel-ui';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

import CardAdoptionChain from '@cardstack/host/components/operator-mode/card-adoption-chain';
import { CardType } from '@cardstack/host/resources/card-type';
import { Ready } from '@cardstack/host/resources/file';

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

export default class SchemaEditorColumn extends Component<Signature> {
  @tracked selectedItem: SelectedItem = 'schema-editor';

  @action selectItem(item: SelectedItem) {
    if (this.selectedItem === item) {
      this.selectedItem = null;
      return;
    }

    this.selectedItem = item;
  }

  <template>
    <Accordion class='accordion' as |A|>
      <A.Item
        class='accordion-item'
        @onClick={{fn this.selectItem 'schema-editor'}}
        @isOpen={{eq this.selectedItem 'schema-editor'}}
      >
        <:title>Schema Editor</:title>
        <:content>
          <CardAdoptionChain
            class='accordion-content'
            @file={{@file}}
            @card={{@card}}
            @cardTypeResource={{@cardTypeResource}}
          />
        </:content>
      </A.Item>
    </Accordion>

    <style>
      .accordion {
        height: 100%;
      }
      .accordion-item:last-child {
        border-bottom: var(--boxel-border);
      }
      .accordion-content {
        padding: var(--boxel-sp-sm);
      }
    </style>
  </template>
}
