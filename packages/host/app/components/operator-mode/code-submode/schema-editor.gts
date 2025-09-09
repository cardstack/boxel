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
import type { ModuleAnalysis } from '@cardstack/host/resources/module-contents';
import { type Type } from '@cardstack/host/services/card-type-service';
import type LoaderService from '@cardstack/host/services/loader-service';

import { calculateTotalOwnFields } from '@cardstack/host/utils/schema-editor';

import { BaseDef } from 'https://cardstack.com/base/card-api';

import type { WithBoundArgs } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    file: Ready;
    moduleAnalysis: ModuleAnalysis;
    cardType?: Type;
    card: typeof BaseDef;
    isReadOnly: boolean;
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
    return (
      this.args.moduleAnalysis.isLoadingNewModule ||
      this.cardInheritanceChain.isLoading
    );
  }

  <template>
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
  </template>
}
