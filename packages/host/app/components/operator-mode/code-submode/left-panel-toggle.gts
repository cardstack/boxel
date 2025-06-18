import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import FileCheck from '@cardstack/boxel-icons/file-check';
import FolderTree from '@cardstack/boxel-icons/folder-tree';

import {
  Label,
  RealmIcon,
  BoxelDropdown,
  Menu as BoxelMenu,
} from '@cardstack/boxel-ui/components';
import { cn, not, MenuItem } from '@cardstack/boxel-ui/helpers';

import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';

import WithLoadedRealm from '@cardstack/host/components/with-loaded-realm';
import RestoreScrollPosition from '@cardstack/host/modifiers/restore-scroll-position';
import type { FileView } from '@cardstack/host/services/operator-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import RealmService from '@cardstack/host/services/realm';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import InnerContainer from './inner-container';
import ToggleButton from './toggle-button';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    realmURL: URL;
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
  @service private declare realm: RealmService;
  @service private declare recentFilesService: RecentFilesService;

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

  get allRealms() {
    const options = Object.entries(this.realm.allRealmsInfo).map((realm) => {
      const [realmUrl, realmInfo] = realm;
      return new MenuItem(realmInfo.info.name, 'action', {
        iconURL: realmInfo.info.iconURL ?? '/default-realm-icon.png',
        action: () => this.switchRealm(realmUrl),
        subtext: !realmInfo.canWrite ? 'READ ONLY' : undefined,
        selected: realmUrl === this.args.realmURL.href,
      });
    });
    return options;
  }

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
        <WithLoadedRealm @realmURL={{@realmURL.href}} as |realm|>
          <BoxelDropdown @matchTriggerWidth={{true}}>
            <:trigger as |bindings|>
              <button
                data-test-file-tree-realm-dropdown-button
                class='realm-info'
                {{bindings}}
              >
                <RealmIcon @realmInfo={{realm.info}} />
                {{#let (concat 'In ' realm.info.name) as |realmTitle|}}
                  <Label
                    @ellipsize={{true}}
                    title={{realmTitle}}
                    data-test-realm-name={{realm.info.name}}
                  >
                    {{realmTitle}}
                  </Label>
                {{/let}}
                <div class='realm-info-right'>
                  {{#if (not realm.canWrite)}}
                    <span class='read-only' data-test-realm-read-only>READ ONLY</span>
                  {{/if}}
                  <DropdownArrowDown class='caret' width='12' height='12' />
                </div>
              </button>
            </:trigger>
            <:content as |dd|>
              <BoxelMenu
                class='realm-dropdown-menu'
                @closeMenu={{dd.close}}
                @items={{this.allRealms}}
                data-test-file-tree-realm-dropdown
              />
            </:content>
          </BoxelDropdown>
        </WithLoadedRealm>
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
        background-color: var(--code-mode-panel-background-color);
      }
      .left-panel-header {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        border-bottom: var(--boxel-border);
        background-color: var(--code-mode-top-bar-background-color);
      }
      .file-browser .content {
        background-color: var(--boxel-light);
      }
      .realm-info {
        border: 0;
        width: 100%;
        text-align: inherit;

        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-light);
        box-shadow: var(--boxel-box-shadow);
        z-index: 1;

        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .realm-info .read-only {
        color: #777;
        font: var(--boxel-font-size-xs);
        font-weight: 500;
        overflow: hidden;
        white-space: nowrap;
      }
      .realm-info-right {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .realm-dropdown-menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs);
        --boxel-menu-item-gap: var(--boxel-sp-xs);
        max-height: 13rem;
        overflow-y: scroll;
      }
      .realm-dropdown-menu :deep(.menu-item .subtext) {
        margin-left: auto;
        font: var(--boxel-font-size-xs);
        font-weight: 500;
        color: var(--boxel-secondary-text-color, #777);
      }
    </style>
  </template>
}
