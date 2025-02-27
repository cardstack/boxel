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
import { stringify } from 'qs';

import {
  BoxelButton,
  Pill,
  BoxelSelect,
  RealmIcon,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { cn, gt, eq, and, not } from '@cardstack/boxel-ui/helpers';

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

import { getCard } from '@cardstack/host/resources/card-resource';

import {
  type CardOrFieldDeclaration,
  isCardOrFieldDeclaration,
  type ModuleDeclaration,
} from '@cardstack/host/resources/module-contents';

import type CardService from '@cardstack/host/services/card-service';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import { Spec, type SpecType } from 'https://cardstack.com/base/spec';

import type { WithBoundArgs } from '@glint/template';

function getRelativePath(baseUrl: string, targetUrl: string) {
  const basePath = new URL(baseUrl).pathname;
  const targetPath = new URL(targetUrl).pathname;
  return targetPath.replace(basePath, '') || '/';
}

interface Signature {
  Element: HTMLElement;
  Args: {
    selectedDeclaration?: ModuleDeclaration;
  };
  Blocks: {
    default: [];
  };
}

export default class SpecPreview extends GlimmerComponent<Signature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare environmentService: EnvironmentService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @service private declare cardService: CardService;
  @tracked private _selectedId?: string;
  @tracked private newCardJSON: LooseSingleCardDocument | undefined;
  @tracked ids: string[] = [];
  @tracked isLoading = true;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    this.loadSpecs.perform();
  }

  // Use a task instead of PrerenderedCardSearch to fetch specs
  loadSpecs = task(async () => {
    this.isLoading = true;
    try {
      // Direct call to search API
      const query = this.specQuery;
      const specIds = await this.fetchSpecIds(query);
      this.ids = specIds;

      // If we have results and no selected ID, select the first one
      if (this.ids.length > 0 && !this._selectedId) {
        this._selectedId = this.ids[0];
      }
    } catch (error) {
      console.error('Error loading specs:', error);
    } finally {
      this.isLoading = false;
    }
  });

  // Directly fetch spec IDs from the server using the same approach as PrerenderedCardSearch
  async fetchSpecIds(query: Query): Promise<string[]> {
    const results: string[] = [];

    for (const realmURL of this.realms) {
      try {
        // Use stringify from 'qs' with the same options as PrerenderedCardSearch
        const response = await this.cardService.fetchJSON(
          `${realmURL}_search?${stringify(query, {
            strictNullHandling: true,
          })}`,
        );

        if (response && response.data) {
          const ids = response.data.map((item: any) => item.id);
          results.push(...ids);
        }
      } catch (error) {
        console.error(`Failed to search realm ${realmURL}:`, error);
      }
    }

    return results;
  }

  @action
  selectId(id: string) {
    this._selectedId = id;
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
      this.newCardJSON = {
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
      await this.cardResource.loaded;
      if (this.card) {
        this._selectedId = undefined;
        this.newCardJSON = undefined;
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
          ref: this.getSelectedDeclarationAsCodeRef,
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

  get showCreateSpecIntent() {
    return this.ids.length === 0 && this.canWrite;
  }

  get onlyOneInstance() {
    return this.ids.length <= 1;
  }

  get displayIsolated() {
    return !this.canWrite && this.ids.length > 0;
  }

  get displayCannotWrite() {
    return !this.canWrite && this.ids.length === 0;
  }

  //TODO: Improve identification of isApp and isSkill
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

  get canWrite() {
    return this.realm.canWrite(this.operatorModeStateService.realmURL.href);
  }

  private cardResource = getCard(
    this,
    () => this.newCardJSON ?? this.selectedId,
    {
      isAutoSave: () => true,
    },
  );

  get card() {
    if (!this.cardResource.card) {
      return undefined;
    }
    return this.cardResource.card as Spec;
  }

  get specType() {
    return this.card?.specType as SpecType;
  }

  @action
  getDropdownData(url: string) {
    let realmInfo = this.realm.info(url);
    let realmURL = this.realm.realmOfURL(new URL(url));
    if (!realmURL) {
      throw new Error('bug: no realm URL');
    }
    return {
      id: url,
      realmInfo,
      localPath: getRelativePath(realmURL.href, url),
    };
  }

  <template>
    <div class='spec-preview-container'>
      <div class='spec-preview-title'>
        Boxel Spec

        <span class='has-spec' data-test-has-spec>
          {{#if this.showCreateSpecIntent}}
            <BoxelButton
              @kind='primary'
              @size='small'
              @loading={{this.createSpecInstance.isRunning}}
              {{on 'click' this.createSpec}}
              data-test-create-spec-button
            >
              Create
            </BoxelButton>
          {{else if (gt this.ids.length 1)}}
            <div class='number-of-instance'>
              <DotIcon class='dot-icon' />
              <div class='number-of-instance-text'>
                {{this.ids.length}}
                instances
              </div>
            </div>
          {{else}}
            {{#if this.specType}}
              <SpecTag @specType={{this.specType}} />
            {{/if}}
          {{/if}}
        </span>
      </div>

      <div class='spec-preview-content'>
        {{#if this.isLoading}}
          <div class='container'>
            <div class='loading'>
              <LoadingIndicator class='loading-icon' />
              Loading...
            </div>
          </div>
        {{else}}
          <div
            class={{cn
              'container'
              spec-intent-message=this.showCreateSpecIntent
              cannot-write=this.displayCannotWrite
            }}
          >
            {{#if this.showCreateSpecIntent}}
              <div data-test-create-spec-intent-message>
                Create a Boxel Specification to be able to create new instances
              </div>
            {{else if this.displayCannotWrite}}
              <div data-test-cannot-write-intent-message>
                Cannot create new Boxel Specification inside this realm
              </div>
            {{else if this.card}}
              <div class='spec-preview'>
                <div class='spec-selector' data-test-spec-selector>
                  <BoxelSelect
                    @options={{this.ids}}
                    @selected={{this.selectedId}}
                    @onChange={{this.selectId}}
                    @matchTriggerWidth={{true}}
                    @disabled={{this.onlyOneInstance}}
                    as |id|
                  >
                    {{#if id}}
                      {{#let (this.getDropdownData id) as |data|}}
                        {{#if data}}
                          <div class='spec-selector-item'>
                            <RealmIcon
                              @canAnimate={{true}}
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

                {{#let (getComponent this.card) as |CardComponent|}}
                  {{#if this.displayIsolated}}
                    <CardComponent @format='isolated' />
                  {{else}}
                    <CardComponent @format='edit' />
                  {{/if}}
                {{/let}}
              </div>
            {{/if}}
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .spec-preview-container {
        display: flex;
        flex-direction: column;
        width: 100%;
      }
      .spec-preview-title {
        display: flex;
        align-items: center;
        font-weight: 500;
      }
      .spec-preview-content {
        margin-top: var(--boxel-sp-sm);
      }
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
      .spec-preview {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        width: 100%;
        padding: var(--boxel-sp-sm);
      }
      .spec-intent-message,
      .cannot-write {
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
      return null;
  }
}
