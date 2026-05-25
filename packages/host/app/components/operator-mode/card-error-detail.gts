import Component from '@glimmer/component';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import ErrorDisplay from './error-display';

import type { CardErrorJSONAPI } from '../../services/store';

interface Signature {
  Args: {
    error: CardErrorJSONAPI;
    viewInCodeMode?: boolean;
    title?: string;
    headerText?: string;
    fileToFixWithAi?: FileDef;
  };
  Element: HTMLElement;
  Blocks: {
    error: [];
  };
}

export default class CardErrorDetail extends Component<Signature> {
  private get message() {
    return this.args.error.message ?? undefined;
  }

  private get stack() {
    return this.args.error.meta.stack ?? undefined;
  }

  private get diagnostics() {
    return this.args.error.meta.diagnostics ?? undefined;
  }

  private get additionalErrors():
    | Array<{
        message?: string;
        stack?: string;
        status?: number;
        title?: string;
      }>
    | undefined {
    let raw = this.args.error.additionalErrors;
    if (!raw) return undefined;
    return raw as Array<{
      message?: string;
      stack?: string;
      status?: number;
      title?: string;
    }>;
  }

  <template>
    <div class='error-detail' ...attributes>
      <ErrorDisplay
        @type='runtime'
        @headerText={{@headerText}}
        @message={{if this.message this.message @error.title}}
        @stack={{this.stack}}
        @diagnostics={{this.diagnostics}}
        @additionalErrors={{this.additionalErrors}}
        @fileToAttach={{@fileToFixWithAi}}
        @viewInCodeMode={{@viewInCodeMode}}
        @cardId={{@error.id}}
      />

      {{yield to='error'}}
    </div>

    <style scoped>
      .error-detail {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        overflow: visible;
        max-height: 100%;
        margin: auto var(--boxel-sp) var(--boxel-sp) var(--boxel-sp);
      }
      @media (min-height: 800px) {
        .error-detail {
          flex: 1;
        }
      }
    </style>
  </template>
}
