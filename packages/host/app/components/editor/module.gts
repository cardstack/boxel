import Component from '@glimmer/component';
import Schema from './schema';
import ImportModule from './import-module';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';
import type { Ready } from '@cardstack/host/resources/file';
import type { Card } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    file: Ready;
  };
}

export default class Module extends Component<Signature> {
  <template>
    <ImportModule @url={{@file.url}}>
      <:ready as |module|>
        {{#each (cardsFromModule module) as |card|}}
          <Schema
            @card={{card}}
            @file={{@file}}
            @moduleSyntax={{this.moduleSyntax}}
          />
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
    return new ModuleSyntax(this.args.file.content);
  }
}

function cardsFromModule(
  module: Record<string, any>,
  _never?: never, // glint insists that w/o this last param that there are actually no params
): (typeof Card)[] {
  return Object.values(module).filter(
    (maybeCard) => typeof maybeCard === 'function' && 'baseCard' in maybeCard,
  );
}
