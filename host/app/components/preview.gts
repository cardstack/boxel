import Component from '@glimmer/component';
import { importResource } from '../resources/import';

export default class Preview extends Component<{ Args: { filename: string } }> {
  <template>
    {{#if this.error}}
      <h2>Encountered {{this.error.type}} error</h2>
      <pre>{{this.error.message}}</pre>
    {{else if this.component}}
      <this.component />
    {{/if}}
  </template>

  imported = importResource(this, () => new URL(this.args.filename, 'http://local-realm/'));

  // TODO use this to chose from amongst the exported cards in the selected module
  // will also need to add logic to filter the exports to only those that are cards
  get exports() {
    return Object.keys(this.imported.module ?? {}).join();
  }
  get component() {
    return this.imported.module?.component;
  }
  get error() {
    return this.imported.error;
  }
}