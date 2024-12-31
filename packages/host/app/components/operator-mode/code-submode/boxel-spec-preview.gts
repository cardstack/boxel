import { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import GlimmerComponent from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { BoxelButton, RadioInput, Pill } from '@cardstack/boxel-ui/components';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import {
  type ResolvedCodeRef,
  catalogEntryRef,
  getCards,
  type Query,
} from '@cardstack/runtime-common';

import { type ModuleDeclaration } from '@cardstack/host/resources/module-contents';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import RealmService from '@cardstack/host/services/realm';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';

import { type FileType } from '../create-file-modal';

import type { WithBoundArgs } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    selectedDeclaration?: ModuleDeclaration;
    createFile: (
      fileType: FileType,
      definitionClass?: {
        displayName: string;
        ref: ResolvedCodeRef;
      },
      sourceInstance?: CardDef,
    ) => Promise<void>;
  };
  Blocks: {
    default: [
      WithBoundArgs<typeof BoxelSpecPreviewTitle, 'showCreateBoxelSpecIntent'>,
      WithBoundArgs<
        typeof BoxelSpecPreviewContent,
        | 'showCreateBoxelSpecIntent'
        | 'boxelSpecInstances'
        | 'selectedInstance'
        | 'createBoxelSpec'
        | 'selectBoxelSpec'
      >,
    ];
  };
}

interface TitleSignature {
  Args: {
    showCreateBoxelSpecIntent: boolean;
  };
}

function htmlSafeColor(color?: string) {
  return htmlSafe(`background-color: ${color || ''}`);
}

const BoxelSpecPreviewTitle: TemplateOnlyComponent<TitleSignature> = <template>
  Boxel Specification

  <span class='has-boxel-spec' data-test-has-boxel-spec>
    {{#if @showCreateBoxelSpecIntent}}
      <Pill style={{htmlSafeColor 'orange'}}>No Boxel Spec</Pill>
    {{/if}}
  </span>

  <style scoped>
    .has-boxel-spec {
      margin-left: auto;
      color: var(--boxel-450);
      font: 500 var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-xl);
      text-transform: uppercase;
    }
  </style>
</template>;

interface ContentSignature {
  Element: HTMLDivElement;
  Args: {
    showCreateBoxelSpecIntent: boolean;
    boxelSpecInstances: CatalogEntry[];
    selectedInstance: CatalogEntry | null;
    createBoxelSpec: () => void;
    selectBoxelSpec: (boxelSpec: CatalogEntry) => void;
  };
}

const BoxelSpecPreviewContent: TemplateOnlyComponent<ContentSignature> =
  <template>
    <div class='boxel-spec-preview'>
      {{#if @showCreateBoxelSpecIntent}}
        <div class='create-boxel-spec-intent-message'>
          Create a Boxel Specification to be able to create new instances
        </div>
        <BoxelButton @kind='primary' {{on 'click' @createBoxelSpec}}>
          Create Boxel Spec
        </BoxelButton>
      {{else}}
        <div class='boxel-spec-selector'>
          <RadioInput
            @groupDescription='Select Boxel Spec'
            @items={{@boxelSpecInstances}}
            @checkedId={{@selectedInstance.id}}
            @orientation='vertical'
            @spacing='compact'
            as |item|
          >
            <item.component @onChange={{(fn @selectBoxelSpec item.data)}}>
              {{item.data.id}}
            </item.component>
          </RadioInput>
        </div>
        {{#if @selectedInstance}}
          {{#let (getComponent @selectedInstance) as |CardComponent|}}
            <CardComponent />
          {{/let}}
        {{/if}}
      {{/if}}
    </div>

    <style scoped>
      .create-boxel-spec-intent-message {
        text-align: center;
        color: var(--boxel-450);
        font-weight: 500;
      }
      .boxel-spec-preview {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding-top: var(--boxel-sp);
      }
      .boxel-spec-selector {
        padding: var(--boxel-sp-sm);
      }
    </style>
  </template>;

export default class BoxelSpecPreview extends GlimmerComponent<Signature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @tracked selectedInstance: CatalogEntry | null = this.boxelSpecInstances[0];

  get realmURL() {
    return this.realm.realmOfURL(this.operatorModeStateService.state.codePath!);
  }

  get realms() {
    if (!this.realmURL) {
      return [];
    }
    return [this.realmURL.href];
  }

  private get getSelectedDeclarationAsCodeRef(): ResolvedCodeRef {
    if (!this.args.selectedDeclaration?.exportName) {
      return {
        name: '',
        module: '',
      };
    }
    return {
      name: this.args.selectedDeclaration.exportName,
      module: `${this.operatorModeStateService.state.codePath!.href.replace(
        /\.[^.]+$/,
        '',
      )}`,
    };
  }

  private get boxelSpecQuery(): Query {
    return {
      filter: {
        on: catalogEntryRef,
        eq: {
          ref: this.getSelectedDeclarationAsCodeRef, //ref is primitive
        },
      },
      sort: [
        {
          by: 'createdAt',
          direction: 'desc',
        },
      ],
    };
  }

  boxelSpecSearch = getCards(this.boxelSpecQuery, this.realms, {
    isLive: true,
  });

  get boxelSpecInstances() {
    return this.boxelSpecSearch.instances as CatalogEntry[];
  }

  private get showCreateBoxelSpecIntent() {
    return (
      !this.boxelSpecSearch.isLoading && this.boxelSpecInstances.length === 0
    );
  }

  @action private createBoxelSpec() {
    if (!this.getSelectedDeclarationAsCodeRef) {
      throw new Error('bug: no code ref');
    }
    let displayName = this.getSelectedDeclarationAsCodeRef.name;
    this.args.createFile(
      {
        id: 'boxel-spec-instance',
        displayName: 'Boxel Specification', //display name in modal
      },
      {
        displayName: displayName,
        ref: this.getSelectedDeclarationAsCodeRef,
      },
    );
  }

  @action selectBoxelSpec(boxelSpec: CatalogEntry): void {
    this.selectedInstance = boxelSpec;
  }

  <template>
    {{#if this.boxelSpecSearch.isLoading}}
      <div class='loading'>
        <LoadingIndicator />
      </div>
    {{else}}
      {{yield
        (component
          BoxelSpecPreviewTitle
          showCreateBoxelSpecIntent=this.showCreateBoxelSpecIntent
        )
        (component
          BoxelSpecPreviewContent
          showCreateBoxelSpecIntent=this.showCreateBoxelSpecIntent
          boxelSpecInstances=this.boxelSpecInstances
          selectedInstance=this.selectedInstance
          createBoxelSpec=this.createBoxelSpec
          selectBoxelSpec=this.selectBoxelSpec
        )
      }}
    {{/if}}
    <style scoped>
      .loading {
        display: flex;
        justify-content: center;
        padding: var(--boxel-sp-xl);
      }
    </style>
  </template>
}

function getComponent(cardOrField: CatalogEntry) {
  return cardOrField.constructor.getComponent(cardOrField);
}
