import { array } from '@ember/helper';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { BoxelDropdown, Button, Menu } from '@cardstack/boxel-ui/components';
import { menuItem } from '@cardstack/boxel-ui/helpers';
import { IconCode, ThreeDotsHorizontal } from '@cardstack/boxel-ui/icons';

import type { CodeData } from '@cardstack/host/lib/formatted-message/utils';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

export interface CodeBlockDiffEditorHeaderSignature {
  Args: {
    codeData: Partial<CodeData>;
    diffEditorStats?: {
      linesRemoved: number;
      linesAdded: number;
    } | null;
    finalFileUrlAfterCodePatching?: string | null;
  };
}

export default class CodeBlockDiffEditorHeader extends Component<CodeBlockDiffEditorHeaderSignature> {
  <template>
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
              {{bindings}}
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
              @items={{array
                (menuItem 'Open in Code Mode' this.openInCodeMode icon=IconCode)
              }}
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

  private get fileUrl() {
    return (
      this.args.finalFileUrlAfterCodePatching ?? this.args.codeData.fileUrl
    );
  }

  private get fileName() {
    return new URL(this.fileUrl ?? '').pathname.split('/').pop() || '';
  }

  private openInCodeMode = () => {
    this.operatorModeStateService.updateCodePath(new URL(this.fileUrl!));
  };
}
