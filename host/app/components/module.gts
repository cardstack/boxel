import Component from '@glimmer/component';
import { getCardRefsForModule } from '../resources/card-refs';
import Schema from './schema';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';
import type { FileResource } from '../resources/file';

interface Signature {
  Args: {
    file: FileResource
  }
}

export default class Module extends Component<Signature> {
  <template>
    {{#each this.cardRefs.refs as |ref|}}
      <Schema @ref={{ref}} @file={{this.args.file}} @moduleSyntax={{this.moduleSyntax}} />
    {{/each}}
  </template>

  cardRefs = getCardRefsForModule(this, () => this.args.file.url);
  
  @cached
  get moduleSyntax() {
    if (this.args.file.state !== 'ready') {
      throw new Error(`the file ${this.args.file.url} is not open`);
    }
    return new ModuleSyntax(this.args.file.content);
  }
}
