import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { bool } from '@cardstack/boxel-ui/helpers';

import type { CodeData } from '@cardstack/host/lib/formatted-message/utils';

import type { Message as MatrixMessage } from '@cardstack/host/lib/matrix-classes/message';
import type CardService from '@cardstack/host/services/card-service';

import type MatrixService from '@cardstack/host/services/matrix-service';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type { FileDef } from 'https://cardstack.com/base/file-api';
import type { CodePatchStatus } from 'https://cardstack.com/base/matrix-event';

import AttachedFileDropdownMenu from '../attached-file-dropdown-menu';

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
    codePatchErrorMessage?: string | null;
    userMessageThisMessageIsRespondingTo?: MatrixMessage;
  };
}

export default class CodeBlockDiffEditorHeader extends Component<CodeBlockDiffEditorHeaderSignature> {
  <template>
    <header class='code-block-diff-header'>
      <div class='left-section'>

        <div class='mode' data-test-file-mode>
          {{if @codeData.isNewFile 'Create' 'Edit'}}
        </div>

        <div class='file-info-area'>
          <div class='filename' data-test-file-name>
            {{this.fileName}}
          </div>

          <div class='dropdown-container'>
            <AttachedFileDropdownMenu
              @file={{this.file}}
              @isNewFile={{bool @codeData.isNewFile}}
              @codePatchStatus={{@codePatchStatus}}
              @version='diff-editor'
            />
          </div>
        </div>
      </div>
      <div class='right-section'>
        {{#if this.showStats}}
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

      .mode + .file-info-area {
        margin-left: var(--boxel-sp-xs);
      }

      .file-info-area {
        border-radius: var(--boxel-border-radius-sm);
        max-width: 300px;
        border: 1px solid #b4b4b4;
        padding: var(--boxel-sp-xxxs);
        max-height: 30px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xxxs);
        position: relative;
        --icon-color: #ffffff;
      }

      .dropdown-container {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        width: 20px;
        justify-content: center;
      }

      .file-info-area :global(.boxel-dropdown) {
        flex-shrink: 0;
        position: relative;
      }
      .context-menu-icon {
        rotate: 90deg;
        flex-shrink: 0;
      }
      .filename {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 1;
        min-width: 0;
        font-weight: 700;
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

  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private matrixService: MatrixService;
  @service declare private cardService: CardService;

  private get showStats() {
    return !!this.args.diffEditorStats && !this.args.codePatchErrorMessage;
  }

  private get fileUrl() {
    return (
      this.args.finalFileUrlAfterCodePatching ?? this.args.codeData.fileUrl
    );
  }

  @cached
  private get file() {
    let relevantAttachedFile =
      this.args.userMessageThisMessageIsRespondingTo?.attachedFiles?.find(
        (file) => file.sourceUrl === this.args.codeData.fileUrl,
      );

    if (relevantAttachedFile) {
      return relevantAttachedFile;
    }

    return {
      sourceUrl: this.sourceUrl ?? '',
      url: this.fileUrl ?? '',
      name: this.fileName,
    } as FileDef;
  }

  private get fileName() {
    return new URL(this.fileUrl ?? '').pathname.split('/').pop() || '';
  }

  private get sourceUrl(): string | null {
    let isNewFile = this.args.codeData.isNewFile;
    let isApplied = this.args.codePatchStatus === 'applied';
    if (isNewFile && isApplied) {
      return this.args.finalFileUrlAfterCodePatching ?? null;
    }
    if (!isNewFile) {
      return this.args.codeData.fileUrl ?? null;
    }

    return null;
  }
}
