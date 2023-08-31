import Component from '@glimmer/component';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import Directory from './directory';
import { OpenFiles } from '@cardstack/host/controllers/code';

interface Args {
  Args: {
    url: string;
    openFiles: OpenFiles;
  };
}

export default class FileTree extends Component<Args> {
  <template>
    <nav>
      <Directory
        @openFiles={{@openFiles}}
        @relativePath=''
        @realmURL={{@url}}
      />
    </nav>
  </template>

  @service declare router: RouterService;
}
