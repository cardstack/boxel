import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';

import { CopyButton } from '@cardstack/boxel-ui/components';

import type { CodeData } from '@cardstack/host/lib/formatted-message/utils';

import ApplyCodePatchButton, {
  type ApplyCodePatchButtonSignature,
} from './apply-code-patch-button';

import type { ComponentLike } from '@glint/template';

export interface CodeBlockActionsSignature {
  Args: {
    codeData?: Partial<CodeData>;
  };
  Blocks: {
    default: [
      {
        copyCode: CopyButton;
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
          copyCode=(component
            CopyButton textToCopy=@codeData.code variant='text-only'
          )
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
        height: 45px;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      :deep(.code-copy-button) {
        justify-content: flex-end;
      }
    </style>
  </template>;

export default CodeBlockActionsComponent;
