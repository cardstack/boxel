import { on } from '@ember/modifier';
import { service } from '@ember/service';

import Component from '@glimmer/component';

import type { CodeData } from '@cardstack/host/lib/formatted-message/utils';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type { CodePatchStatus } from 'https://cardstack.com/base/matrix-event';

import ApplyButton from '../../ai-assistant/apply-button';

export interface ApplyCodePatchButtonSignature {
  Args: {
    patchCodeStatus: CodePatchStatus | 'ready' | 'applying';
    performPatch?: () => void;
    codeData: CodeData;
    originalCode?: string | null;
    modifiedCode?: string | null;
  };
}

export default class ApplyCodePatchButton extends Component<ApplyCodePatchButtonSignature> {
  <template>
    {{#if this.debugButtonEnabled}}
      <button {{on 'click' this.logCodePatchAction}} class='debug-button'>
        👁️
      </button>
    {{/if}}

    <ApplyButton
      data-test-apply-code-button
      @state={{@patchCodeStatus}}
      {{on 'click' this.performPatch}}
    >
      Apply
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
  private logCodePatchAction = () => {
    console.log('fileUrl \n', this.args.codeData.fileUrl);
    console.log('searchReplaceBlock \n', this.args.codeData.searchReplaceBlock);
    console.log('originalCode \n', this.args.originalCode);
    console.log('modifiedCode \n', this.args.modifiedCode);
  };

  private get debugButtonEnabled() {
    return this.operatorModeStateService.operatorModeController.debug;
  }

  private performPatch = () => {
    this.args.performPatch?.();
  };
}
