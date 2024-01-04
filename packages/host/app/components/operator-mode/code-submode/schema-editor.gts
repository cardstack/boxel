import { service } from '@ember/service';
import Component from '@glimmer/component';

//@ts-ignore cached not available yet in definitely typed
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
        'file' | 'moduleSyntax' | 'cardInheritanceChain' | 'goToDefinition'
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

export class SchemaEditorTitle extends Component<TitleSignature> {
  <template>
    Schema Editor

    {{#if @hasModuleError}}
      <span class='syntax-error'>Fail to parse</span>
    {{else}}
      <div class='total-fields' data-test-total-fields>
        <span class='total-fields-value'>{{@totalFields}}</span>
        <span class='total-fields-label'>{{getPlural
            'Field'
            @totalFields
          }}</span>
      </div>
    {{/if}}

    <style>
      .syntax-error {
        margin-left: auto;
        color: var(--boxel-400);
        font-size: var(--boxel-font-size-sm);
        font-weight: 500;
        margin-right: var(--boxel-sp-sm);
        margin-top: 3px;
      }
      .total-fields {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xxxs);
        margin-left: auto;
      }

      .total-fields > * {
        margin: 0;
      }

      .total-fields-value {
        font: 600 var(--boxel-font);
      }

      .total-fields-label {
        font: var(--boxel-font-sm);
      }
    </style>
  </template>
}

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
    <style>
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
          moduleSyntax=this.moduleSyntax
          cardInheritanceChain=this.cardInheritanceChain.value
          goToDefinition=@goToDefinition
        )
      }}
    {{/if}}
  </template>
}
