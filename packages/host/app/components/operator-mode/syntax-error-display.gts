import { service } from '@ember/service';
import Component from '@glimmer/component';

import MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import ErrorDisplay from './error-display';

interface Signature {
  Element: HTMLElement;
  Args: {
    syntaxErrors: string;
  };
}

export default class SyntaxErrorDisplay extends Component<Signature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;

  removeSourceMappingURL(syntaxErrors: string): string {
    return syntaxErrors.replace(/\/\/# sourceMappingURL=.*/g, '');
  }

  private get fileToAttach() {
    let codePath = this.operatorModeStateService.state.codePath?.href;
    if (!codePath) return undefined;

    return this.matrixService.fileAPI.createFileDef({
      sourceUrl: codePath,
      name: codePath.split('/').pop(),
    });
  }

  <template>
    <div class='syntax-error-container' data-test-syntax-error>
      <ErrorDisplay
        @type='syntax'
        @stack={{this.removeSourceMappingURL @syntaxErrors}}
        @fileToAttach={{this.fileToAttach}}
        @openDetails={{true}}
      />
    </div>

    <style scoped>
      .syntax-error-container {
        background: var(--boxel-100);
        padding: var(--boxel-sp);
        border-radius: var(--boxel-radius);
        height: 100%;
      }
    </style>
  </template>
}
