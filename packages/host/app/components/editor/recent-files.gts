import Component from '@glimmer/component';
import { service } from '@ember/service';
import type CardService from '../../services/card-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

interface Args {
  Args: {};
}

export default class RecentFiles extends Component<Args> {
  @service declare cardService: CardService;
  @service declare operatorModeStateService: OperatorModeStateService;

  @action
  openFile(url: string) {
    this.operatorModeStateService.updateCodePath(new URL(url));
  }

  <template>
    <ul data-test-recent-files>
      {{#each this.cardService.recentFiles as |file|}}
        {{#unless (eq file this.operatorModeStateService.state.codePath.href)}}
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
