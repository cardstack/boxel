import Component from '@glimmer/component';
import { service } from '@ember/service';
import type CodeService from '@cardstack/host/services/code-service';
import type CodeController from '@cardstack/host/controllers/code';
import { inject as controller } from '@ember/controller';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

interface Args {
  Args: {};
}

export default class RecentFiles extends Component<Args> {
  @service declare codeService: CodeService;
  @controller declare code: CodeController;

  @action
  openFile(entryPath: string) {
    this.code.openPath(entryPath);
  }

  <template>
    <ul data-test-recent-files>
      {{#each this.codeService.recentFiles as |file|}}
        {{#unless (eq file this.code.openFile)}}
          <li
            data-test-recent-file={{file}}
            role='button'
            {{on 'click' (fn this.openFile file)}}
          >
            {{file}}
          </li>
        {{/unless}}
      {{/each}}
    </ul>
  </template>
}
