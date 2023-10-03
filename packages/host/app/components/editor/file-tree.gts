import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import Directory from './directory';

interface Args {
  Args: {
    realmURL: string;
  };
}

export default class FileTree extends Component<Args> {
  <template>
    <nav>
      {{#unless this.operatorModeStateService.realmURLResource.isLoading}}
        <Directory @relativePath='' @realmURL={{@realmURL}} />
      {{/unless}}
    </nav>
  </template>

  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare router: RouterService;
}
