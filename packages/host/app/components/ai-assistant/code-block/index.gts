import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import Component from '@glimmer/component';

import type { CodeData } from '@cardstack/host/lib/formatted-message/utils';

import type { MonacoEditorOptions } from '@cardstack/host/modifiers/monaco';
import MonacoEditor, {
  commonEditorOptions,
} from '@cardstack/host/modifiers/monaco-editor';

import type { MonacoSDK } from '@cardstack/host/services/monaco-service';

import CodeBlockActionsComponent, {
  type CodeBlockActionsSignature,
} from './actions';
import CodeBlockToolCallHeader, {
  type CodeBlockToolCallHeaderSignature,
} from './tool-call-header';

import type { ComponentLike } from '@glint/template';

interface CodeBlockEditorSignature {
  Args: {
    code?: string | null;
  };
}

interface Signature {
  Args: {
    monacoSDK: MonacoSDK;
    codeData?: Partial<CodeData>;
  };
  Blocks: {
    default: [
      {
        commandHeader: ComponentLike<CodeBlockToolCallHeaderSignature>;
        editor: ComponentLike<CodeBlockEditorSignature>;
        actions: ComponentLike<CodeBlockActionsSignature>;
      },
    ];
  };
  Element: HTMLElement;
}

const CodeBlockComponent: TemplateOnlyComponent<Signature> = <template>
  <section class='code-block' ...attributes>
    {{yield
      (hash
        commandHeader=(component CodeBlockToolCallHeader)
        editor=(component
          CodeBlockEditor monacoSDK=@monacoSDK codeData=@codeData
        )
        actions=(component CodeBlockActionsComponent codeData=@codeData)
      )
    }}
  </section>
  <style scoped>
    .code-block {
      --code-block-max-height: 15.625rem; /* 250px */
      background-color: var(--boxel-dark);
      color: var(--boxel-light);
      border: 1px solid var(--boxel-550);
      border-radius: var(--boxel-border-radius-xxl);
      overflow: hidden;
    }
    .code-block.compact {
      background-color: transparent;
      border: 0;
      border-radius: 0;
    }
    :deep(.monaco-editor) {
      --vscode-editor-background: var(--boxel-dark);
      --vscode-editorGutter-background: var(--boxel-dark);
    }
    :deep(.monaco-editor span[title='Double click to unfold']) {
      margin-left: 5px;
    }
  </style>
</template>;

class CodeBlockEditor extends Component<Signature> {
  editorDisplayOptions: MonacoEditorOptions = {
    ...commonEditorOptions,
    wordWrap: 'on',
    wrappingIndent: 'indent',
    fontWeight: 'bold',
    minimap: {
      enabled: false,
    },
    stickyScroll: {
      enabled: false,
    },
    padding: {
      top: 8,
      bottom: 8,
    },
  };

  <template>
    <div
      {{MonacoEditor
        monacoSDK=@monacoSDK
        codeData=@codeData
        editorDisplayOptions=this.editorDisplayOptions
      }}
      class='code-block-editor'
      data-test-editor
    >
      {{! Don't put anything here in this div as monaco modifier will override this element }}
    </div>
    <style scoped>
      .code-block-editor {
        max-height: var(--code-block-max-height);
      }
    </style>
  </template>
}

export default CodeBlockComponent;
