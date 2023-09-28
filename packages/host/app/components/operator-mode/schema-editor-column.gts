import { action } from '@ember/object';
import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Accordion } from '@cardstack/boxel-ui';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

import CardAdoptionChain from '@cardstack/host/components/operator-mode/card-adoption-chain';
import { Ready } from '@cardstack/host/resources/file';

interface Signature {
  Element: HTMLElement;
  Args: {
    file: Ready;
    importedModule: object;
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
    <Accordion class='schema-editor' as |A|>
      <A.Item
        class='a-item'
        @isOpen={{eq this.selectedItem 'schema-editor'}}
        @onClick={{fn this.selectItem 'schema-editor'}}
      >
        <:title>Schema Editor</:title>
        <:content>
          <CardAdoptionChain
            @file={{@file}}
            @importedModule={{@importedModule}}
          />
        </:content>
      </A.Item>
    </Accordion>

    <style>
      .schema-editor {
        height: 100%;
        overflow: hidden;
      }
      .a-item {
        --accordion-item-content-padding: 0;
      }
      .a-item:last-child:not(.open) {
        border-bottom: var(--boxel-border);
      }
    </style>
  </template>
}
