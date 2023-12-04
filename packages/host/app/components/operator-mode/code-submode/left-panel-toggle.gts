import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui/components';
import { cn, not } from '@cardstack/boxel-ui/helpers';

import RestoreScrollPosition from '@cardstack/host/modifiers/restore-scroll-position';
import type { FileView } from '@cardstack/host/services/operator-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

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
    selectedDeclaration: any | undefined;
  };
  Blocks: {
    inspector: [];
    browser: [];
  };
}

export default class CodeSubmodeLeftPanelToggle extends Component<Signature> {
  @service declare operatorModeStateService: OperatorModeStateService;

  private get isFileTreeShowing() {
    return this.args.fileView === 'browser' || !this.args.isFileOpen;
  }

  get fileViewTitle() {
    return this.isFileTreeShowing ? 'File Browser' : 'Inspector';
  }

  private get codePath() {
    return this.operatorModeStateService.state.codePath;
  }

  private get scrollPositionContainer() {
    return this.isFileTreeShowing ? 'file-tree' : 'inspector';
  }

  private get scrollPositionKey() {
    if (this.isFileTreeShowing) {
      return this.codePath?.toString();
    } else {
      return `${this.codePath}#${this.selectedDeclaration?.localName}`;
    }
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
      <InnerContainerContent
        class='content'
        data-test-togglable-left-panel
        {{RestoreScrollPosition
          container=this.scrollPositionContainer
          key=this.scrollPositionKey
        }}
      >
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
