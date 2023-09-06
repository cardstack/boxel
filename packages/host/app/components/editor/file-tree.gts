import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import Directory from './directory';

interface Args {
  Args: {
    url: string;
  };
}

export default class FileTree extends Component<Args> {
  <template>
    <nav>
      <Directory @relativePath='' @realmURL={{@url}} />
    </nav>
  </template>

  @service declare router: RouterService;
}
