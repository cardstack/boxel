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

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import {
  type ResolvedCodeRef,
  specRef,
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

import RealmService, {
  EnhancedRealmInfo,
} from '@cardstack/host/services/realm';

import type RealmServerService from '@cardstack/host/services/realm-server';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import { Spec, type SpecType } from 'https://cardstack.com/base/spec';

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
        specType?: SpecType;
      },
      sourceInstance?: CardDef,
    ) => Promise<void>;
    isCreateModalShown: boolean;
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof SpecPreviewTitle,
        | 'showCreateSpecIntent'
        | 'specInstances'
        | 'selectedInstance'
        | 'createSpec'
        | 'isCreateModalShown'
      >,
      WithBoundArgs<
        typeof SpecPreviewContent,
        | 'showCreateSpecIntent'
        | 'specInstances'
        | 'selectedInstance'
        | 'selectSpec'
        | 'isLoading'
      >,
    ];
  };
}

interface TitleSignature {
  Args: {
    specInstances: Spec[];
    selectedInstance: Spec | null;
    showCreateSpecIntent: boolean;
    createSpec: () => void;
    isCreateModalShown: boolean;
  };
}

class SpecPreviewTitle extends GlimmerComponent<TitleSignature> {
  get numberOfInstances() {
    return this.args.specInstances?.length;
  }

  get moreThanOneInstance() {
    return this.numberOfInstances > 1;
  }

  <template>
    Boxel Spec

    <span class='has-spec' data-test-has-spec>
      {{#if @showCreateSpecIntent}}
        <BoxelButton
          @kind='primary'
          @size='small'
          @disabled={{@isCreateModalShown}}
          {{on 'click' @createSpec}}
          data-test-create-spec-button
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
    specInstances: Spec[];
    selectedInstance: Spec | null;
    selectSpec: (spec: Spec) => void;
    showCreateSpecIntent: boolean;
    isLoading: boolean;
  };
}

class SpecPreviewContent extends GlimmerComponent<ContentSignature> {
  @service private declare realm: RealmService;

  get onlyOneInstance() {
    return this.args.specInstances.length === 1;
  }

  get dropdownData() {
    return this.args.specInstances.map((spec) => {
      let realmInfo = this.realm.info(spec.id);
      let realmURL = this.realm.realmOfURL(new URL(spec.id));
      if (!realmURL) {
        throw new Error('bug: no realm URL');
      }
      return {
        id: spec.id,
        realmInfo,
        localPath: getRelativePath(realmURL.href, spec.id),
      };
    });
  }

  get selectedDropdownData() {
    return this.dropdownData.find(
      ({ id }) => id === this.args.selectedInstance?.id,
    );
  }

  @action selectDropdownData(data: DropdownData) {
    let selectedSpec = this.args.specInstances.find(
      (spec) => spec.id === data.id,
    );
    if (!selectedSpec) {
      throw new Error('No spec selected');
    }
    this.args.selectSpec(selectedSpec);
  }

  <template>
    <section class='spec-preview'>
      {{#if @isLoading}}
        <div class='loading'>
          <LoadingIndicator class='loading-icon' />
          Loading...
        </div>
      {{else if @showCreateSpecIntent}}
        <div
          class='create-spec-intent-message'
          data-test-create-spec-intent-message
        >
          Create a Boxel Specification to be able to create new instances
        </div>
      {{else}}
        <div class='spec-selector' data-test-spec-selector>
          <BoxelSelect
            @options={{this.dropdownData}}
            @selected={{this.selectedDropdownData}}
            @onChange={{this.selectDropdownData}}
            @matchTriggerWidth={{true}}
            @disabled={{this.onlyOneInstance}}
            as |d|
          >
            <div class='spec-selector-item'>
              <RealmIcon class='url-realm-icon' @realmInfo={{d.realmInfo}} />
              {{d.localPath}}
            </div>
          </BoxelSelect>
        </div>
        {{#if @selectedInstance}}
          {{#let (getComponent @selectedInstance) as |CardComponent|}}
            <CardComponent />
          {{/let}}
        {{/if}}
      {{/if}}
    </section>

    <style scoped>
      .spec-preview {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        height: 100%;
        width: 100%;
        padding: var(--boxel-sp-sm);
      }
      .create-spec-intent-message {
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
}

interface DropdownData {
  id: string;
  realmInfo: EnhancedRealmInfo;
  localPath: string;
}

export default class SpecPreview extends GlimmerComponent<Signature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @tracked _selectedInstance?: Spec;

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

  specSearch = getCards(
    () => this.specQuery,
    () => this.realms,
    {
      isLive: true,
    },
  );

  get specInstances() {
    return this.specSearch.instances as Spec[];
  }

  private get showCreateSpecIntent() {
    return !this.specSearch.isLoading && this.specInstances.length === 0;
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

  @action private createSpec() {
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
        id: 'spec-instance',
        displayName: 'Boxel Specification', //display name in modal
      },
      {
        displayName: displayName,
        ref: this.getSelectedDeclarationAsCodeRef,
        specType,
      },
    );
  }

  @action selectSpec(spec: Spec): void {
    this._selectedInstance = spec;
  }

  get selectedInstance() {
    return (
      this._selectedInstance ??
      (this.specInstances.length ? this.specInstances[0] : null)
    );
  }

  <template>
    {{yield
      (component
        SpecPreviewTitle
        showCreateSpecIntent=this.showCreateSpecIntent
        specInstances=this.specInstances
        selectedInstance=this.selectedInstance
        createSpec=this.createSpec
        isCreateModalShown=@isCreateModalShown
      )
      (component
        SpecPreviewContent
        showCreateSpecIntent=this.showCreateSpecIntent
        specInstances=this.specInstances
        selectedInstance=this.selectedInstance
        selectSpec=this.selectSpec
        isLoading=this.specSearch.isLoading
      )
    }}
  </template>
}

function getComponent(cardOrField: Spec) {
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
