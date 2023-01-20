import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { type Entry } from '../resources/directory';

interface Args {
  Args: {
    entry: Entry;
    onOpen: (entry: Entry) => void;
  }
}

export default class ClosedDirectory extends Component<Args> {
  <template>
    <div role="button" {{on "click" (fn @onOpen @entry)}} class="directory indent-{{@entry.indent}}">
      {{@entry.name}}
    </div>
  </template>
}
