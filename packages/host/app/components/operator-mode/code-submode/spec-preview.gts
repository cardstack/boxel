import { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import GlimmerComponent from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import AppsIcon from '@cardstack/boxel-icons/apps';
import Brain from '@cardstack/boxel-icons/brain';
import DotIcon from '@cardstack/boxel-icons/dot';

import LayoutList from '@cardstack/boxel-icons/layout-list';
import StackIcon from '@cardstack/boxel-icons/stack';
import { task } from 'ember-concurrency';

import {
  BoxelButton,
  Pill,
  BoxelSelect,
  RealmIcon,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';

import {
  type ResolvedCodeRef,
  type Query,
  type LooseSingleCardDocument,
  specRef,
  isCardDef,
  isFieldDef,
} from '@cardstack/runtime-common';

import {
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
} from '@cardstack/runtime-common/code-ref';

import PrerenderedCardSearch, {
  PrerenderedCard,
} from '@cardstack/host/components/prerendered-card-search';
import { getCard } from '@cardstack/host/resources/card-resource';

import {
  CardOrFieldDeclaration,
  isCardOrFieldDeclaration,
  type ModuleDeclaration,
} from '@cardstack/host/resources/module-contents';

import CardService from '@cardstack/host/services/card-service';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import { Spec, type SpecType } from 'https://cardstack.com/base/spec';

import type { WithBoundArgs } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    selectedDeclaration?: ModuleDeclaration;
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof SpecPreviewTitle,
        | 'showCreateSpecIntent'
        | 'createSpec'
        | 'isCreateSpecInstanceRunning'
        | 'specType'
        | 'numberOfInstances'
      >,
      (
        | WithBoundArgs<
            typeof SpecPreviewContent,
            | 'showCreateSpecIntent'
            | 'canWrite'
            | 'ids'
            | 'selectId'
            | 'selectedId'
            | 'spec'
          >
        | WithBoundArgs<typeof SpecPreviewLoading, never>
      ),
    ];
  };
}

interface TitleSignature {
  Args: {
    numberOfInstances: number;
    specType: SpecType;
    showCreateSpecIntent: boolean;
    createSpec: (event: MouseEvent) => void;
    isCreateSpecInstanceRunning: boolean;
  };
}

class SpecPreviewTitle extends GlimmerComponent<TitleSignature> {
  get moreThanOneInstance() {
    return this.args.numberOfInstances > 1;
  }

  <template>
    Boxel Spec

