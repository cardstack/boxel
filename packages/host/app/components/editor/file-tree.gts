import { concat } from '@ember/helper';
import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';

import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';

import {
  Label,
  RealmIcon,
  Tooltip,
  BoxelDropdown,
  Menu as BoxelMenu,
} from '@cardstack/boxel-ui/components';
import { not, MenuItem } from '@cardstack/boxel-ui/helpers';
import {
  IconPencilNotCrossedOut,
  IconPencilCrossedOut,
} from '@cardstack/boxel-ui/icons';

import { type LocalPath } from '@cardstack/runtime-common';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import RealmService from '@cardstack/host/services/realm';
import { type EnhancedRealmInfo } from '@cardstack/host/services/realm';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import WithLoadedRealm from '../with-loaded-realm';

import Directory from './directory';

interface Signature {
  Args: {
    realmURL: URL;
    selectedFile?: LocalPath;
    openDirs?: LocalPath[];
    onFileSelected?: (entryPath: LocalPath) => void;
    onDirectorySelected?: (entryPath: LocalPath) => void;
    scrollPositionKey?: LocalPath;
    hideRealmInfo?: boolean;
  };
}

export default class FileTree extends Component<Signature> {
  get allRealms() {
    const options = Object.entries(this.realm.allRealmsInfo).map((realm) => {
      const [, realmInfo] = realm;
      return new MenuItem(realmInfo.info.name, 'action', {
        iconURL: realmInfo.info.iconURL ?? '/default-realm-icon.png',
        action: () => this.switchRealm(realmInfo.info),
      });
    });
    return options;
  }

  switchRealm(realmInfo: EnhancedRealmInfo) {
    if (realmInfo.url) {
      const recentFile = this.recentFilesService.findRecentFileByRealmURL(
        realmInfo.url,
      );
      if (recentFile) {
        this.operatorModeStateService.updateCodePath(
          new URL(`${realmInfo.url}${recentFile.filePath}`),
        );
        return;
      }
      this.operatorModeStateService.updateCodePath(
        new URL('./index.json', realmInfo.url),
      );
    }
  }

  <template>
    <WithLoadedRealm @realmURL={{@realmURL.href}} as |realm|>
      {{#if (not @hideRealmInfo)}}
        <BoxelDropdown>
          <:trigger as |bindings|>
            <button class='realm-info' {{bindings}}>
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

              {{#if realm.canWrite}}
                <Tooltip @placement='top' class='editability-icon'>
                  <:trigger>
                    <IconPencilNotCrossedOut
                      width='18px'
                      height='18px'
                      aria-label='Can edit files in this workspace'
                      data-test-realm-writable
                    />
                  </:trigger>
                  <:content>
                    Can edit files in this workspace
                  </:content>
                </Tooltip>
              {{else}}
                <Tooltip @placement='top' class='editability-icon'>
                  <:trigger>
                    <IconPencilCrossedOut
                      width='18px'
                      height='18px'
                      aria-label='Cannot edit files in this workspace'
                      data-test-realm-not-writable
                    />
                  </:trigger>
                  <:content>
                    Cannot edit files in this workspace
                  </:content>
                </Tooltip>
              {{/if}}
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
      {{/if}}
      <nav>
        <Directory
          @relativePath=''
          @realmURL={{@realmURL}}
          @selectedFile={{@selectedFile}}
          @openDirs={{@openDirs}}
          @onFileSelected={{@onFileSelected}}
          @onDirectorySelected={{@onDirectorySelected}}
          @scrollPositionKey={{@scrollPositionKey}}
        />
        {{#if this.showMask}}
          <div class='mask' data-test-file-tree-mask></div>
        {{/if}}
      </nav>
    </WithLoadedRealm>

    <style scoped>
      .mask {
        position: absolute;
        top: 0;
        left: 0;
        background-color: white;
        height: 100%;
        width: 100%;
      }
      nav {
        position: relative;
      }
      .realm-info {
        border: 0;
        width: calc(100% + var(--boxel-sp-xs) * 2);
        text-align: inherit;

        position: sticky;
        top: calc(var(--boxel-sp-xs) * -1);
        left: calc(var(--boxel-sp-xs) * -1);
        margin: calc(var(--boxel-sp-xs) * -1) calc(var(--boxel-sp-xs) * -1) 0
          calc(var(--boxel-sp-xs) * -1);
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-xs);
        background-color: var(--boxel-light);
        box-shadow: var(--boxel-box-shadow);
        z-index: 1;

        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .realm-dropdown-menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs);
        --boxel-menu-item-gap: var(--boxel-sp-xs);
        min-width: calc(100% + var(--boxel-sp-xl));
        max-height: 13rem;
        overflow-y: scroll;
      }
      .editability-icon {
        display: flex;
      }
    </style>
  </template>

  @service private declare router: RouterService;
  @service private declare realm: RealmService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare recentFilesService: RecentFilesService;

  @tracked private showMask = true;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.hideMask.perform();
  }

  private hideMask = restartableTask(async () => {
    // fine tuned to coincide with debounce in RestoreScrollPosition modifier
    await timeout(300);
    this.showMask = false;
  });
}
