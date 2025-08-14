import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import Copy from '@cardstack/boxel-icons/copy';

import Undo2 from '@cardstack/boxel-icons/undo-2';

import { dropTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';

import {
  BoxelDropdown,
  IconButton,
  Menu,
} from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';

import { ThreeDotsHorizontal, IconCode } from '@cardstack/boxel-ui/icons';

import RestorePatchedFileModal from '@cardstack/host/components/ai-assistant/restore-file-modal';
import CardService from '@cardstack/host/services/card-service';
import MatrixService from '@cardstack/host/services/matrix-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { type FileDef } from 'https://cardstack.com/base/file-api';

import { Submodes } from '../submode-switcher';

export default class AttachedFileDropdownMenu extends Component<{
  Args: {
    file: FileDef;
    isNewFile: boolean;
    version?: 'diff-editor';
  };
}> {
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare matrixService: MatrixService;
  @service declare cardService: CardService;
  @tracked isRestorePatchedFileModalOpen = false;
  @tracked fileContent: string | null = null;
  @action private openInCodeMode() {
    if (
      this.operatorModeStateService.state.submode === Submodes.Code &&
      this.operatorModeStateService.state.codePath?.toString() ===
        this.args.file.sourceUrl
    ) {
      return;
    }
    this.operatorModeStateService.updateSubmode(Submodes.Code);
    this.operatorModeStateService.updateCodePath(
      new URL(this.args.file.sourceUrl!),
    );
  }

  copySubmittedContentTask = dropTask(async () => {
    if (this.loadFileContent.isRunning) {
      await this.loadFileContent.perform(); // Should be dropped if loading is already running
    }
    navigator.clipboard.writeText(this.fileContent!);
  });

  toggleRestorePatchedFileModal = () => {
    this.isRestorePatchedFileModalOpen = !this.isRestorePatchedFileModalOpen;
  };

  private get menuItems(): MenuItem[] {
    let submittedOrGenerated =
      this.args.version === 'diff-editor' ? 'Generated' : 'Submitted';

    const items = [
      new MenuItem('Open in Code Mode', 'action', {
        action: this.openInCodeMode,
        icon: IconCode,
        disabled: !this.args.file?.sourceUrl,
      }),
      new MenuItem(`Copy ${submittedOrGenerated} Content`, 'action', {
        action: this.copySubmittedContentTask.perform,
        icon: Copy,
        disabled: !this.args.file?.sourceUrl || this.args.isNewFile,
      }),
      new MenuItem(`Restore ${submittedOrGenerated} Content`, 'action', {
        action: this.toggleRestorePatchedFileModal,
        icon: Undo2,
        dangerous: true,
        disabled: !this.args.file?.sourceUrl || this.args.isNewFile,
      }),
    ];

    return items;
  }

  restoreContent = dropTask(async () => {
    if (this.loadFileContent.isRunning) {
      await this.loadFileContent.perform(); // Should be dropped if loading is already running
    }

    let content = this.fileContent!;

    await this.cardService.saveSource(
      new URL(this.args.file.sourceUrl!),
      content,
      'bot-patch',
    );

    this.isRestorePatchedFileModalOpen = false;
  });

  private loadFileContent = dropTask(async () => {
    if (!this.args.file?.sourceUrl) {
      return;
    }

    let response = await this.matrixService.fetchMatrixHostedFile(
      this.args.file.url,
    );
    let content = await response.text();
    this.fileContent = content;
  });

  <template>
    <style scoped>
      button.context-menu-button {
        rotate: 90deg;
        flex-shrink: 0;

        --inner-boxel-icon-button-width: 20px;
      }

      button.context-menu-button:hover {
        --icon-color: var(--boxel-highlight);
      }
    </style>
    {{#if this.isRestorePatchedFileModalOpen}}
      <ToElsewhere
        @named='modal-elsewhere'
        @send={{component
          RestorePatchedFileModal
          onConfirm=(perform this.restoreContent)
          onCancel=this.toggleRestorePatchedFileModal
          isRestoreRunning=this.restoreContent.isRunning
        }}
      />
    {{/if}}
    <BoxelDropdown>
      <:trigger as |bindings|>
        <IconButton
          data-test-attached-file-dropdown-button={{@file.name}}
          data-test-copy-file-content={{this.fileContent}}
          class='context-menu-button'
          @icon={{ThreeDotsHorizontal}}
          @height='12'
          @width='12'
          aria-label='file options'
          {{bindings}}
          {{on 'click' (perform this.loadFileContent)}}
        />
      </:trigger>
      <:content as |dd|>
        <Menu
          class='context-menu-list'
          @items={{this.menuItems}}
          @closeMenu={{dd.close}}
        />
      </:content>
    </BoxelDropdown>
  </template>
}
