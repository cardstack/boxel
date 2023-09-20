import Component from '@glimmer/component';
import { service } from '@ember/service';
import type CardService from '../../services/card-service';
import type RecentFilesService from '../../services/recent-files-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { RealmPaths } from '@cardstack/runtime-common';

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
    <ul class='recent-files' data-test-recent-files>
      {{#each this.recentFilesInRealm as |file|}}
        {{#unless (eq file this.operatorModeStateService.state.codePath.href)}}
          <li
            class='recent-file'
            data-test-recent-file={{file}}
            role='button'
            {{on 'click' (fn this.openFile file)}}
          >
            {{getRelativeFilePath this.realmPaths file}}
          </li>
        {{/unless}}
      {{/each}}
    </ul>
    <style>
      .recent-files {
        list-style-type: none;
        margin: 0;
        padding: 0;
      }

      .recent-file {
        background: var(--boxel-light);
        padding: var(--boxel-sp-xs);
        font-weight: 700;
        margin-bottom: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
      }
    </style>
  </template>
}

function getRelativeFilePath(realmPaths: RealmPaths, fileUrl: string) {
  return realmPaths.local(fileUrl);
}
