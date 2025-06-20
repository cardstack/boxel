import { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import type { ComponentLike } from '@glint/template';

import { Alert } from '@cardstack/boxel-ui/components';

import type { CodeData } from '@cardstack/host/lib/formatted-message/utils';

import ApplyCodePatchButton, {
  type ApplyCodePatchButtonSignature,
} from './apply-action-button';
import CopyCodeButton, {
  type CopyCodeButtonSignature,
} from './copy-code-button';

export interface CodeBlockActionsSignature {
  Args: {
    codeData?: Partial<CodeData>;
    failedState?: Error;
    retryAction?: () => void;
  };
  Blocks: {
    default: [
      {
        copyCode: ComponentLike<CopyCodeButtonSignature>;
        applyCodePatch: ComponentLike<ApplyCodePatchButtonSignature>;
      },
    ];
  };
  actions: [];
}

const CodeBlockActionsComponent: TemplateOnlyComponent<CodeBlockActionsSignature> =
  <template>
    <footer class='code-block-footer'>
      <div class='code-block-actions'>
        {{yield
          (hash
            copyCode=(component CopyCodeButton code=@codeData.code)
            applyCodePatch=(component
              ApplyCodePatchButton
              codePatch=@codeData.searchReplaceBlock
              fileUrl=@codeData.fileUrl
              index=@codeData.codeBlockIndex
            )
          )
        }}
      </div>
      {{#if @failedState}}
        <Alert
          class='code-block-error'
          @type='error'
          @messages={{@failedState.message}}
          @retryAction={{@retryAction}}
        />
      {{/if}}
    </footer>
    <style scoped>
      .code-block-actions {
        background-color: var(--boxel-dark);
        height: 45px;
        padding: var(--boxel-sp-sm) 27px;
        padding-right: var(--boxel-sp);
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
      }
      .code-block-error {
        border-radius: 0;
      }
    </style>
  </template>;

export default CodeBlockActionsComponent;
