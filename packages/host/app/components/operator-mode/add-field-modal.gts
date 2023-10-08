import ModalContainer from '@cardstack/host/components/modal-container';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { BoxelButton, BoxelInput, FieldContainer } from '@cardstack/boxel-ui';
import { restartableTask, task, timeout, all } from 'ember-concurrency';

import {
  chooseCard,
  baseCardRef,
  baseRealm,
  loadCard,
  identifyCard,
  catalogEntryRef,
} from '@cardstack/runtime-common';
import { tracked, cached } from '@glimmer/tracking';

import LoaderService from '@cardstack/host/services/loader-service';
import {
  BaseDef,
  CardDef,
  FieldDef,
  FieldType,
} from 'https://cardstack.com/base/card-api';
import { Ready } from '@cardstack/host/resources/file';

import type { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';
import { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

interface Signature {
  Args: {
    file: Ready;
    card: typeof BaseDef;
    moduleSyntax: ModuleSyntax;
    onClose: () => void;
  };
}

export default class AddFieldModal extends Component<Signature> {
  @tracked chosenCatalogEntry: CatalogEntry | undefined = undefined;
  @tracked newFieldName: string | undefined = undefined;
  @tracked cardinality: 'one' | 'many' = 'one';
  @service declare loaderService: LoaderService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @action chooseCard() {
    this.doChooseCard.perform();
  }

  @action onNewFieldNameInput(value: string) {
    this.newFieldName = value;
  }

  @action onCardinalityChange(value: string) {
    this.cardinality = value as 'one' | 'many';
  }

  isCardDef(card: any): card is typeof CardDef {
    return !('isFieldDef' in card) && isBaseDef(card);
  }

  @cached
  get ref() {
    let ref = identifyCard(this.args.card);
    if (!ref) {
      throw new Error(`bug: unable to identify card ${this.args.card.name}`);
    }
    return ref as { module: string; name: string };
  }

  private doChooseCard = restartableTask(async () => {
    let chosenCatalogEntry = await chooseCard<CatalogEntry>({
      filter: {
        any: [
          {
            type: catalogEntryRef,
          },
        ],
      },
    });

    if (chosenCatalogEntry) {
      this.chosenCatalogEntry = chosenCatalogEntry;
    }
  });

  @action onClose() {
    debugger;
  }

  // todo remove asyunc - use task
  @action async saveField() {
    let isField = this.chosenCatalogEntry.isField;

    let relationshipType: FieldType;

    if (isField) {
      relationshipType =
        this.cardinality === 'one' ? 'contains' : 'containsMany';
    } else {
      relationshipType = this.cardinality === 'one' ? 'linksTo' : 'linksToMany';
    }

    this.args.moduleSyntax.addField(
      { type: 'exportedName', name: identifyCard(this.args.card).name },
      this.newFieldName,
      this.chosenCatalogEntry.ref,
      relationshipType,
      new URL(this.chosenCatalogEntry.id),
      this.operatorModeStateService.state.codePath,
    );

    await this.write.perform(this.args.moduleSyntax.code());
  }

  private write = restartableTask(async (src: string) => {
    // note that this write will cause the component to rerender, so
    // any code after this write will not be executed since the component will
    // get torn down before subsequent code can execute
    this.args.file.write(src, true);
  });

  <template>
    <style>
      .footer-buttons {
        display: flex;
        height: 100%;
      }
      .footer-buttons > div {
        margin-top: auto;
        margin-bottom: auto;
        margin-left: auto;
      }

      /* TODO fix this */
      :global(.add-field-modal .dialog-box) {
        height: 60% !important;
        margin-top: 40% !important;
      }
    </style>

    <ModalContainer
      @title='Add a Field'
      @onClose={{@onClose}}
      @size='small'
      class='add-field-modal'
    >
      <:content>
        <FieldContainer @label='Field Type'>
          {{#if this.chosenCatalogEntry}}
            {{this.chosenCatalogEntry.title}}
          {{/if}}

          <button {{on 'click' this.chooseCard}}>
            Choose card
          </button>

        </FieldContainer>

        <FieldContainer @label='Field name'>
          <BoxelInput
            @value={{this.newFieldName}}
            @onInput={{this.onNewFieldNameInput}}
          />
        </FieldContainer>

        <FieldContainer @label='Field cardinality'>
          <div>
            <label for='one'>Limit to one</label>
            <input
              type='radio'
              id='one'
              name='cardinality'
              value='one'
              {{on 'change' this.onCardinalityChange}}
            />

            <label for='many'>Allow multiple</label>
            <input
              type='radio'
              id='many'
              name='cardinality'
              value='many'
              {{on 'change' this.onCardinalityChange}}
            />
          </div>
        </FieldContainer>

      </:content>

      <:footer>
        <div class='footer-buttons'>

          <div>
            <BoxelButton
              @kind='secondary-light'
              {{on 'click' this.args.onClose}}
            >
              Cancel
            </BoxelButton>

            <BoxelButton @kind='primary' {{on 'click' this.saveField}}>
              Add
            </BoxelButton>
          </div>
        </div>
      </:footer>
    </ModalContainer>
  </template>
}
