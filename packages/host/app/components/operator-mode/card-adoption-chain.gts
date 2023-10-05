import Component from '@glimmer/component';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';

import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import CardSchemaEditor from '@cardstack/host/components/operator-mode/card-schema-editor';
import { CardInheritance } from '@cardstack/host/components/operator-mode/schema-editor-column';

import type { Ready } from '@cardstack/host/resources/file';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    file: Ready;
    cardInheritanceChain: CardInheritance[];
  };
}

export default class CardAdoptionChain extends Component<Signature> {
  <template>
    <style>
      .card-adoption-chain {
        background-color: var(--boxel-200);
        height: 100%;
      }
    </style>

    <div class='card-adoption-chain' ...attributes>
      {{#each @cardInheritanceChain as |data|}}
        <CardSchemaEditor
          @card={{data.card}}
          @cardType={{data.cardType}}
          @file={{@file}}
          @moduleSyntax={{this.moduleSyntax}}
        />
      {{/each}}
    </div>
  </template>

  @cached
  get moduleSyntax() {
    return new ModuleSyntax(this.args.file.content);
  }
}
