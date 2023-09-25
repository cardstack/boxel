import Component from '@glimmer/component';
import { service } from '@ember/service';
import { BaseDef, type CardDef } from 'https://cardstack.com/base/card-api';
import {
  cardTypeDisplayName,
  type RealmInfo,
  getPlural,
} from '@cardstack/runtime-common';
import {
  InstanceDefinitionContainer,
  ModuleDefinitionContainer,
  ClickableModuleDefinitionContainer,
} from './definition-container';
import { Ready } from '@cardstack/host/resources/file';
// @ts-expect-error cached doesn't have type yet
import { tracked, cached } from '@glimmer/tracking';
import {
  type AdoptionChainManager,
  type ElementInFile,
} from '@cardstack/host/resources/adoption-chain-manager';
import { hash, array } from '@ember/helper';
import { lastModifiedDate } from '../../resources/last-modified-date';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import { action } from '@ember/object';
import BoxelMenu from '@cardstack/boxel-ui/components/menu';
import { MenuItem, menuItemFunc } from '@cardstack/boxel-ui/helpers/menu-item';
import { CardContainer } from '@cardstack/boxel-ui';
import { LoadingIndicator } from '@cardstack/boxel-ui';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import Label from '@cardstack/boxel-ui/components/label';
import { not } from '@cardstack/boxel-ui/helpers/truth-helpers';

interface Signature {
  Element: HTMLElement;
  Args: {
    realmInfo: RealmInfo | null;
    readyFile: Ready;
    cardInstance: CardDef | undefined;
    adoptionChainManager?: AdoptionChainManager;
    delete: () => void;
  };
}

