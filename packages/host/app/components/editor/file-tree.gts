import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import Directory from './directory';

interface Args {
  Args: {
    realmURL: URL;
  };
}

export default class FileTree extends Component<Args> {
  <template>
    <nav>
      <Directory @relativePath='' @realmURL={{@realmURL}} />
    </nav>
  </template>

  @service declare router: RouterService;
}
