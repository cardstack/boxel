import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';

import type { CodeData } from '@cardstack/host/lib/formatted-message/utils';

import ApplyCodePatchButton, {
  type ApplyCodePatchButtonSignature,
} from './apply-code-patch-button';
import CopyCodeButton, {
  type CopyCodeButtonSignature,
} from './copy-code-button';

import type { ComponentLike } from '@glint/template';

export interface CodeBlockActionsSignature {
  Args: {
    codeData?: Partial<CodeData>;
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
    <style scoped>
      .code-block-actions {
        min-height: 45px;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>;

export default CodeBlockActionsComponent;
