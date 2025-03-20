import Component from '@glimmer/component';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import {
  internalKeyFor,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import PlaygroundContent from './playground-content';

interface Signature {
  Args: {
    codeRef: ResolvedCodeRef;
    isFieldDef?: boolean;
    isUpdating?: boolean;
  };
  Element: HTMLElement;
}

export default class PlaygroundPanel extends Component<Signature> {
  <template>
    <section class='playground-panel' data-test-playground-panel>
      {{#if this.isLoading}}
        <LoadingIndicator @color='var(--boxel-light)' />
      {{else}}
        <PlaygroundContent
          @codeRef={{@codeRef}}
          @moduleId={{this.moduleId}}
          @isFieldDef={{@isFieldDef}}
        />
      {{/if}}
    </section>
    <style scoped>
      .playground-panel {
        position: relative;
        background-image: url('./playground-background.png');
        background-position: left top;
        background-repeat: repeat;
        background-size: 22.5px;
        height: 100%;
        width: 100%;
        padding: var(--boxel-sp);
        padding-top: 0;
        background-color: var(--boxel-dark);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        overflow: auto;
      }
    </style>
  </template>

  private get moduleId() {
    return internalKeyFor(this.args.codeRef, undefined);
  }

  private get isLoading() {
    // TODO: improve live updating UX for fields
    return this.args.isFieldDef && this.args.isUpdating;
  }
}
