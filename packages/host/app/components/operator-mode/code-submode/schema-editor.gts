import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { cached } from '@glimmer/tracking';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import { getPlural } from '@cardstack/runtime-common';
import { type ResolvedCodeRef } from '@cardstack/runtime-common/code-ref';

import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import CardAdoptionChain from '@cardstack/host/components/operator-mode/card-adoption-chain';
import { CardType, Type } from '@cardstack/host/resources/card-type';
import { Ready } from '@cardstack/host/resources/file';
import { inheritanceChain } from '@cardstack/host/resources/inheritance-chain';
import { ModuleContentsResource } from '@cardstack/host/resources/module-contents';
import LoaderService from '@cardstack/host/services/loader-service';
import { calculateTotalOwnFields } from '@cardstack/host/utils/schema-editor';

import { BaseDef } from 'https://cardstack.com/base/card-api';

import type { WithBoundArgs } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    file: Ready;
    moduleContentsResource: ModuleContentsResource;
    cardTypeResource?: CardType;
    card: typeof BaseDef;
    isReadOnly: boolean;
    goToDefinition: (
      codeRef: ResolvedCodeRef | undefined,
      localName: string | undefined,
    ) => void;
  };
  Blocks: {
    default: [
      WithBoundArgs<typeof SchemaEditorTitle, 'totalFields' | 'hasModuleError'>,
      WithBoundArgs<
        typeof CardAdoptionChain,
        | 'file'
        | 'moduleSyntax'
        | 'cardInheritanceChain'
        | 'goToDefinition'
        | 'isReadOnly'
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
    hasModuleError?: boolean;
  };
}

const SchemaEditorTitle: TemplateOnlyComponent<TitleSignature> = <template>
  Schema Editor

  {{#if @hasModuleError}}
    <span class='syntax-error'>Fail to parse</span>
  {{else}}
    <span class='total-fields' data-test-total-fields>
      {{@totalFields}}
      {{getPlural 'Field' @totalFields}}
    </span>
  {{/if}}

  <style scoped>
    .syntax-error,
    .total-fields {
      margin-left: auto;
      color: var(--boxel-450);
      font: 500 var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-xl);
      text-transform: uppercase;
    }
  </style>
</template>;

export { SchemaEditorTitle };

export default class SchemaEditor extends Component<Signature> {
  @service declare loaderService: LoaderService;

  private cardInheritanceChain = inheritanceChain(
    this,
    () => this.args.file.url,
    () => this.args.card,
    () => this.args.cardTypeResource,
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

  get hasModuleError() {
    return !!this.args?.moduleContentsResource?.moduleError?.message;
  }

  <template>
    <style scoped>
      .loading {
        display: flex;
        justify-content: center;
        padding: var(--boxel-sp-xl);
      }
    </style>
    {{#if @moduleContentsResource.isLoadingNewModule}}
      <div class='loading'>
        <LoadingIndicator />
      </div>
    {{else}}

      {{yield
        (component
          SchemaEditorTitle
          totalFields=this.totalFields
          hasModuleError=this.hasModuleError
        )
        (component
          CardAdoptionChain
          file=@file
          isReadOnly=@isReadOnly
          moduleSyntax=this.moduleSyntax
          cardInheritanceChain=this.cardInheritanceChain.value
          goToDefinition=@goToDefinition
        )
      }}
    {{/if}}
  </template>
}
