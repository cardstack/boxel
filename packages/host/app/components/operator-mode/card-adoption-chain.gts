import { action } from '@ember/object';
import Component from '@glimmer/component';

import { IconInherit as InheritIcon } from '@cardstack/boxel-ui/icons';

import { type ResolvedCodeRef } from '@cardstack/runtime-common/code-ref';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import CardSchemaEditor from '@cardstack/host/components/operator-mode/card-schema-editor';
import { CardInheritance } from '@cardstack/host/components/operator-mode/code-submode/schema-editor';

import { stripFileExtension } from '@cardstack/host/lib/utils';
import { Type } from '@cardstack/host/resources/card-type';
import type { Ready } from '@cardstack/host/resources/file';

import { isOwnField } from '@cardstack/host/utils/schema-editor';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    file: Ready;
    cardInheritanceChain: CardInheritance[];
    moduleSyntax: ModuleSyntax;
    isReadOnly: boolean;
    goToDefinition: (
      codeRef: ResolvedCodeRef | undefined,
      localName: string | undefined,
    ) => void;
  };
}

export default class CardAdoptionChain extends Component<Signature> {
  <template>
    <style scoped>
      .card-adoption-chain {
        background-color: var(--boxel-200);
        min-height: 100%;
        padding: var(--boxel-sp-sm);
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
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
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
        border: 1px solid var(--boxel-purple-200);
      }
    </style>

    <div class='card-adoption-chain' ...attributes>
      {{#each @cardInheritanceChain as |data index|}}
        <div class='chain'>
          <CardSchemaEditor
            @card={{data.card}}
            @cardType={{data.cardType}}
            @file={{@file}}
            @moduleSyntax={{@moduleSyntax}}
            @childFields={{this.getFields index 'successors'}}
            @parentFields={{this.getFields index 'ancestors'}}
            @allowFieldManipulation={{this.allowFieldManipulation
              @file
              data.cardType
            }}
            @goToDefinition={{@goToDefinition}}
          />
          <div class='content-with-line'>
            <hr class='line' />
            <div class='inherits-from'>
              <span class='inherits-icon'><InheritIcon
                  width='24px'
                  height='24px'
                /></span>
              <span>Inherits From</span>
            </div>
          </div>
        </div>
      {{/each}}
    </div>
  </template>

  @action
  getFields(cardIndex: number, from: 'ancestors' | 'successors'): string[] {
    const children = this.args.cardInheritanceChain.filter((_data, index) =>
      from === 'ancestors' ? index > cardIndex : index < cardIndex,
    );

    const fields = children.reduce((result: string[], data) => {
      return result.concat(
        data.cardType.fields
          .filter((field) => isOwnField(data.card, field.name))
          .map((field) => field.name),
      );
    }, []);

    return fields;
  }

  @action allowFieldManipulation(file: Ready, cardType: Type): boolean {
    if (this.args.isReadOnly) {
      return false;
    }
    // Only allow add/edit/remove for fields from the currently opened module
    return stripFileExtension(file.url) === cardType.module;
  }
}
