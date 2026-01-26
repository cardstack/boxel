import { fn } from '@ember/helper';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import focusTrap from 'ember-focus-trap/modifiers/focus-trap';
import onKeyMod from 'ember-keyboard/modifiers/on-key';

import {
  BoxelButton,
  BoxelInput,
  FieldContainer,
  RadioInput,
} from '@cardstack/boxel-ui/components';
import { bool, cssVar } from '@cardstack/boxel-ui/helpers';

import {
  chooseCard,
  loadCardDef,
  identifyCard,
  specRef,
  type CodeRef,
  isCardInstance,
  moduleFrom,
} from '@cardstack/runtime-common';

import type { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import ModalContainer from '@cardstack/host/components/modal-container';
import type { Ready } from '@cardstack/host/resources/file';

import {
  getCodeRefFromType,
  type FieldOfType,
} from '@cardstack/host/services/card-type-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type RealmService from '@cardstack/host/services/realm';
import type StoreService from '@cardstack/host/services/store';

import type { BaseDef, FieldType } from 'https://cardstack.com/base/card-api';
import type { Spec } from 'https://cardstack.com/base/spec';

import { SelectedTypePill } from './create-file-modal';

interface Signature {
  Args: {
    file: Ready;
    card: typeof BaseDef;
    moduleSyntax: ModuleSyntax;
    field?: FieldOfType;
    onClose: () => void;
  };
}

export default class EditFieldModal extends Component<Signature> {
  @tracked fieldCard: typeof BaseDef | undefined = undefined;
  @tracked fieldModuleURL: URL | undefined = undefined;
  @tracked fieldName: string | undefined = undefined;
  @tracked cardinality: 'one' | 'many' = 'one';
  @tracked isFieldDef: boolean | undefined = undefined;
  @tracked cardURL: URL | undefined = undefined;
  @tracked fieldRef: CodeRef | undefined = undefined;

  @tracked fieldNameErrorMessage: string | undefined;
  @service declare loaderService: LoaderService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private store: StoreService;

  cardinalityItems = [
    {
      id: 'one',
      text: 'Limit to one',
    },
    {
      id: 'many',
      text: 'Allow multiple',
    },
  ];

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);

    // This component has 2 flows - adding a new field, and editing an existing field. When adding a new field, this.args.field will be undefined and when editing, it will be present

    this.setInitialValues.perform();
  }

  get isNewField(): boolean {
    return !this.args.field;
  }

  get fieldType(): FieldType {
    if (this.isFieldDef) {
      return this.cardinality === 'one' ? 'contains' : 'containsMany';
    } else {
      return this.cardinality === 'one' ? 'linksTo' : 'linksToMany';
    }
  }

  @action chooseCard() {
    this.chooseCardTask.perform();
  }

  @action onFieldNameInput(value: string) {
    this.fieldName = value;
    this.validateFieldName();
  }

  @action onCardinalityChange(id: 'one' | 'many') {
    this.cardinality = id;
  }

  private setInitialValues = restartableTask(async () => {
    let field = this.args.field;

    // When adding a new field, we want to default to the base string card
    if (!field) {
      let ref = {
        module: 'https://cardstack.com/base/card-api', // This seems fundamental enough to be hardcoded
        name: 'StringField',
      };
      this.isFieldDef = true;

      try {
        this.fieldCard = await loadCardDef(ref, {
          loader: this.loaderService.loader,
        });
      } catch (error) {
        console.error("Couldn't load default string card (from base realm)");
        throw error;
      }

      this.fieldModuleURL = new URL(ref.module);
      this.cardURL = new URL(ref.module);
      this.fieldRef = ref;
      return;
    }

    this.fieldName = field.name;
    this.cardinality = ['containsMany', 'linksToMany'].includes(field.type)
      ? 'many'
      : 'one';

    let ref = getCodeRefFromType(field);

    if (ref) {
      this.fieldCard = await loadCardDef(ref, {
        loader: this.loaderService.loader,
      });

      let moduleRef = moduleFrom(ref);
      this.fieldModuleURL = new URL(moduleRef);
      this.cardURL = new URL(moduleRef);
      this.fieldRef = ref;

      // Field's card can descend from a FieldDef or a CardDef, so we need to determine which one it is. We do this by checking the field's type -
      // contains/containsMany is a FieldDef, and linksTo/linksToMany is a CardDef. When spawning the card chooser, the spec will have the isField property set,
      // which dictates the field type. But at this point where we are editing an existing field, we don't have the spec available, so we need to determine isFieldDef
      // from the field's type
      this.isFieldDef =
        this.determineFieldOrCardFromFieldType(field.type) === 'field';
    }
  });

  private chooseCardTask = restartableTask(async () => {
    let specId = await chooseCard({
      filter: {
        type: specRef,
      },
    });

    if (specId) {
      let spec = await this.store.get<Spec>(specId);
      if (spec && isCardInstance<Spec>(spec)) {
        this.fieldCard = await loadCardDef(spec.ref, {
          loader: this.loaderService.loader,
          relativeTo: new URL(specId),
        });

        this.isFieldDef = spec.isField;
        this.cardURL = new URL(spec.id);
        this.fieldRef = spec.ref;

        // This transforms relative module paths, such as "../person", to absolute ones -
        // we need that absolute path to load realm info
        this.fieldModuleURL = new URL(spec.ref.module, spec.id);
      }
    }
  });

  private determineFieldOrCardFromFieldType(
    fieldType: FieldType,
  ): 'field' | 'card' {
    if (fieldType === 'contains' || fieldType === 'containsMany') {
      return 'field';
    } else {
      return 'card';
    }
  }

  @action saveField() {
    if (!this.args.card || !this.fieldName) {
      throw new Error(
        'bug: cannot save field without a selected card and a name',
      );
    }

    let cardBeingModified = identifyCard(this.args.card)!;
    let addFieldAtIndex = undefined;

    if (!this.isNewField) {
      // We are editing a field, so we need to first remove the old one, and then add the new one
      addFieldAtIndex = this.args.moduleSyntax.removeField(
        cardBeingModified,
        this.args.field!.name,
      );
    }

    let { fieldName, fieldRef, fieldType, cardURL: incomingRelativeTo } = this;
    try {
      this.args.moduleSyntax.addField({
        cardBeingModified,
        fieldName,
        fieldRef: fieldRef as { module: string; name: string },
        fieldType,
        fieldDefinitionType: this.isFieldDef ? 'field' : 'card',
        incomingRelativeTo,
        outgoingRelativeTo: new URL(
          this.operatorModeStateService.state.codePath!,
        ),
        outgoingRealmURL: new URL(this.args.file.realmURL),
        addFieldAtIndex,
      });
    } catch (error) {
      let errorMessage = (error as Error).message;
      if (errorMessage.includes('already exists')) {
        // message example: "the field "firstName" already exists"
        this.fieldNameErrorMessage = errorMessage;
      }
      console.log(error);
      return;
    }

    this.writeTask.perform(this.args.moduleSyntax.code());
  }

  validateFieldName() {
    this.fieldNameErrorMessage = undefined;

    if (/\s/g.test(this.fieldName!)) {
      this.fieldNameErrorMessage = 'Field names cannot contain spaces';
      return;
    }

    if (this.fieldName![0] === this.fieldName![0].toUpperCase()) {
      this.fieldNameErrorMessage =
        'Field names must start with a lowercase letter';
      return;
    }

    if (!/^[a-z0-9_]+$/i.test(this.fieldName!)) {
      this.fieldNameErrorMessage =
        'Field names can only contain letters, numbers, and underscores';
      return;
    }
  }

  get submitDisabled(): boolean {
    return bool(
      !this.fieldName ||
        !this.fieldCard ||
        this.fieldNameErrorMessage ||
        this.writeTask.isRunning,
    );
  }

  private writeTask = restartableTask(async (src: string) => {
    // note that this write will cause the component to rerender, so
    // any code after this write will not be executed since the component will
    // get torn down before subsequent code can execute

    await this.args.file.write(src, { flushLoader: true });
    this.args.onClose();
  });

  <template>
    <style scoped>
      .edit-field-modal {
        --horizontal-gap: var(--boxel-sp-xs);
      }
      .edit-field-modal > :deep(.boxel-modal__inner) {
        display: flex;
      }
      :deep(.edit-field) {
        height: 32rem;
      }
      .field + .field {
        margin-top: var(--boxel-sp-sm);
      }
      .field {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxxs) var(--horizontal-gap);
      }
      .field :deep(.label-container) {
        width: 8rem;
      }
      .field :deep(.content) {
        flex-grow: 1;
        max-width: 100%;
        min-width: 13rem;
      }
      .card-chooser-area {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--horizontal-gap);
      }
      .footer-buttons {
        display: flex;
        margin-left: auto;
        gap: var(--horizontal-gap);
        align-self: center;
      }
      fieldset.field {
        border: none;
        padding: 0;
        margin-inline: 0;
      }
    </style>

    <ModalContainer
      @title={{if this.isNewField 'Add field' 'Edit field settings'}}
      @onClose={{@onClose}}
      @size='medium'
      @centered={{true}}
      {{focusTrap
        focusTrapOptions=(hash
          initialFocus='.edit-field-modal input' allowOutsideClick=true
        )
      }}
      @cardContainerClass='edit-field'
      class='edit-field-modal'
      data-test-edit-field-modal
    >
      <:content>
        <FieldContainer class='field' @label='Field Type'>
          <div class='card-chooser-area'>
            {{#if this.fieldCard.displayName}}
              {{#if this.fieldModuleURL.href}}
                <SelectedTypePill
                  @title={{this.fieldCard.displayName}}
                  @id={{this.fieldModuleURL.href}}
                />
              {{/if}}
            {{/if}}

            <BoxelButton
              @kind='text-only'
              @size='small'
              {{on 'click' this.chooseCard}}
              class='change {{if this.fieldCard "pull-right"}}'
              data-test-choose-card-button
            >
              Change
            </BoxelButton>
          </div>
        </FieldContainer>
        <FieldContainer class='field' @label='Field Name' @tag='label'>
          <BoxelInput
            @value={{this.fieldName}}
            @onInput={{this.onFieldNameInput}}
            @errorMessage={{this.fieldNameErrorMessage}}
            @state={{if (bool this.fieldNameErrorMessage) 'invalid' 'none'}}
            data-test-field-name-input
          />
        </FieldContainer>
        <FieldContainer class='field' @tag='fieldset'>
          <legend class='boxel-sr-only'>Field Cardinality</legend>
          <RadioInput
            @groupDescription='Field cardinality'
            @items={{this.cardinalityItems}}
            @name='cardinality-radio'
            @checkedId={{this.cardinality}}
            style={{cssVar
              boxel-radio-input-option-padding='1em'
              boxel-radio-input-option-gap='1em'
            }}
            as |item|
          >
            <item.component
              @onChange={{fn this.onCardinalityChange item.data.id}}
            >
              {{item.data.text}}
            </item.component>
          </RadioInput>
        </FieldContainer>
      </:content>
      <:footer>
        <div class='footer-buttons'>
          <BoxelButton
            @size='tall'
            {{on 'click' @onClose}}
            {{onKeyMod 'Escape'}}
            data-test-cancel-adding-field-button
          >
            Cancel
          </BoxelButton>
          <BoxelButton
            @kind='primary'
            @size='tall'
            {{on 'click' this.saveField}}
            {{onKeyMod 'Enter'}}
            @disabled={{this.submitDisabled}}
            data-test-save-field-button
          >
            {{#if this.writeTask.isRunning}}
              {{#if this.isNewField}}
                Adding…
              {{else}}
                Saving…
              {{/if}}
            {{else}}
              {{#if this.isNewField}}
                Add
              {{else}}
                Save
              {{/if}}
            {{/if}}
          </BoxelButton>
        </div>
      </:footer>
    </ModalContainer>
  </template>
}
