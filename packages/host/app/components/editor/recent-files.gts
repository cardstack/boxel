import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

import { RealmPaths } from '@cardstack/runtime-common';

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

  @action
  openFile(url: string) {
    this.operatorModeStateService.updateCodePath(new URL(url));
  }

  get recentFilesInRealm() {
    return this.recentFilesService.recentFiles.filter((file) =>
      this.realmPaths.inRealm(new URL(file)),
    );
  }

  get realmPaths() {
    return new RealmPaths(this.cardService.defaultURL.href);
  }

  <template>
    <ul data-test-recent-files>
      {{#each this.recentFilesInRealm as |file|}}
        {{#unless (eq file this.operatorModeStateService.state.codePath.href)}}
          <li
            data-test-recent-file={{file}}
            role='button'
            {{on 'click' (fn this.openFile file)}}
          >
            {{getRelativeFilePath this.realmPaths file}}
          </li>
        {{/unless}}
      {{/each}}
    </ul>
  </template>
}

function getRelativeFilePath(realmPaths: RealmPaths, fileUrl: string) {
  return realmPaths.local(fileUrl);
}
