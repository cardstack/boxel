import Component from '@glimmer/component';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';

import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import CardSchemaEditor from '@cardstack/host/components/operator-mode/card-schema-editor';
import { CardInheritance } from '@cardstack/host/components/operator-mode/schema-editor-column';

import type { Ready } from '@cardstack/host/resources/file';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';

interface Signature {
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
      }
      .inherits-from {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: var(--boxel-sp) 0;
        gap: var(--boxel-sp-xxxs);
        font: var(--boxel-font-size-sm);

        position: relative;
      }

      .chain:last-child .inherits-from {
        display: none;
      }

      .inherits-icon {
        height: 24px;
      }

      .left-line {
        width: 50%;
        height: 1px;
        background-color: var(--boxel-purple-200);
        position: absolute;
        top: 50%;
        left: 0;
        transform: translateX(-50%);
      }

      .right-line {
        width: 50%;
        height: 1px;
        background-color: var(--boxel-purple-200);
        position: absolute;
        top: 50%;
        right: 0;
        transform: translateX(50%);
      }
    </style>

    <div class='card-adoption-chain'>
      {{#each @cardInheritanceChain as |data|}}
        <div class='chain'>
          <CardSchemaEditor
            @card={{data.card}}
            @cardType={{data.cardType}}
            @file={{@file}}
            @moduleSyntax={{this.moduleSyntax}}
          />
          <div class='inherits-from'>
            <span class='inherits-icon'>{{svgJar
                'icon-inherit'
                width='24px'
                height='24px'
              }}</span>
            <span>Inherits From</span>
            <div class='left-line' />
            <div class='right-line' />
          </div>
        </div>
      {{/each}}
    </div>
  </template>

  @cached
  get moduleSyntax() {
    return new ModuleSyntax(this.args.file.content);
  }
}
