import { concat } from '@ember/helper';
import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';

import { Label, RealmIcon, Tooltip } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import {
  IconPencilNotCrossedOut,
  IconPencilCrossedOut,
} from '@cardstack/boxel-ui/icons';

import { type LocalPath } from '@cardstack/runtime-common';

import RealmService from '@cardstack/host/services/realm';

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
  <template>
    <WithLoadedRealm @realmURL={{@realmURL.href}} as |realm|>
      {{#if (not @hideRealmInfo)}}
        <div class='realm-info'>
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
        </div>
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
      .editability-icon {
        display: flex;
      }
    </style>
  </template>

  @service private declare router: RouterService;
  @service private declare realm: RealmService;

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
