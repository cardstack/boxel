import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Copy from '@cardstack/boxel-icons/copy';
import Undo2 from '@cardstack/boxel-icons/undo-2';

import { dropTask } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';

import { BoxelDropdown, Button, Menu } from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { IconCode, ThreeDotsHorizontal } from '@cardstack/boxel-ui/icons';

import RestorePatchedFileModal from '@cardstack/host/components/ai-assistant/restore-patched-file-modal';

import type { CodeData } from '@cardstack/host/lib/formatted-message/utils';

import { type Message as MatrixMessage } from '@cardstack/host/lib/matrix-classes/message';
import CardService from '@cardstack/host/services/card-service';

import MatrixService from '@cardstack/host/services/matrix-service';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { CodePatchStatus } from 'https://cardstack.com/base/matrix-event';
import { Submodes } from '../../submode-switcher';

export interface CodeBlockDiffEditorHeaderSignature {
  Args: {
    codeData: Partial<CodeData>;
    diffEditorStats?: {
      linesRemoved: number;
      linesAdded: number;
    } | null;
    finalFileUrlAfterCodePatching?: string | null;
    originalUploadedFileUrl?: string | null;
    codePatchStatus: CodePatchStatus | 'applying' | 'ready';
    userMessageThisMessageIsRespondingTo?: MatrixMessage;
  };
}

