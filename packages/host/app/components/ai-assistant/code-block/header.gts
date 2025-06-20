import { array } from '@ember/helper';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import {
  BoxelDropdown,
  IconButton,
  Menu,
} from '@cardstack/boxel-ui/components';
import { menuItem } from '@cardstack/boxel-ui/helpers';
import { IconCode, ThreeDotsHorizontal } from '@cardstack/boxel-ui/icons';

import type { CodeData } from '@cardstack/host/lib/formatted-message/utils';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

export interface CodeBlockHeaderSignature {
  Args: {
    codeData: Partial<CodeData>;
    diffEditorStats?: {
      linesRemoved: number;
      linesAdded: number;
    } | null;
    finalFileUrlAfterCodePatching?: string | null;
  };
}

export default class CodeBlockHeader extends Component<CodeBlockHeaderSignature> {
  <template>
    <div class='code-block-diff-header'>
      <div class='left-section'>
        <div class='mode' data-test-file-mode>
          {{if @codeData.isNewFile 'Create' 'Edit'}}
        </div>
        <BoxelDropdown @contentClass=''>
          <:trigger as |bindings|>
            <button
              class='file-info'
              data-code-patch-dropdown-button={{this.fileName}}
              {{bindings}}
            >

              <span
                class='filename'
                data-test-file-name
              >{{this.fileName}}</span>
              <IconButton
                class='context-menu-trigger'
                @icon={{ThreeDotsHorizontal}}
                aria-label='field options'
                {{! @glint-ignore  Argument of type 'unknown' is not assignable to parameter of type 'Element'}}
                ...attributes
              />
            </button>
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
            <span class='removed' data-test-removed-lines>
              -{{@diffEditorStats.linesRemoved}}
            </span>
            <span class='added' data-test-added-lines>
              +{{@diffEditorStats.linesAdded}}
            </span>
          </div>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .code-block-diff-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background-color: #2c2c3c;
        color: #ffffff;
        padding: 8px 12px;
        font-size: 14px;
        height: 50px;
      }

      .code-block-diff-header .left-section {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
      }

      .code-block-diff-header .file-info {
        padding: 4px 8px;
        border: 1px solid;
        border-radius: 5px;
        border-color: #5c5d5e;
        background: transparent;
        color: #f7f7f7;
        display: flex;
        align-items: center;
        gap: 8px;
        width: fit-content;
        max-width: 100%;
        min-width: 0;
        margin-right: var(--boxel-sp-xs);
      }

      .file-info:hover {
        border-color: #ffffff;
      }

      .code-block-diff-header .file-info .filename {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 300px;
      }

      .code-block-diff-header .file-info .edit-icon {
        background-color: #f44a1c;
        border-radius: 4px;
        padding: 2px 6px;
        font-weight: bold;
        color: #ffffff;
      }

      .code-block-diff-header .file-info .more-options {
        background: none;
        border: none;
        color: var(--boxel-300);
        padding: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
      }

      .code-block-diff-header .file-info .more-options:hover {
        color: #ffffff;
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

      .mode {
        color: var(--boxel-300);
      }

      .context-menu-trigger {
        rotate: 90deg;
        --boxel-icon-button-width: 14px;
        --boxel-icon-button-height: 14px;
      }
      .context-menu-trigger {
        --icon-color: #f7f7f7;
      }

      .context-menu-trigger:hover {
        --icon-color: #ffffff;
      }
    </style>
  </template>

  @service private declare operatorModeStateService: OperatorModeStateService;
  get fileUrl() {
    return (
      this.args.finalFileUrlAfterCodePatching ?? this.args.codeData.fileUrl
    );
  }

  get fileName() {
    return new URL(this.fileUrl ?? '').pathname.split('/').pop() || '';
  }

  openInCodeMode = () => {
    this.operatorModeStateService.updateCodePath(new URL(this.fileUrl!));
  };
}
