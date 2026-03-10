import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import CaptionsIcon from '@cardstack/boxel-icons/captions';
import FileCode from '@cardstack/boxel-icons/file-code';
import PlusIcon from '@cardstack/boxel-icons/plus';
import { restartableTask } from 'ember-concurrency';

import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import { chooseCard, baseCardRef, chooseFile } from '@cardstack/runtime-common';

import type { FileDef } from 'https://cardstack.com/base/file-api';

interface AttachButtonTriggerSignature {
  Element: HTMLButtonElement;
  Args: {};
}

const AttachButtonTrigger: TemplateOnlyComponent<AttachButtonTriggerSignature> =
  <template>
    <PlusIcon
      class='attach-button__trigger-icon'
      width='22px'
      height='22px'
      data-test-attach-button
    />
  </template>;

interface Signature {
  Element: HTMLDivElement;
  Args: {
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
        <div class='menu-option' data-test-attach-card-btn>
          <CaptionsIcon width='16px' height='16px' />
          <span>{{option}}</span>
        </div>
      {{else if (eq option 'Attach a File')}}
        <div class='menu-option' data-test-attach-file-btn>
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
        margin-top: var(--boxel-sp-4xs);
      }
      .attach-button:not(:disabled):hover,
      .attach-button:not(:disabled):focus:not(:focus-visible) {
        color: #e0e0e0;
      }
      .attach-button
        + :deep(
          .ember-basic-dropdown-content-wormhole-origin .attach-button__dropdown
        ) {
        border-radius: 10px;
        width: 179px;
        padding: 0;
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
    return ['Attach a Card', 'Attach a File'];
  }

  @action
  handleSelection(option: string) {
    if (option === 'Attach a Card') {
      this.onAttachCard();
    } else if (option === 'Attach a File') {
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