export default class CodeBlockDiffEditorHeader extends Component<CodeBlockDiffEditorHeaderSignature> {
  <template>
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
    <header class='code-block-diff-header'>
      <div class='left-section'>
        <div class='mode' data-test-file-mode>
          {{if @codeData.isNewFile 'Create' 'Edit'}}
        </div>
        <BoxelDropdown>
          <:trigger as |bindings|>
            <Button
              @kind='secondary-dark'
              class='file-info-button'
              data-code-patch-dropdown-button={{this.fileName}}
              {{! including this in a test attribute because navigator.clipboard is not available in test environment }}
              data-test-copy-submitted-content={{this.submittedContent}}
              {{bindings}}
              {{! Since this content is not available to us immediately and we need to load it,
              we try to load it in advance - when the user clicks on the file dropdown. Then, when the user
              tryes to copy the content, we should have it ready. }}
              {{on 'click' (perform this.loadSubmittedContent)}}
            >
              <span class='filename' data-test-file-name>
                {{this.fileName}}
              </span>
              <ThreeDotsHorizontal
                class='context-menu-icon'
                width='12'
                height='12'
                aria-label='file options'
              />
            </Button>
          </:trigger>
          <:content as |dd|>
            <Menu
              class='context-menu-list'
              @items={{this.menuItems}}
              @closeMenu={{dd.close}}
            />
          </:content>
        </BoxelDropdown>
      </div>
      <div class='right-section'>
        {{#if @diffEditorStats}}
          <div class='changes'>
            <span
              class='removed'
              aria-label='lines removed'
              data-test-removed-lines
            >
              -{{@diffEditorStats.linesRemoved}}
            </span>
            <span class='added' aria-label='lines added' data-test-added-lines>
              +{{@diffEditorStats.linesAdded}}
            </span>
          </div>
        {{/if}}
      </div>
    </header>
    <style scoped>
      .code-block-diff-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        background-color: var(--boxel-650);
        color: var(--boxel-light);
        padding: 8px 12px;
        font-size: 14px;
        height: 50px;
      }

      .code-block-diff-header .left-section {
        display: flex;
        align-items: center;
        flex: 1;
        min-width: 0;
      }

      .mode + .file-info-button {
        margin-left: var(--boxel-sp-xs);
      }

      .file-info-button {
        --boxel-button-min-width: unset;
        --boxel-button-min-height: unset;
        --boxel-button-padding: var(--boxel-sp-xxxs);
        --boxel-button-letter-spacing: var(--boxel-lsp-xs);
        --icon-color: currentColor;
        gap: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-sm);
        max-width: 300px;
      }
      .context-menu-icon {
        rotate: 90deg;
        flex-shrink: 0;
      }
      .filename {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .code-block-diff-header .right-section {
        display: flex;
        align-items: center;
      }

      .code-block-diff-header .changes {
        display: flex;
        gap: 6px;
        font-weight: 600;
      }

      .code-block-diff-header .changes .removed {
        color: #ff5f5f;
      }

      .code-block-diff-header .changes .added {
        color: #66ff99;
      }
    </style>
  </template>

  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;
  @service private declare cardService: CardService;
  @tracked isRestorePatchedFileModalOpen = false;
  @tracked submittedContent: string | null = null;

  private loadSubmittedContent = dropTask(async () => {
    let userAttachedFiles =
      this.args.userMessageThisMessageIsRespondingTo?.attachedFiles;
    let relevantAttachedFile = userAttachedFiles?.find(
      (file) => file.sourceUrl === this.args.codeData.fileUrl,
    );

    if (!relevantAttachedFile) {
      return console.error(
        "bug: can't load content for copying submitted content: unable to figure out which attached file to load when copying submitted content",
      );
    }
    let response = await this.matrixService.fetchMatrixHostedFile(
      relevantAttachedFile.url,
    );
    let content = await response.text();
    this.submittedContent = content;
  });

  private get fileUrl() {
    return (
      this.args.finalFileUrlAfterCodePatching ?? this.args.codeData.fileUrl
    );
  }

  private get fileName() {
    return new URL(this.fileUrl ?? '').pathname.split('/').pop() || '';
  }

  private openInCodeMode = () => {
    this.operatorModeStateService.updateSubmode(Submodes.Code);
    this.operatorModeStateService.updateCodePath(new URL(this.fileUrl!));
  };

  private get menuItems(): MenuItem[] {
    const items = [
      new MenuItem('Open in Code Mode', 'action', {
        action: this.openInCodeMode,
        icon: IconCode,
      }),
    ];

    items.push(
      new MenuItem('Copy Submitted Content', 'action', {
        action: this.copySubmittedContent,
        icon: Copy,
      }),
    );

    if (
      this.args.originalUploadedFileUrl &&
      !this.args.codeData.isNewFile &&
      this.args.codePatchStatus === 'applied'
    ) {
      items.push(
        new MenuItem('Restore Content', 'action', {
          action: this.toggleRestorePatchedFileModal,
          icon: Undo2,
          dangerous: true,
        }),
      );
    }

    return items;
  }

  copySubmittedContent = async () => {
    this.copySubmittedContentTask.perform();
  };

  copySubmittedContentTask = dropTask(async () => {
    if (this.loadSubmittedContent.isRunning) {
      await this.loadSubmittedContent.perform(); // Should be dropped if loading is already running
    }
    navigator.clipboard.writeText(this.submittedContent!);
  });

  restoreContent = dropTask(async () => {
    let originalUploadedFileUrl = this.args.originalUploadedFileUrl;
    if (!originalUploadedFileUrl) {
      throw new Error('bug: originalUploadedFileUrl should be present');
    }
    let finalFileUrlAfterCodePatching = this.args.finalFileUrlAfterCodePatching;
    if (!finalFileUrlAfterCodePatching) {
      throw new Error('bug: finalFileUrlAfterCodePatching should be present');
    }

    let response = await this.matrixService.fetchMatrixHostedFile(
      originalUploadedFileUrl,
    );
    let content = await response.text();

    await this.cardService.saveSource(
      new URL(finalFileUrlAfterCodePatching!),
      content,
      'bot-patch',
    );
    this.isRestorePatchedFileModalOpen = false;
  });

  toggleRestorePatchedFileModal = () => {
    this.isRestorePatchedFileModalOpen = !this.isRestorePatchedFileModalOpen;
  };
}
