import { service } from '@ember/service';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui/components';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { Submodes } from '../../submode-switcher';
import ApplyButton, { type ApplyButtonState } from '../apply-button';
import ViewCodeButton from './view-code-button';
import CopyCodeButton from './copy-code-button';

export interface CodeBlockEditorHeaderSignature {
  Args: {
    applyButtonAction: () => void;
    applyButtonState: ApplyButtonState;
    isDisplayingCode: boolean;
    toggleViewCode: () => void;
    code: string;
    fileURL?: string;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

export default class CodeBlockEditorHeader extends Component<CodeBlockEditorHeaderSignature> {
  <template>
    <header class='code-block-header'>
      {{#if @fileURL}}
        <Button
          class='view-mode-button'
          @kind='text-only'
          {{on 'click' this.openInCodeMode}}
        >
          View in Code Mode
        </Button>
      {{/if}}
      <div class='actions'>
        <ViewCodeButton
          @isDisplayingCode={{@isDisplayingCode}}
          @toggleViewCode={{@toggleViewCode}}
        />
        {{#if @isDisplayingCode}}
          <CopyCodeButton class='copy-code-button' @code={{@code}} />
        {{/if}}
        <ApplyButton
          @actionVerb='Go'
          @state={{@applyButtonState}}
          {{on 'click' @applyButtonAction}}
          data-test-command-apply={{@applyButtonState}}
        />
      </div>
    </header>
    <style scoped>
      .code-block-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xxxs);
        background-color: var(--boxel-650);
        color: var(--boxel-light);
        padding: var(--boxel-sp-xs);
        height: 50px;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .view-mode-button {
        --boxel-button-min-height: 1.5rem;
        --boxel-button-min-width: auto;
        --boxel-button-padding: 0 var(--boxel-sp-4xs);
        --boxel-button-font: 400 var(--boxel-font-sm);
        --boxel-button-text-color: currentColor;
        border-radius: var(--boxel-border-radius-xs);
      }
      .actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .copy-code-button {
        justify-content: flex-end;
      }
    </style>
  </template>

  @service private declare operatorModeStateService: OperatorModeStateService;

  private openInCodeMode = () => {
    if (!this.args.fileURL) {
      return;
    }
    this.operatorModeStateService.updateCodePath(new URL(this.args.fileURL));
    this.operatorModeStateService.updateSubmode(Submodes.Code);
  };
}
