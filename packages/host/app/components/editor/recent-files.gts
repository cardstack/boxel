import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { RealmIcon } from '@cardstack/boxel-ui/components';

import { RealmPaths } from '@cardstack/runtime-common';

import RealmService from '@cardstack/host/services/realm';
import { RecentFile } from '@cardstack/host/services/recent-files-service';

import WithLoadedRealm from '../with-loaded-realm';

import type CardService from '../../services/card-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type RecentFilesService from '../../services/recent-files-service';

interface Args {
  Args: {};
}

export default class RecentFiles extends Component<Args> {
  @service declare cardService: CardService;
  @service declare recentFilesService: RecentFilesService;
  @service declare operatorModeStateService: OperatorModeStateService;

  <template>
    <ul class='recent-files' data-test-recent-files>
      {{#each this.recentFilesService.recentFiles as |file|}}
        <File @recentFile={{file}} />
      {{/each}}
    </ul>
    <style scoped>
      .recent-files {
        list-style-type: none;
        margin: 0;
        padding: 0;
        overflow-y: auto;
        max-height: calc(100% - var(--search-sheet-closed-height));
      }
    </style>
  </template>
}

interface FileArgs {
  Args: {
    recentFile: RecentFile;
  };
}

class File extends Component<FileArgs> {
  @service declare cardService: CardService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare realm: RealmService;

  @action
  openFile() {
    this.operatorModeStateService.updateCodePath(new URL(this.fullUrl));
  }

  get realmPaths() {
    return new RealmPaths(this.args.recentFile.realmURL);
  }

  get fullUrl() {
    return new URL(
      `${this.args.recentFile.realmURL}${this.args.recentFile.filePath}`,
    );
  }

  get isSelected() {
    return (
      this.operatorModeStateService.state.codePath?.href === this.fullUrl.href
    );
  }

  <template>
    {{#unless this.isSelected}}
      {{! template-lint-disable require-presentational-children }}
      <WithLoadedRealm @realmURL={{@recentFile.realmURL.href}} as |realm|>
        <li
          class='recent-file'
          data-test-recent-file={{this.fullUrl.href}}
          role='button'
          {{on 'click' this.openFile}}
        >
          <RealmIcon @realmInfo={{realm.info}} />
          {{@recentFile.filePath}}
        </li>
      </WithLoadedRealm>
    {{/unless}}
    <style scoped>
      .recent-file {
        background-color: var(--boxel-light);
        padding: var(--boxel-sp-xxs);
        font-weight: 600;
        margin-bottom: var(--boxel-sp-xs);
        border-radius: var(--code-mode-container-border-radius);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        overflow-wrap: anywhere;
        overflow: hidden;
      }
    </style>
  </template>
}