export default class CardInheritancePanel extends Component<Signature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  private lastModified = lastModifiedDate(this, () => this.args.readyFile);

  get selectedElement() {
    return this.args.adoptionChainManager?.selectedElement;
  }

  get cardType() {
    return this.selectedElement?.cardType;
  }

  get elementsInFile() {
    return this.args.adoptionChainManager?.elementsInFile;
  }

  get buildMenuItems(): MenuItem[] {
    if (!this.elementsInFile) {
      return [];
    }
    return this.elementsInFile.map((el) => {
      const isSelected = this.selectedElement === el;
      return menuItemFunc(
        [
          this.getCardTypeDisplayName(el.card),
          () => {
            this.select(el);
          },
        ],
        { selected: isSelected },
      );
    });
  }

  get numberOfElementsInFileString() {
    let numberOfElements = this.elementsInFile?.length || 0;
    return `${numberOfElements} ${getPlural('item', numberOfElements)}`;
  }

  get isLoading() {
    return (
      this.args.adoptionChainManager?.isLoading || this.cardType?.isLoading
    );
  }

  @action
  updateCodePath(url: URL | undefined) {
    if (url) {
      this.operatorModeStateService.updateCodePath(url);
    }
  }

  get isCardInstance() {
    return this.args.readyFile.url.endsWith('.json');
  }

  @action
  select(el: ElementInFile) {
    this.args.adoptionChainManager?.select(el);
  }

  <template>
    <div class='container' ...attributes>
      {{#if this.isLoading}}
        <div class='loading'>
          <LoadingIndicator />
        </div>
      {{else}}
        {{#if (not this.isCardInstance)}}
          <div>
            <div class='panel-header'>
              <header
                class='inner-container__header'
                aria-label='In This File Header'
              >
                In This File
              </header>
              <span class='number-items'>{{this.numberOfElementsInFileString}}
              </span>
            </div>
            <div class='in-this-file-panel'>
              <CardContainer>
                <div class='banner'>
                  <Label class='banner-title'>
                    {{@readyFile.name}}</Label>
                </div>
                <BoxelMenu
                  @class='in-this-file-menu'
                  @items={{this.buildMenuItems}}
                />
              </CardContainer>
            </div>
          </div>
        {{/if}}
        <div>
          <header
            class='inner-container__header'
            aria-label='Inheritance Panel Header'
          >
            Inheritance Panel
          </header>
          <div class='inheritance-panel'>
            {{#if this.isCardInstance}}
              {{! JSON case when visting, eg Author/1.json }}
              <InstanceDefinitionContainer
                @name={{@cardInstance.title}}
                @fileExtension='.JSON'
                @realmInfo={{@realmInfo}}
                @infoText={{this.lastModified.value}}
                @actions={{array
                  (hash label='Delete' handler=@delete icon='icon-trash')
                }}
              />
              <div class='chain'>
                {{svgJar
                  'icon-inherit'
                  class='chain-icon'
                  width='24px'
                  height='24px'
                  role='presentation'
                }}
                Adopts from
              </div>

              <ClickableModuleDefinitionContainer
                @name={{this.cardType.type.displayName}}
                @fileExtension={{this.cardType.type.moduleMeta.extension}}
                @realmInfo={{this.cardType.type.moduleMeta.realmInfo}}
                @onSelectDefinition={{this.updateCodePath}}
                @url={{this.cardType.type.module}}
              />
            {{else}}
              {{! Module case when visting, eg author.gts }}
              <ModuleDefinitionContainer
                @name={{this.cardType.type.displayName}}
                @fileExtension={{this.cardType.type.moduleMeta.extension}}
                @realmInfo={{this.cardType.type.moduleMeta.realmInfo}}
                @infoText={{this.lastModified.value}}
                @isActive={{true}}
                @actions={{array
                  (hash label='Delete' handler=@delete icon='icon-trash')
                }}
              />
              {{#if this.cardType.type.super}}
                <div class='chain'>
                  {{svgJar
                    'icon-inherit'
                    class='chain-icon'
                    width='24px'
                    height='24px'
                    role='presentation'
                  }}
                  Inherits from
                </div>
                <ClickableModuleDefinitionContainer
                  @name={{this.cardType.type.super.displayName}}
                  @fileExtension={{this.cardType.type.super.moduleMeta.extension}}
                  @realmInfo={{this.cardType.type.super.moduleMeta.realmInfo}}
                  @onSelectDefinition={{this.updateCodePath}}
                  @url={{this.cardType.type.super.module}}
                />
              {{/if}}
            {{/if}}
          </div>
        </div>
      {{/if}}
    </div>
    <style>
      .inner-container__header {
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .container {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        height: 100%;
      }
      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .number-items {
        color: #919191;
        font-size: var(--boxel-font-size-sm);
        font-weight: 200;
        letter-spacing: var(--boxel-lsp-xxl);
        text-transform: uppercase;
      }
      .selected {
        outline: 2px solid var(--boxel-highlight);
      }
      .in-this-file-panel {
        padding: var(--boxel-sp-sm);
      }
      .inheritance-panel {
        padding: var(--boxel-sp-sm);
        gap: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
      }
      .in-this-file-menu {
        padding: var(--boxel-sp-xs);
      }
      .banner {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--boxel-sp-xxs) var(--boxel-sp-sm) var(--boxel-sp-xxs);
        border-top-left-radius: var(--boxel-border-radius);
        border-top-right-radius: var(--boxel-border-radius);
        background-color: var(--boxel-100);
      }

      .banner-title {
        font-size: var(--boxel-font-size-sm);
        font-weight: 200;
        letter-spacing: var(--boxel-lsp-xxl);
        text-transform: uppercase;
      }
      .loading {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100%;
      }
      .chain {
        display: flex;
        font-size: var(--boxel-font-size-sm);
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        justify-content: center;
      }

      .chain-icon {
        --icon-color: var(--boxel-dark);
        --icon-bg: var(--boxel-dark);
        --icon-border: var(--boxel-dark);
      }
    </style>
  </template>

  getCardTypeDisplayName(t: typeof BaseDef) {
    let card = new t();
    return cardTypeDisplayName(card);
  }
}
