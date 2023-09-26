import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import Directory from './directory';

interface Args {
  Args: {
    realmURL: string;
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
