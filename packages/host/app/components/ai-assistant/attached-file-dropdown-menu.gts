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

import { IconCode } from '@cardstack/boxel-ui/icons';

import DotsVertical from '@cardstack/boxel-icons/dots-vertical';

import { hasExecutableExtension } from '@cardstack/runtime-common';

import RestorePatchedFileModal from '@cardstack/host/components/ai-assistant/restore-file-modal';
import CardService from '@cardstack/host/services/card-service';
import MatrixService from '@cardstack/host/services/matrix-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { type FileDef } from 'https://cardstack.com/base/file-api';

import { CodePatchStatus } from 'https://cardstack.com/base/matrix-event';

import { Submodes } from '../submode-switcher';

export default class AttachedFileDropdownMenu extends Component<{
  Args: {
    file: FileDef;
    isNewFile: boolean;
    version?: 'diff-editor';
    codePatchStatus?: CodePatchStatus | 'applying' | 'ready';
    isCardInstance?: boolean;
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
      new MenuItem({
        label: 'Open in Code Mode',
        action: this.openInCodeMode,
        icon: IconCode,
        disabled: !this.args.file?.sourceUrl,
      }),
      new MenuItem({
        label: `Copy ${submittedOrGenerated} Content`,
        action: this.copySubmittedContentTask.perform,
        icon: Copy,
        disabled: !this.args.file?.sourceUrl || this.args.isNewFile,
      }),
      new MenuItem({
        label: `Restore ${submittedOrGenerated} Content`,
        action: this.toggleRestorePatchedFileModal,
        icon: Undo2,
        dangerous: true,
        disabled:
          !this.args.file?.sourceUrl ||
          this.args.isNewFile ||
          (this.args.codePatchStatus != null &&
            this.args.codePatchStatus !== 'applied'),
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
      new URL(
        this.args.isCardInstance && !this.args.file.sourceUrl!.endsWith('.json')
          ? this.args.file.sourceUrl! + '.json'
          : this.args.file.sourceUrl!,
      ),
      content,
      'bot-patch',
      { resetLoader: hasExecutableExtension(this.args.file.sourceUrl!) },
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
      .context-menu-button:hover {
        background-color: var(--boxel-highlight);
      }
      .context-menu-button[aria-expanded='true'] {
        background-color: var(--boxel-highlight-hover);
        outline-color: var(--boxel-highlight-hover);
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
          @icon={{DotsVertical}}
          @size='extra-small'
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
