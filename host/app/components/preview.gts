import Component from '@glint/environment-ember-loose/glimmer-component';
import { importResource } from '../resources/import';

export default class Preview extends Component<{ Args: { filename: string } }> {
  <template>
    <div class="preview">
    {{#if this.component}}
      <this.component />
    {{/if}}
    </div>
  </template>

  imported = importResource(this, () => new URL(this.args.filename, 'http://local-realm/'));

  get component() {
    return this.imported.module?.component;
  }
}