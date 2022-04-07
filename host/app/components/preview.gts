import Component from '@glint/environment-ember-loose/glimmer-component';
import { importResource } from '../resources/import';

export default class Preview extends Component<{ Args: { filename: string } }> {
  <template>
    {{#if this.component}}
      <this.component />
    {{/if}}
  </template>

  imported = importResource(this, () => new URL(this.args.filename, 'http://local-realm/'));

  get component() {
    return this.imported.module?.component;
  }
}