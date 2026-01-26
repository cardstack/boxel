import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import FileCheck from '@cardstack/boxel-icons/file-check';
import FolderTree from '@cardstack/boxel-icons/folder-tree';

import { cn, not } from '@cardstack/boxel-ui/helpers';

import RealmDropdown from '@cardstack/host/components/realm-dropdown';
import RestoreScrollPosition from '@cardstack/host/modifiers/restore-scroll-position';
import type { FileView } from '@cardstack/host/services/operator-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import InnerContainer from './inner-container';
import ToggleButton from './toggle-button';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    realmURL: string;
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
  @service declare private recentFilesService: RecentFilesService;

  private notifyFileBrowserIsVisible: (() => void) | undefined;

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
      return `${this.codePath}#${this.args.selectedDeclaration?.localName}`;
    }
  }

  private setFileView = (view: FileView) => {
    this.args.setFileView(view);
    if (view === 'browser') {
      this.notifyFileBrowserIsVisible?.();
    }
  };

  private whenFileBrowserVisible = (setVisible: () => void) => {
    this.notifyFileBrowserIsVisible = setVisible;
  };

  switchRealm(realmUrl: string) {
    if (realmUrl) {
      const recentFile =
        this.recentFilesService.findRecentFileByRealmURL(realmUrl);
      if (recentFile) {
        this.operatorModeStateService.updateCodePath(
          new URL(`${realmUrl}${recentFile.filePath}`),
        );
        return;
      }
      this.operatorModeStateService.updateCodePath(
        new URL('./index.json', realmUrl),
      );
    }
  }

  handleRealmSelect = (realmItem: any) => {
    this.switchRealm(realmItem.path);
  };

  <template>
    <InnerContainer
      class={{cn 'left-panel' file-browser=this.isFileTreeShowing}}
      ...attributes
      as |InnerContainerContent|
    >
      <header
        class='left-panel-header'
        aria-label={{this.fileViewTitle}}
        data-test-file-view-header
      >
        <ToggleButton
          @icon={{FolderTree}}
          @isActive={{this.isFileTreeShowing}}
          {{on 'click' (fn this.setFileView 'browser')}}
          data-test-file-browser-toggle
        >
          File Tree
        </ToggleButton>
        <ToggleButton
          @icon={{FileCheck}}
          @disabled={{not @isFileOpen}}
          @isActive={{not this.isFileTreeShowing}}
          {{on 'click' (fn this.setFileView 'inspector')}}
          data-test-inspector-toggle
        >
          Inspector
        </ToggleButton>
      </header>
      {{#if this.isFileTreeShowing}}
        <RealmDropdown
          @selectedRealmURL={{@realmURL}}
          @onSelect={{this.handleRealmSelect}}
          @selectedRealmPrefix='In'
          @displayReadOnlyTag={{true}}
          @contentClass='realm-dropdown-menu'
        />
      {{/if}}
      <InnerContainerContent
        class='content'
        data-test-togglable-left-panel
        @withMask={{this.isFileTreeShowing}}
        @whenVisible={{this.whenFileBrowserVisible}}
        {{RestoreScrollPosition
          container=this.scrollPositionContainer
          key=this.scrollPositionKey
        }}
        data-test-card-inspector-panel={{not this.isFileTreeShowing}}
      >
        {{#if this.isFileTreeShowing}}
          {{yield to='browser'}}
        {{else}}
          {{yield to='inspector'}}
        {{/if}}
      </InnerContainerContent>
    </InnerContainer>

    <style scoped>
      .left-panel {
        background-color: transparent;
      }
      .left-panel-header {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        border-bottom: var(--boxel-border);
      }
      .file-browser .content {
        background-color: var(--boxel-light);
      }
      :deep(.realm-dropdown-trigger) {
        background-color: #e9e9ec;
        border-radius: 0;
        border: none;
        border-bottom: 1px solid var(--boxel-400);
        padding: var(--boxel-sp-xs);
        height: fit-content;
      }
    </style>
  </template>
}
