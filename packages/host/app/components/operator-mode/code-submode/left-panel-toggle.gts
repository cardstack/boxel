import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui/components';
import { cn, not } from '@cardstack/boxel-ui/helpers';

import type { FileView } from '@cardstack/host/services/operator-mode-state-service';

import InnerContainer from './inner-container';

interface ToggleButtonSignature {
  Args: {
    disabled?: boolean;
    isActive: boolean;
  };
  Element: typeof Button.Element;
  Blocks: typeof Button.Blocks;
}

class ToggleButton extends Component<ToggleButtonSignature> {
  <template>
    <Button
      @disabled={{@disabled}}
      @kind={{if @isActive 'primary-dark' 'secondary'}}
      @size='extra-small'
      class={{cn 'toggle-button' active=@isActive}}
      ...attributes
    >
      {{yield}}
    </Button>
    <style>
      .toggle-button {
        --boxel-button-border: 1px solid var(--boxel-400);
        --boxel-button-font: 700 var(--boxel-font-xs);
        --boxel-button-letter-spacing: var(--boxel-lsp-xs);
        --boxel-button-min-width: 6rem;
        --boxel-button-padding: 0;
        border-radius: var(--boxel-border-radius);
        flex: 1;
      }
      .toggle-button:hover:not(:disabled) {
        border-color: var(--boxel-dark);
      }
      .toggle-button.active {
        border-color: var(--boxel-dark);
        --boxel-button-text-color: var(--boxel-highlight);
      }
    </style>
  </template>
}

interface Signature {
  Element: HTMLDivElement;
  Args: {
    fileView: FileView | undefined;
    setFileView: (view: FileView) => void;
    isFileOpen: boolean;
  };
  Blocks: {
    inspector: [];
    browser: [];
  };
}

export default class CodeSubmodeLeftPanelToggle extends Component<Signature> {
  private get isFileTreeShowing() {
    return this.args.fileView === 'browser' || !this.args.isFileOpen;
  }

  get fileViewTitle() {
    return this.isFileTreeShowing ? 'File Browser' : 'Inspector';
  }

  <template>
    <InnerContainer
      class={{cn 'left-panel' file-browser=this.isFileTreeShowing}}
      ...attributes
      as |InnerContainerContent|
    >
      <header
        class='header'
        aria-label={{this.fileViewTitle}}
        data-test-file-view-header
      >
        <ToggleButton
          @disabled={{not @isFileOpen}}
          @isActive={{not this.isFileTreeShowing}}
          {{on 'click' (fn @setFileView 'inspector')}}
          data-test-inspector-toggle
        >
          Inspector
        </ToggleButton>
        <ToggleButton
          @isActive={{this.isFileTreeShowing}}
          {{on 'click' (fn @setFileView 'browser')}}
          data-test-file-browser-toggle
        >
          File Tree
        </ToggleButton>
      </header>
      <InnerContainerContent class='content'>
        {{#if this.isFileTreeShowing}}
          {{yield to='browser'}}
        {{else}}
          {{yield to='inspector'}}
        {{/if}}
      </InnerContainerContent>
    </InnerContainer>

    <style>
      .header {
        display: flex;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-200);
      }
      .content {
        background: var(--boxel-200);
      }
      .file-browser .content {
        background: var(--boxel-light);
      }
    </style>
  </template>
}
