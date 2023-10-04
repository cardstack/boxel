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
      .content-with-line {
        position: relative;
        transform: translateX(calc(var(--boxel-sp-sm) * -1));

        display: flex;
        align-items: center;
        width: calc(100% + calc(var(--boxel-sp-sm) * 2));
        height: 60px;
        padding: var(--boxel-sp) 0;
      }

      .inherits-from {
        display: flex;
        align-items: center;
        padding: 0 var(--boxel-sp-xs);
        gap: var(--boxel-sp-xxxs);
        font: var(--boxel-font-size-sm);
        text-wrap: nowrap;
        background: var(--boxel-200);

        position: absolute;
        left: 50%;
        transform: translateX(-50%);
      }

      .chain:last-child .content-with-line {
        display: none;
      }

      .inherits-icon {
        height: 24px;
      }

      .line {
        width: 100%;
        height: 1px;
        background-color: var(--boxel-purple-200);
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
          <div class='content-with-line'>
            <div class='line' />
            <div class='inherits-from'>
              <span class='inherits-icon'>{{svgJar
                  'icon-inherit'
                  width='24px'
                  height='24px'
                }}</span>
              <span>Inherits From</span>
            </div>
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
