import { TemplateOnlyComponent } from '@ember/component/template-only';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import CaptionsIcon from '@cardstack/boxel-icons/captions';
import FileCode from '@cardstack/boxel-icons/file-code';
import { restartableTask } from 'ember-concurrency';

import { BoxelSelect, AddButton } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import { chooseCard, baseCardRef, chooseFile } from '@cardstack/runtime-common';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import { type FileDef } from 'https://cardstack.com/base/file-api';

interface AttachButtonTriggerSignature {
  Element: HTMLButtonElement;
  Args: {};
}

const AttachButtonTrigger: TemplateOnlyComponent<AttachButtonTriggerSignature> =
  <template>
    <AddButton
      class='attach-button__trigger'
      @variant='pill'
      data-test-attach-button
      ...attributes
    />
    <style scoped>
      :deep(.ember-basic-dropdown-trigger) {
        border: none;
      }
      .attach-button__trigger {
        height: var(--attach-button-height, 22px);
        width: var(--attach-button-width, 22px);
        padding: 0;
        gap: var(--boxel-sp-xs);
        background: none;
      }
      .attach-button__trigger:hover:not(:disabled),
      .attach-button__trigger:focus:not(:disabled) {
        --icon-color: var(--boxel-600);
        color: var(--boxel-600);
        background: none;
        box-shadow: none;
      }
      .attach-button__trigger > :deep(svg > path) {
        stroke: none;
      }
    </style>
  </template>;

interface Signature {
  Element: HTMLDivElement;
  Args: {
    files: FileDef[];
    cards: CardDef[];
    chooseCard: (cardId: string) => void;
    chooseFile: (file: FileDef) => void;
  };
}

export default class AttachButton extends Component<Signature> {
  <template>
    <BoxelSelect
      @options={{this.menuOptions}}
      @selected={{undefined}}
      @onChange={{this.handleSelection}}
      @verticalPosition='above'
      @renderInPlace={{true}}
      @placeholder=''
      @searchEnabled={{false}}
      @matchTriggerWidth={{false}}
      @dropdownClass='attach-button__dropdown'
      @triggerComponent={{component AttachButtonTrigger}}
      class='attach-button'
      as |option|
    >
      {{#if (eq option 'Attach a Card')}}
        <div class='menu-option'>
          <CaptionsIcon width='16px' height='16px' />
          <span>{{option}}</span>
        </div>
      {{else if (eq option 'Choose File')}}
        <div class='menu-option'>
          <FileCode width='16px' height='16px' />
          <span>{{option}}</span>
        </div>
      {{else}}
        <span>{{option}}</span>
      {{/if}}
    </BoxelSelect>
    <style scoped>
      .attach-button {
        border: none;
      }
      .attach-button[aria-expanded='true'] :deep(.attach-button__trigger) {
        background-color: var(--boxel-dark);
        --icon-color: var(--boxel-light);
      }
      .attach-button
        + :deep(
          .ember-basic-dropdown-content-wormhole-origin .attach-button__dropdown
        ) {
        border-radius: 10px;
        width: 179px;
        padding: 10px;
        position: absolute;
        z-index: var(--boxel-layer-modal-urgent);
        min-width: 140px;
        box-shadow: 0 10px 15px 0 rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(0, 0, 0, 0.25);
      }
      .attach-button
        + :deep(
          .ember-basic-dropdown-content-wormhole-origin
            .attach-button__dropdown
            .ember-power-select-option
        ) {
        padding: 7.5px 5.5px;
        border-radius: 6px;
      }
      .menu-option {
        display: flex;
        align-items: center;
        gap: 10px;
        text-wrap: nowrap;
        font: 500 var(--boxel-font-sm);
        letter-spacing: 0.2px;
      }
    </style>
  </template>

  get menuOptions(): string[] {
    return ['Attach a Card', 'Choose File'];
  }

  @action
  handleSelection(option: string) {
    if (option === 'Attach Card') {
      this.onAttachCard();
    } else if (option === 'Choose File') {
      this.onChooseFile();
    }
  }

  @action
  onAttachCard() {
    this.chooseCardTask.perform();
  }

  @action
  onChooseFile() {
    this.doChooseFile.perform();
  }

  private chooseCardTask = restartableTask(async () => {
    let cardId = await chooseCard({
      filter: { type: baseCardRef },
    });
    if (cardId) {
      this.args.chooseCard(cardId);
    }
  });

  private doChooseFile = restartableTask(async () => {
    let chosenFile: FileDef | undefined = await chooseFile();
    if (chosenFile) {
      this.args.chooseFile(chosenFile);
    }
    return chosenFile;
  });
}
