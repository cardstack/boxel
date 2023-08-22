import Component from '@glimmer/component';
import { service } from '@ember/service';
import type CodeService from '@cardstack/host/services/code-service';

interface Args {
  Args: {};
}

export default class RecentFiles extends Component<Args> {
  @service declare codeService: CodeService;

  <template>
    <ul data-test-recent-files>
      {{#each this.codeService.recentFiles as |file|}}
        <li data-test-recent-file>file: {{file}}</li>
      {{/each}}
    </ul>
  </template>
}
