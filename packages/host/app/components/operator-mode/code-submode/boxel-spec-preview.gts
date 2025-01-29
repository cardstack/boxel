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

import {
  BoxelButton,
  Pill,
  BoxelSelect,
  RealmIcon,
} from '@cardstack/boxel-ui/components';

import { not } from '@cardstack/boxel-ui/helpers';

import {
  type ResolvedCodeRef,
  boxelSpecRef,
  getCards,
  type Query,
  isCardDef,
  isFieldDef,
} from '@cardstack/runtime-common';

import {
  CardOrFieldDeclaration,
  isCardOrFieldDeclaration,
  type ModuleDeclaration,
} from '@cardstack/host/resources/module-contents';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import RealmService from '@cardstack/host/services/realm';

import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  BoxelSpec,
  type BoxelSpecType,
} from 'https://cardstack.com/base/boxel-spec';
import { type CardDef } from 'https://cardstack.com/base/card-api';

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
        specType?: BoxelSpecType;
      },
      sourceInstance?: CardDef,
    ) => Promise<void>;
    isCreateModalShown: boolean;
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof BoxelSpecPreviewTitle,
        | 'showCreateBoxelSpecIntent'
        | 'boxelSpecInstances'
        | 'selectedInstance'
        | 'createBoxelSpec'
        | 'isCreateModalShown'
      >,
      WithBoundArgs<
        typeof BoxelSpecPreviewContent,
        | 'showCreateBoxelSpecIntent'
        | 'boxelSpecInstances'
        | 'selectedInstance'
        | 'selectBoxelSpec'
      >,
    ];
  };
}

interface TitleSignature {
  Args: {
    boxelSpecInstances: BoxelSpec[];
    selectedInstance: BoxelSpec | null;
    showCreateBoxelSpecIntent: boolean;
    createBoxelSpec: () => void;
    isCreateModalShown: boolean;
  };
}

class BoxelSpecPreviewTitle extends GlimmerComponent<TitleSignature> {
  get numberOfInstances() {
    return this.args.boxelSpecInstances?.length;
  }

  get moreThanOneInstance() {
    return this.numberOfInstances > 1;
  }

  <template>
    Boxel Specification

