import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Entry } from '../resources/directory';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

interface Args {
  Args: {
    entry: Entry;
    localPath: string;
    onOpen: (entry: Entry) => void;
    path: string | undefined;
  }
}

export default class File extends Component<Args> {
  <template>
    <div role="button" {{on "click" (fn @onOpen @entry)}} class="file {{if (eq @localPath @path) "selected"}} indent-{{@entry.indent}}">
      {{@entry.name}}
    </div>
  </template>
}
