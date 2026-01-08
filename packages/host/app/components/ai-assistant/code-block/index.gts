import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import type { CodeData } from '@cardstack/host/lib/formatted-message/utils';

import type { Message as MatrixMessage } from '@cardstack/host/lib/matrix-classes/message';
import type { MonacoEditorOptions } from '@cardstack/host/modifiers/monaco';
import MonacoDiffEditor from '@cardstack/host/modifiers/monaco-diff-editor';
import MonacoEditor, {
  commonEditorOptions,
} from '@cardstack/host/modifiers/monaco-editor';

import type { MonacoSDK } from '@cardstack/host/services/monaco-service';

import CodeBlockActionsComponent, {
  type CodeBlockActionsSignature,
} from './actions';
import CodeBlockCommandHeader, {
  type CodeBlockCommandHeaderSignature,
} from './command-header';
import CodeBlockDiffEditorHeader, {
  type CodeBlockDiffEditorHeaderSignature,
} from './diff-editor-header';
import CodeBlockPatchFooterComponent, {
  type CodeBlockPatchFooterSignature,
} from './patch-footer';

import type { ComponentLike } from '@glint/template';

interface CodeBlockEditorSignature {
  Args: {
    code?: string | null;
  };
}

interface CodeBlockDiffEditorSignature {
  Args: {
    originalCode?: string | null;
    modifiedCode?: string | null;
    language?: string | null;
    updateDiffEditorStats?: (stats: {
      linesAdded: number;
      linesRemoved: number;
    }) => void;
  };
}

interface Signature {
  Args: {
    monacoSDK: MonacoSDK;
    codeData?: Partial<CodeData>;
    originalCode?: string | null;
    modifiedCode?: string | null;
    language?: string | null;
    mode?: 'edit' | 'create';
    fileUrl?: string;
    diffEditorStats?: {
      linesRemoved: number;
      linesAdded: number;
    } | null;
    updateDiffEditorStats?: (stats: {
      linesAdded: number;
      linesRemoved: number;
    }) => void;
    userMessageThisMessageIsRespondingTo?: MatrixMessage;
  };
  Blocks: {
    default: [
      {
        commandHeader: ComponentLike<CodeBlockCommandHeaderSignature>;
        diffEditorHeader: ComponentLike<CodeBlockDiffEditorHeaderSignature>;
        editor: ComponentLike<CodeBlockEditorSignature>;
        diffEditor: ComponentLike<CodeBlockDiffEditorSignature>;
        actions: ComponentLike<CodeBlockActionsSignature>;
        patchFooter: ComponentLike<CodeBlockPatchFooterSignature>;
      },
    ];
  };
  Element: HTMLElement;
}

const CodeBlockComponent: TemplateOnlyComponent<Signature> = <template>
  <section class='code-block' ...attributes>
    {{yield
      (hash
        commandHeader=(component CodeBlockCommandHeader)
        diffEditorHeader=(component
          CodeBlockDiffEditorHeader
          codeData=@codeData
          diffEditorStats=@diffEditorStats
          userMessageThisMessageIsRespondingTo=@userMessageThisMessageIsRespondingTo
        )
        editor=(component
          CodeBlockEditor monacoSDK=@monacoSDK codeData=@codeData
        )
        diffEditor=(component
          CodeBlockDiffEditor
          monacoSDK=@monacoSDK
          originalCode=@originalCode
          modifiedCode=@modifiedCode
          language=@language
        )
        actions=(component CodeBlockActionsComponent codeData=@codeData)
        patchFooter=(component CodeBlockPatchFooterComponent)
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
      /* this improves inserted-line legibility by reducing green background overlay opacity */
      --vscode-diffEditor-insertedLineBackground: rgb(19 255 32 / 26%);
    }
    :deep(.monaco-editor .diff-hidden-lines) {
      margin-left: 9px;
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

class CodeBlockDiffEditor extends Component<Signature> {
  private editorDisplayOptions = {
    ...commonEditorOptions,
    originalEditable: false,
    renderSideBySide: false,
    diffAlgorithm: 'advanced',
    folding: true,
    hideUnchangedRegions: {
      enabled: true,
      revealLineCount: 10,
      minimumLineCount: 1,
      contextLineCount: 1,
    },
    renderOverviewRuler: false,
    padding: {
      bottom: 0,
      left: 8,
      right: 8,
      top: 8,
    },
  };

  @tracked diffEditorStats: {
    linesAdded: number;
    linesRemoved: number;
  } | null = null;

  <template>
    <div
      {{MonacoDiffEditor
        monacoSDK=@monacoSDK
        editorDisplayOptions=this.editorDisplayOptions
        language=@language
        originalCode=@originalCode
        modifiedCode=@modifiedCode
        updateDiffEditorStats=@updateDiffEditorStats
      }}
      class='code-block-editor code-block-diff'
      data-test-code-diff-editor
    >
      {{! Don't put anything here in this div as monaco modifier will override this element }}
    </div>
    <style scoped>
      .code-block-diff {
        max-height: var(--code-block-max-height);
      }
    </style>
  </template>
}

export default CodeBlockComponent;
