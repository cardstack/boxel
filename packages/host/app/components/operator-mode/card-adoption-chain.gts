import { action } from '@ember/object';
import Component from '@glimmer/component';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import { type ResolvedCodeRef } from '@cardstack/runtime-common/code-ref';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import CardSchemaEditor from '@cardstack/host/components/operator-mode/card-schema-editor';
import { CardInheritance } from '@cardstack/host/components/operator-mode/code-submode/schema-editor';
import { Divider } from '@cardstack/host/components/operator-mode/definition-container';

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
    isLoading: boolean;
  };
}

export default class CardAdoptionChain extends Component<Signature> {
  <template>
    <div ...attributes>
      {{#if @isLoading}}
        <div class='loading'>
          <LoadingIndicator class='loading-icon' />
          Loading...
        </div>
      {{else}}
        {{#each @cardInheritanceChain as |data index|}}
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
          {{#unless (this.isLastItem index @cardInheritanceChain)}}
            <Divider @label='Inherits From' />
          {{/unless}}
        {{/each}}
      {{/if}}
    </div>
    <style scoped>
      .loading {
        display: inline-flex;
      }
      .loading-icon {
        display: inline-block;
        margin-right: var(--boxel-sp-xxxs);
        vertical-align: middle;
      }
    </style>
  </template>

  isLastItem = (index: number, items: any[] = []) => index + 1 === items.length;

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
