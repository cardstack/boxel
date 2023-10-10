import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import {
  BoxelButton,
  BoxelInput,
  FieldContainer,
  RadioInput,
} from '@cardstack/boxel-ui';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';

import { bool, or } from '@cardstack/boxel-ui/helpers/truth-helpers';

import {
  chooseCard,
  loadCard,
  identifyCard,
  catalogEntryRef,
} from '@cardstack/runtime-common';
import type { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import ModalContainer from '@cardstack/host/components/modal-container';

import RealmInfoProvider from '@cardstack/host/components/operator-mode/realm-info-provider';
import { Ready } from '@cardstack/host/resources/file';
import LoaderService from '@cardstack/host/services/loader-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { BaseDef, FieldType } from 'https://cardstack.com/base/card-api';

import { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';

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
  @tracked chosenCatalogEntryCard: typeof BaseDef | undefined = undefined;
  @tracked fieldModuleUrl: URL | undefined = undefined;
  @tracked fieldName: string | undefined = undefined;
  @tracked cardinality: 'one' | 'many' = 'one';
  @service declare loaderService: LoaderService;
  @service declare operatorModeStateService: OperatorModeStateService;

  @action chooseCard() {
    this.chooseCardTask.perform();
  }

  @action onFieldNameInput(value: string) {
    this.fieldName = value;
  }

  @action onCardinalityChange(value: string) {
    this.cardinality = value as 'one' | 'many';
  }
  items = [
    {
      id: 'one',
      text: 'Limit to one',
    },
    {
      id: 'many',
      text: 'Allow multiple',
    },
  ];
  @tracked checkedId = this.items[0].id;
  @action onChange(id: 'one' | 'many'): void {
    this.checkedId = id;
  }

  private chooseCardTask = restartableTask(async () => {
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

      let fieldModuleUrl = new URL(
        chosenCatalogEntry.ref.module,
        chosenCatalogEntry.id,
      );
      this.fieldModuleUrl = fieldModuleUrl;
      let ref = {
        module: fieldModuleUrl.href,
        name: chosenCatalogEntry.ref.name,
      };

      this.chosenCatalogEntryCard = await loadCard(ref, {
        loader: this.loaderService.loader,
      });
    }
  });

  @action saveField() {
    if (!this.chosenCatalogEntry || !this.args.card || !this.fieldName) {
      throw new Error(
        'bug: cannot save field without a selected card and a name',
      );
    }

    let isField = this.chosenCatalogEntry.isField;

    let relationshipType: FieldType;

    if (isField) {
      relationshipType =
        this.cardinality === 'one' ? 'contains' : 'containsMany';
    } else {
      relationshipType = this.cardinality === 'one' ? 'linksTo' : 'linksToMany';
    }

    this.args.moduleSyntax.addField(
      {
        type: 'exportedName',
        name: (
          identifyCard(this.args.card)! as { module: string; name: string }
        ).name,
      },
      this.fieldName,
      this.chosenCatalogEntry.ref,
      relationshipType,
      new URL(this.chosenCatalogEntry.id),
      this.operatorModeStateService.state.codePath!,
    );

    this.writeTask.perform(this.args.moduleSyntax.code());
  }

  get nameErrorMessage() {
    if (this.fieldName) {
      if (/\s/g.test(this.fieldName)) {
        return 'Field names cannot contain spaces';
      }

      if (this.fieldName[0] === this.fieldName[0].toUpperCase()) {
        return 'Field names must start with a lowercase letter';
      }
    }

    return undefined;
  }

  get submitDisabled(): boolean {
    return bool(
      !this.fieldName ||
        !this.chosenCatalogEntry ||
        !this.chosenCatalogEntryCard ||
        this.nameErrorMessage,
    );
  }

  private writeTask = restartableTask(async (src: string) => {
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

      .pill {
        border: 1px solid var(--boxel-400);
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-xs);
        border-radius: 8px;
        background-color: white;
        font-weight: 600;
        display: inline-flex;
      }

      .pill > div {
        display: flex;
      }

      .pill > div > span {
        margin: auto;
      }

      .realm-icon {
        margin-right: var(--boxel-sp-xxxs);
      }

      .realm-icon > img {
        height: 20px;
        width: 20px;
      }

      .card-chooser-area {
        display: flex;
        min-height: 3em;
      }

      .card-chooser-area button {
        background-color: transparent;
        border: none;
        color: var(--boxel-highlight);
        font-size: var(--boxel-font-sm);
        font-weight: 600;
        height: 1em;
      }

      .card-chooser-area button.pull-right {
        margin-left: auto;
      }

      :global(.add-field-modal .boxel-field.horizontal) {
        margin-bottom: var(--boxel-sp-lg);
      }
    </style>

    <ModalContainer
      @title='Add a Field'
      @onClose={{@onClose}}
      @size='medium'
      @centered={{true}}
      class='add-field-modal'
      style={{cssVar boxel-modal-offset-top='40vh'}}
    >
      <:content>
        <FieldContainer @label='Field Type'>
          <div class='card-chooser-area'>
            {{#if this.chosenCatalogEntryCard}}
              <div class='pill'>
                <div class='realm-icon'>
                  {{#if this.fieldModuleUrl.href}}
                    <RealmInfoProvider @fileURL={{this.fieldModuleUrl.href}}>
                      <:ready as |realmInfo|>
                        <img
                          src={{realmInfo.iconURL}}
                          alt='Realm icon'
                          data-test-realm-icon-url={{realmInfo.iconURL}}
                        />
                      </:ready>
                    </RealmInfoProvider>
                  {{/if}}
                </div>
                <div>
                  <span>
                    {{this.chosenCatalogEntryCard.displayName}}
                  </span>
                </div>
              </div>
            {{/if}}

            <button
              {{on 'click' this.chooseCard}}
              class='{{if this.chosenCatalogEntryCard "pull-right"}}'
            >
              {{#if this.chosenCatalogEntryCard}}
                Change
              {{else}}
                Select a field
              {{/if}}
            </button>
          </div>

        </FieldContainer>

        <FieldContainer @label='Field name'>
          <BoxelInput
            @value={{this.fieldName}}
            @onInput={{this.onFieldNameInput}}
            @errorMessage={{this.nameErrorMessage}}
            @invalid={{bool this.nameErrorMessage}}
          />
        </FieldContainer>

        <FieldContainer @label=''>
          <RadioInput
            @groupDescription='Field cardinality'
            @items={{this.items}}
            @name='cardinality-radio'
            @checkedId={{this.checkedId}}
            style={{cssVar
              boxel-radio-input-option-padding='1em'
              boxel-radio-input-option-gap='1em'
            }}
            as |item|
          >
            <item.component @onChange={{fn this.onChange item.data.id}}>
              {{item.data.text}}
            </item.component>
          </RadioInput>
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

            <BoxelButton
              @kind='primary'
              {{on 'click' this.saveField}}
              @disabled={{or this.submitDisabled this.writeTask.isRunning}}
            >
              {{#if this.writeTask.isRunning}}
                Adding…
              {{else}}
                Add
              {{/if}}
            </BoxelButton>
          </div>
        </div>
      </:footer>
    </ModalContainer>
  </template>
}
