import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { cached } from '@glimmer/tracking';

import { getPlural } from '@cardstack/runtime-common';
import { type CodeRef } from '@cardstack/runtime-common/code-ref';

import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import CardAdoptionChain from '@cardstack/host/components/operator-mode/card-adoption-chain';
import { Ready } from '@cardstack/host/resources/file';
import { inheritanceChain } from '@cardstack/host/resources/inheritance-chain';
import type {
  ModuleAnalysis,
  ModuleDeclaration,
} from '@cardstack/host/resources/module-contents';
import { type Type } from '@cardstack/host/services/card-type-service';
import type LoaderService from '@cardstack/host/services/loader-service';

import {
  calculateTotalOwnFields,
  isSelectedItemIncompatibleWithSchemaEditor,
} from '@cardstack/host/utils/schema-editor';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

import type { WithBoundArgs } from '@glint/template';

interface UnsupportedMessageSignature {
  Element: HTMLDivElement;
  Args: {
    selectedDeclaration?: ModuleDeclaration;
  };
}

class UnsupportedMessage extends Component<UnsupportedMessageSignature> {
  private get unsupportedMessage() {
    if (
      isSelectedItemIncompatibleWithSchemaEditor(this.args.selectedDeclaration)
    ) {
      return `No tools are available for the selected item: ${this.args.selectedDeclaration?.type} "${this.args.selectedDeclaration?.localName}". Select a card or field definition in the inspector.`;
    }
    return `No tools are available for the selected item. Select a card or field definition in the inspector.`;
  }

  <template>
    <p
      class='file-incompatible-message'
      data-test-schema-editor-file-incompatibility-message
    >
      <span>
        {{this.unsupportedMessage}}
      </span>
    </p>

    <style scoped>
      .file-incompatible-message {
        display: flex;
        flex-wrap: wrap;
        align-content: center;
        justify-content: center;
        text-align: center;
        height: 100%;
        background-color: var(--boxel-200);
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
        font-weight: 500;
        padding: var(--boxel-sp-xl);
        margin-block: 0;
      }
      .file-incompatible-message > span {
        max-width: 400px;
      }
    </style>
  </template>
}

interface Signature {
  Element: HTMLElement;
  Args: {
    file: Ready;
    moduleAnalysis: ModuleAnalysis;
    cardType?: Type;
    card?: typeof BaseDef;
    isReadOnly: boolean;
    selectedDeclaration?: ModuleDeclaration;
    goToDefinition: (
      codeRef: CodeRef | undefined,
      localName: string | undefined,
      fieldName?: string,
    ) => void;
  };
  Blocks: {
    default: [
      WithBoundArgs<typeof SchemaEditorBadge, 'totalFields'>,
      WithBoundArgs<
        typeof CardAdoptionChain,
        | 'file'
        | 'moduleSyntax'
        | 'cardInheritanceChain'
        | 'goToDefinition'
        | 'isReadOnly'
        | 'isLoading'
      >,
    ];
  };
}

export type CardInheritance = {
  cardType: Type;
  card: any;
};

interface TitleSignature {
  Args: {
    totalFields?: number;
  };
}

const SchemaEditorBadge: TemplateOnlyComponent<TitleSignature> = <template>
  <span
    class='total-fields'
    title='{{@totalFields}} {{getPlural "field" @totalFields}}'
    data-test-total-fields
  >
    {{@totalFields}}
  </span>

  <style scoped>
    .syntax-error,
    .total-fields {
      color: var(--boxel-450);
      font: 500 var(--boxel-font-xs);
    }

    .total-fields {
      margin-right: var(--boxel-sp-xxxs);
    }

    .loading-icon {
      display: inline-block;
      margin-right: var(--boxel-sp-xxxs);
      vertical-align: middle;
    }
  </style>
</template>;

export { SchemaEditorBadge };

export default class SchemaEditor extends Component<Signature> {
  @service declare loaderService: LoaderService;

  private cardInheritanceChain = inheritanceChain(
    this,
    () => this.args.file.url,
    () => this.args.card,
    () => this.args.cardType,
  );

  get totalFields() {
    return this.cardInheritanceChain.value.reduce(
      (total: number, data: CardInheritance) => {
        return total + calculateTotalOwnFields(data.card, data.cardType);
      },
      0,
    );
  }

  @cached
  get moduleSyntax() {
    return new ModuleSyntax(
      this.args.file.content,
      new URL(this.args.file.url),
    );
  }

  get isLoading() {
    return this.cardInheritanceChain.isLoading;
  }

  get shouldRender() {
    return this.args.card && this.args.cardType;
  }

  <template>
    {{#if this.shouldRender}}
      {{yield
        (component SchemaEditorBadge totalFields=this.totalFields)
        (component
          CardAdoptionChain
          file=@file
          isReadOnly=@isReadOnly
          moduleSyntax=this.moduleSyntax
          cardInheritanceChain=this.cardInheritanceChain.value
          goToDefinition=@goToDefinition
          isLoading=this.isLoading
        )
      }}
    {{else}}
      {{yield
        (component SchemaEditorBadge totalFields=this.totalFields)
        (component UnsupportedMessage selectedDeclaration=@selectedDeclaration)
      }}
    {{/if}}
  </template>
}