    <span class='has-spec' data-test-has-spec>
      {{#if @showCreateSpecIntent}}
        <BoxelButton
          @kind='primary'
          @size='small'
          @loading={{@isCreateSpecInstanceRunning}}
          {{on 'click' @createSpec}}
          data-test-create-spec-button
        >
          Create
        </BoxelButton>
      {{else if this.moreThanOneInstance}}
        <div class='number-of-instance'>
          <DotIcon class='dot-icon' />
          <div class='number-of-instance-text'>
            {{@numberOfInstances}}
            instances
          </div>
        </div>
      {{else}}
        {{#if @specType}}
          <SpecTag @specType={{@specType}} />
        {{/if}}
      {{/if}}
    </span>

    <style scoped>
      .has-spec {
        margin-left: auto;
        color: var(--boxel-450);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
      .number-of-instance {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
      }
      .number-of-instance-text {
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xl);
      }
      .dot-icon {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
      }
    </style>
  </template>
}

interface ContentSignature {
  Element: HTMLDivElement;
  Args: {
    showCreateSpecIntent: boolean;
    canWrite: boolean;
    selectId: (id: string) => void;
    selectedId: string;
    ids: string[];
    spec: Spec | undefined;
  };
}

class SpecPreviewContent extends GlimmerComponent<ContentSignature> {
  @service private declare realm: RealmService;

  get onlyOneInstance() {
    return this.args.ids.length === 1;
  }

  getDropdownData = (id: string) => {
    let realmInfo = this.realm.info(id);
    let realmURL = this.realm.realmOfURL(new URL(id));
    if (!realmURL) {
      throw new Error('bug: no realm URL');
    }
    return {
      id: id,
      realmInfo,
      localPath: getRelativePath(realmURL.href, id),
    };
  };

  <template>
    <div class='container'>
      {{#if @showCreateSpecIntent}}
        <div class='spec-intent-message' data-test-create-spec-intent-message>
          Create a Boxel Specification to be able to create new instances
        </div>
      {{else if (not @canWrite)}}
        <div class='spec-intent-message' data-test-cannot-write-intent-message>
          Cannot create Boxel Specification inside this realm
        </div>
      {{else}}
        <div class='spec-preview'>
          <div class='spec-selector' data-test-spec-selector>
            <BoxelSelect
              @options={{@ids}}
              @selected={{@selectedId}}
              @onChange={{@selectId}}
              @matchTriggerWidth={{true}}
              @disabled={{this.onlyOneInstance}}
              as |id|
            >
              {{#if id}}
                {{#let (this.getDropdownData id) as |data|}}
                  {{#if data}}
                    <div class='spec-selector-item'>
                      <RealmIcon
                        class='url-realm-icon'
                        @realmInfo={{data.realmInfo}}
                      />
                      {{data.localPath}}
                    </div>
                  {{/if}}
                {{/let}}
              {{/if}}
            </BoxelSelect>
          </div>

          {{#if @spec}}
            {{#let (getComponent @spec) as |CardComponent|}}
              <CardComponent @format='edit' />
            {{/let}}
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .container {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        height: auto;
        width: 100%;
      }
      .spec-preview {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        height: 100%;
        width: 100%;
      }
      .spec-preview {
        padding: var(--boxel-sp-sm);
      }
      .spec-intent-message {
        background-color: var(--boxel-200);
        color: var(--boxel-450);
        font-weight: 500;
        height: 100%;
        width: 100%;
        align-content: center;
        text-align: center;
      }
      .spec-selector {
        min-width: 40%;
        align-self: flex-start;
      }
      .spec-selector-item {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
    </style>
  </template>
}

interface SpecPreviewLoadingSignature {
  Element: HTMLDivElement;
}

const SpecPreviewLoading: TemplateOnlyComponent<SpecPreviewLoadingSignature> =
  <template>
    <div class='container'>
      <div class='loading'>
        <LoadingIndicator class='loading-icon' />
        Loading...
      </div>
    </div>
    <style scoped>
      .container {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        height: 100%;
        width: 100%;
      }
      .loading {
        display: inline-flex;
      }
      .loading-icon {
        display: inline-block;
        margin-right: var(--boxel-sp-xxxs);
        vertical-align: middle;
      }
    </style>
  </template>;

export default class SpecPreview extends GlimmerComponent<Signature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare environmentService: EnvironmentService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @service private declare cardService: CardService;
  @tracked _selectedId?: string;
  @tracked ids: string[] = [];

  // We must do this so cardIds are available in the root for usage with getCard
  @action setCardIds(cards: PrerenderedCard[]) {
    this.ids = cards.map((card) => card.url);
  }

  get selectedId() {
    return this._selectedId ?? this.ids[0];
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

  private createSpecInstance = task(
    async (ref: ResolvedCodeRef, specType: SpecType) => {
      let relativeTo = new URL(ref.module);
      let maybeRef = codeRefWithAbsoluteURL(ref, relativeTo);
      let realmURL = this.operatorModeStateService.realmURL;
      if (isResolvedCodeRef(maybeRef)) {
        ref = maybeRef;
      }
      let doc: LooseSingleCardDocument = {
        data: {
          attributes: {
            specType,
            ref,
          },
          meta: {
            adoptsFrom: specRef,
            realmURL: realmURL.href,
          },
        },
      };
      try {
        let card = await this.cardService.createFromSerialized(doc.data, doc);
        if (!card) {
          throw new Error(
            `Failed to create card from ref "${ref.name}" from "${ref.module}"`,
          );
        }
        await this.cardService.saveModel(card);
      } catch (e: any) {
        console.log('Error saving', e);
      }
    },
  );

  get realms() {
    return this.realmServer.availableRealmURLs;
  }

  private get specQuery(): Query {
    return {
      filter: {
        on: specRef,
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

  private get showCreateSpecIntent() {
    return this.ids.length === 0 && this.canWrite;
  }

  //TODO: Improve identification of isApp and isSkill
  // isApp and isSkill are far from perfect functions
  //We have good primitives to identify card and field but not for app and skill
  //Here we are trying our best based upon schema analyses what is an app and a skill
  //We don't try to capture deep ancestry of app and skill
  isApp(selectedDeclaration: CardOrFieldDeclaration) {
    if (selectedDeclaration.exportName === 'AppCard') {
      return true;
    }
    if (
      selectedDeclaration.super &&
      selectedDeclaration.super.type === 'external' &&
      selectedDeclaration.super.name === 'AppCard'
    ) {
      return true;
    }
    return false;
  }

  isSkill(selectedDeclaration: CardOrFieldDeclaration) {
    if (selectedDeclaration.exportName === 'SkillCard') {
      return true;
    }
    if (
      selectedDeclaration.super &&
      selectedDeclaration.super.type === 'external' &&
      selectedDeclaration.super.name === 'SkillCard' &&
      selectedDeclaration.super.module ===
        'https://cardstack.com/base/skill-card'
    ) {
      return true;
    }
    return false;
  }

  guessSpecType(selectedDeclaration: ModuleDeclaration): SpecType {
    if (isCardOrFieldDeclaration(selectedDeclaration)) {
      if (isCardDef(selectedDeclaration.cardOrField)) {
        if (this.isApp(selectedDeclaration)) {
          return 'app';
        }
        if (this.isSkill(selectedDeclaration)) {
          return 'skill';
        }
        return 'card';
      }
      if (isFieldDef(selectedDeclaration.cardOrField)) {
        return 'field';
      }
    }
    throw new Error('Unidentified spec');
  }

  @action createSpec(event: MouseEvent) {
    event.stopPropagation();
    if (!this.args.selectedDeclaration) {
      throw new Error('bug: no selected declaration');
    }
    if (!this.getSelectedDeclarationAsCodeRef) {
      throw new Error('bug: no code ref');
    }
    let specType = this.guessSpecType(this.args.selectedDeclaration);
    this.createSpecInstance.perform(
      this.getSelectedDeclarationAsCodeRef,
      specType,
    );
  }

  @action selectId(id: string): void {
    this._selectedId = id;
  }

  get canWrite() {
    return this.realm.canWrite(this.operatorModeStateService.realmURL.href);
  }

  private cardResource = getCard(this, () => this.selectedId, {
    isAutoSave: () => true,
  });

  get card() {
    if (!this.cardResource.card) {
      return undefined;
    }
    return this.cardResource.card as Spec;
  }

  get specType() {
    return this.card?.specType as SpecType;
  }

  <template>
    <PrerenderedCardSearch
      @query={{this.specQuery}}
      @format='fitted'
      @realms={{this.realms}}
    >
      <:response as |cards|>
        {{this.setCardIds cards}}
        {{yield
          (component
            SpecPreviewTitle
            showCreateSpecIntent=this.showCreateSpecIntent
            createSpec=this.createSpec
            isCreateSpecInstanceRunning=this.createSpecInstance.isRunning
            specType=this.specType
            numberOfInstances=this.ids.length
          )
          (component
            SpecPreviewContent
            showCreateSpecIntent=this.showCreateSpecIntent
            canWrite=this.canWrite
            selectId=this.selectId
            selectedId=this.selectedId
            ids=this.ids
            spec=this.card
            isLoading=false
          )
        }}
      </:response>
      <:loading>
        {{yield
          (component
            SpecPreviewTitle
            showCreateSpecIntent=false
            createSpec=this.createSpec
            isCreateSpecInstanceRunning=this.createSpecInstance.isRunning
            specType=this.specType
            numberOfInstances=this.ids.length
          )
          (component SpecPreviewLoading)
        }}
      </:loading>
    </PrerenderedCardSearch>
  </template>
}

function getComponent(cardOrField: Spec) {
  return cardOrField.constructor.getComponent(cardOrField);
}

interface SpecTagSignature {
  Element: HTMLDivElement;
  Args: {
    specType: SpecType;
  };
}

export class SpecTag extends GlimmerComponent<SpecTagSignature> {
  get icon() {
    return getIcon(this.args.specType);
  }
  <template>
    {{#if this.icon}}
      <Pill class='spec-tag-pill' ...attributes>
        <:iconLeft>
          {{this.icon}}
        </:iconLeft>
        <:default>
          {{@specType}}
        </:default>
      </Pill>

    {{/if}}
    <style scoped>
      .spec-tag-pill {
        --pill-font: 500 var(--boxel-font-xs);
        --pill-background-color: var(--boxel-200);
        word-break: initial;
      }
    </style>
  </template>
}

function getIcon(specType: SpecType) {
  switch (specType) {
    case 'card':
      return StackIcon;
    case 'app':
      return AppsIcon;
    case 'field':
      return LayoutList;
    case 'skill':
      return Brain;
    default:
      return;
  }
}

function getRelativePath(baseUrl: string, targetUrl: string) {
  const basePath = new URL(baseUrl).pathname;
  const targetPath = new URL(targetUrl).pathname;
  return targetPath.replace(basePath, '') || '/';
}
