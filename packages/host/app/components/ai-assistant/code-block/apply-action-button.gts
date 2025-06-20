import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import type { CodePatchStatus } from 'https://cardstack.com/base/matrix-event';

import type { CodeData } from '@cardstack/host/lib/formatted-message/utils';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import ApplyButton from '../apply-button';

export interface ApplyCodePatchButtonSignature {
  Args: {
    patchCodeStatus: CodePatchStatus | 'ready' | 'applying' | 'preparing';
    performPatch?: () => void;
    codeData?: CodeData;
    originalCode?: string | null;
    modifiedCode?: string | null;
    actionVerb?: string;
  };
  Element: HTMLButtonElement | HTMLDivElement;
}

export default class ApplyCodePatchButton extends Component<ApplyCodePatchButtonSignature> {
  <template>
    {{#if this.debugButtonEnabled}}
      <button {{on 'click' this.logCodePatchAction}} class='debug-button'>
        👁️
      </button>
    {{/if}}

    <ApplyButton
      @state={{@patchCodeStatus}}
      {{on 'click' this.performPatch}}
      data-test-apply-code-button
      data-test-command-apply={{@patchCodeStatus}}
      ...attributes
    >
      {{if @actionVerb @actionVerb 'Apply'}}
    </ApplyButton>

    <style scoped>
      .debug-button {
        background: transparent;
        border: none;
        margin-right: 5px;
      }
    </style>
  </template>

  @service declare operatorModeStateService: OperatorModeStateService;

  // This is for debugging purposes only
  logCodePatchAction = () => {
    if (!this.args.codeData) {
      return;
    }
    console.log('fileUrl \n', this.args.codeData.fileUrl);
    console.log('searchReplaceBlock \n', this.args.codeData.searchReplaceBlock);
    console.log('originalCode \n', this.args.originalCode);
    console.log('modifiedCode \n', this.args.modifiedCode);
  };

  get debugButtonEnabled() {
    return this.operatorModeStateService.operatorModeController.debug;
  }

  private performPatch = () => {
    this.args.performPatch?.();
  };
}
