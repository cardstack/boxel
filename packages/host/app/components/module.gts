import Component from '@glimmer/component';
import Schema from './schema';
import ImportModule from './import-module';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';
import type { FileResource } from '../resources/file';
import type { Card } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    file: FileResource
  }
}

export default class Module extends Component<Signature> {
  <template>
    <ImportModule @url={{this.args.file.url}}>
      <:ready as |module|>
        {{#each (cardsFromModule module) as |card|}}
          <Schema @card={{card}} @file={{this.args.file}} @moduleSyntax={{this.moduleSyntax}}/>
        {{/each}}
      </:ready>
      <:error as |error|>
        <h2>Encountered {{error.type}} error</h2>
        <pre>{{error.message}}</pre>
      </:error>
    </ImportModule>
  </template>

  @cached
  get moduleSyntax() {
    if (this.args.file.state !== 'ready') {
      throw new Error(`the file ${this.args.file.url} is not open`);
    }
    return new ModuleSyntax(this.args.file.content);
  }
}

function cardsFromModule(
  module: Record<string, any>,
  _never?: never // glint insists that w/o this last param that there are actually no params
): (typeof Card)[] {
  return Object.values(module).filter((maybeCard) =>
    typeof maybeCard === "function" && "baseCard" in maybeCard);
}