    <span class='has-boxel-spec' data-test-has-boxel-spec>
      {{#if @showCreateBoxelSpecIntent}}
        <BoxelButton
          @kind='primary'
          @size='small'
          @disabled={{@isCreateModalShown}}
          {{on 'click' @createBoxelSpec}}
          data-test-create-boxel-spec-button
        >
          Create
        </BoxelButton>
      {{else if this.moreThanOneInstance}}
        <div class='number-of-instance'>
          <DotIcon class='dot-icon' />
          <div class='number-of-instance-text'>
            {{this.numberOfInstances}}
            instances
          </div>
        </div>
      {{else}}
        {{#if @selectedInstance.specType}}
          <SpecTag @specType={{@selectedInstance.specType}} />
        {{/if}}
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
    boxelSpecInstances: BoxelSpec[];
    selectedInstance: BoxelSpec | null;
    selectBoxelSpec: (boxelSpec: BoxelSpec) => void;
    showCreateBoxelSpecIntent: boolean;
  };
}

class BoxelSpecPreviewContent extends GlimmerComponent<ContentSignature> {
  @service private declare realm: RealmService;

  get onlyOneInstance() {
    return this.args.boxelSpecInstances.length === 1;
  }

  @action realmInfo(card: BoxelSpec) {
    return this.realm.info(card.id);
  }

  @action getLocalPath(card: BoxelSpec) {
    let realmURL = this.realm.realmOfURL(new URL(card.id));
    if (!realmURL) {
      throw new Error('bug: no realm URL');
    }
    return getRelativePath(realmURL.href, card.id);
  }

  <template>
    {{#if @showCreateBoxelSpecIntent}}
      <div
        class='create-boxel-spec-intent-message'
        data-test-create-boxel-spec-intent-message
      >
        Create a Boxel Specification to be able to create new instances
      </div>
    {{else}}
      <div class='boxel-spec-preview'>
        <div class='boxel-spec-selector' data-test-boxel-spec-selector>
          <BoxelSelect
            @options={{@boxelSpecInstances}}
            @selected={{@selectedInstance}}
            @onChange={{@selectBoxelSpec}}
            @matchTriggerWidth={{true}}
            @disabled={{this.onlyOneInstance}}
            as |card|
          >
            {{#let (this.getLocalPath card) as |localPath|}}
              {{#let (this.realmInfo card) as |realmInfo|}}
                <div class='boxel-spec-selector-item'>
                  <RealmIcon class='url-realm-icon' @realmInfo={{realmInfo}} />
                  {{localPath}}
                </div>
              {{/let}}
            {{/let}}
          </BoxelSelect>
        </div>
        {{#if @selectedInstance}}
          {{#let (getComponent @selectedInstance) as |CardComponent|}}
            <CardComponent />
          {{/let}}
        {{/if}}
      </div>
    {{/if}}

    <style scoped>
      .create-boxel-spec-intent-message {
        align-content: center;
        text-align: center;
        background-color: var(--boxel-200);
        color: var(--boxel-450);
        font-weight: 500;
        padding: var(--boxel-sp-xl);
        height: 100%;
        width: 100%;
      }
      .boxel-spec-preview {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .boxel-spec-selector {
        padding-top: var(--boxel-sp-sm);
        padding-left: var(--boxel-sp-sm);
        min-width: 40%;
        align-self: flex-start;
      }
      .boxel-spec-selector-item {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
    </style>
  </template>
}

export default class BoxelSpecPreview extends GlimmerComponent<Signature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @tracked selectedInstance?: BoxelSpec = this.boxelSpecInstances[0];

  get realms() {
    return this.realmServer.availableRealmURLs;
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
        on: boxelSpecRef,
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

  boxelSpecSearch = getCards(
    () => this.boxelSpecQuery,
    () => this.realms,
    {
      isLive: true,
    },
  );

  get boxelSpecInstances() {
    return this.boxelSpecSearch.instances as BoxelSpec[];
  }

  private get showCreateBoxelSpecIntent() {
    return (
      !this.boxelSpecSearch.isLoading && this.boxelSpecInstances.length === 0
    );
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

  guessSpecType(selectedDeclaration: ModuleDeclaration): BoxelSpecType {
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
    throw new Error('Unidentified boxel spec');
  }

  @action private createBoxelSpec() {
    if (!this.args.selectedDeclaration) {
      throw new Error('bug: no selected declaration');
    }
    if (!this.getSelectedDeclarationAsCodeRef) {
      throw new Error('bug: no code ref');
    }
    let specType = this.guessSpecType(this.args.selectedDeclaration);
    let displayName = this.getSelectedDeclarationAsCodeRef.name;
    this.args.createFile(
      {
        id: 'boxel-spec-instance',
        displayName: 'Boxel Specification', //display name in modal
      },
      {
        displayName: displayName,
        ref: this.getSelectedDeclarationAsCodeRef,
        specType,
      },
    );
  }

  @action selectBoxelSpec(boxelSpec: BoxelSpec): void {
    this.selectedInstance = boxelSpec;
  }

  <template>
    {{#if (not this.boxelSpecSearch.isLoading)}}
      {{yield
        (component
          BoxelSpecPreviewTitle
          showCreateBoxelSpecIntent=this.showCreateBoxelSpecIntent
          boxelSpecInstances=this.boxelSpecInstances
          selectedInstance=this.selectedInstance
          createBoxelSpec=this.createBoxelSpec
          isCreateModalShown=@isCreateModalShown
        )
        (component
          BoxelSpecPreviewContent
          showCreateBoxelSpecIntent=this.showCreateBoxelSpecIntent
          boxelSpecInstances=this.boxelSpecInstances
          selectedInstance=this.selectedInstance
          selectBoxelSpec=this.selectBoxelSpec
        )
      }}
    {{/if}}
  </template>
}

function getComponent(cardOrField: BoxelSpec) {
  return cardOrField.constructor.getComponent(cardOrField);
}

interface SpecTagSignature {
  Element: HTMLDivElement;
  Args: {
    specType: string;
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
          <div class='spec-tagicon'>
            {{this.icon}}
          </div>
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
      }
    </style>
  </template>
}

function getIcon(specType: string) {
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
