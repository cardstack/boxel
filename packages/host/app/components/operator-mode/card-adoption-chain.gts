import Component from '@glimmer/component';
//@ts-ignore cached not available yet in definitely typed
import { cached } from '@glimmer/tracking';
import { action } from '@ember/object';

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

        position: relative;
      }

      .inherits-icon {
        height: 25px;
      }

      .line1 {
        width: 50%;
        height: 2px;
        background-color: var(--boxel-dark);
        position: absolute;
        top: 50%;
        left: 0;
        transform: translateX(-50%);
      }

      .line2 {
        width: 50%;
        height: 2px;
        background-color: var(--boxel-dark);
        position: absolute;
        top: 50%;
        right: 0;
        transform: translateX(50%);
      }
    </style>

    <div class='card-adoption-chain'>
      {{#each @cardInheritanceChain as |data index|}}
        <CardSchemaEditor
          @card={{data.card}}
          @cardType={{data.cardType}}
          @file={{@file}}
          @moduleSyntax={{this.moduleSyntax}}
        />
        {{#unless (this.isLastIndex index)}}
          <div class='inherits-from'>
            <span class='inherits-icon'>{{svgJar
                'icon-inheritance'
                width='25'
                height='25'
              }}</span>
            <span>Inherits From</span>
            <div class='line1' />
            <div class='line2' />
          </div>
        {{/unless}}
      {{/each}}
    </div>
  </template>

  @cached
  get moduleSyntax() {
    return new ModuleSyntax(this.args.file.content);
  }

  @action
  isLastIndex(index: number) {
    return index == this.args.cardInheritanceChain.length - 1;
  }
}
