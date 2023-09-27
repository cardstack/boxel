import { hash, array } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';

import Component from '@glimmer/component';

// @ts-expect-error cached doesn't have type yet
import { tracked, cached } from '@glimmer/tracking';

import { type RealmInfo } from '@cardstack/runtime-common';

import { hasExecutableExtension, getPlural } from '@cardstack/runtime-common';

import { type Ready } from '@cardstack/host/resources/file';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import { lastModifiedDate } from '../../resources/last-modified-date';

import {
  FileDefinitionContainer,
  InstanceDefinitionContainer,
  ModuleDefinitionContainer,
  ClickableModuleDefinitionContainer,
} from './definition-container';

import type { ElementInFile } from './code-mode';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import BoxelMenu from '@cardstack/boxel-ui/components/menu';
import { MenuItem, menuItemFunc } from '@cardstack/boxel-ui/helpers/menu-item';
import { CardContainer, LoadingIndicator } from '@cardstack/boxel-ui';
import Label from '@cardstack/boxel-ui/components/label';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { or } from '@cardstack/boxel-ui/helpers/truth-helpers';

interface Signature {
  Element: HTMLElement;
  Args: {
    realmInfo: RealmInfo | null;
    readyFile: Ready;
    cardInstance: CardDef | undefined;
    selectedElement?: ElementInFile;
    elements: ElementInFile[];
    selectElement: (el: ElementInFile) => void;
    delete: () => void;
  };
}

export default class DetailPanel extends Component<Signature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  private lastModified = lastModifiedDate(this, () => this.args.readyFile);

  get cardType() {
    return this.args.selectedElement?.cardType;
  }

  get isLoading() {
    return (
      this.args.elements.some(({ cardType }) => {
        return cardType?.isLoading;
      }) || this.cardType?.isLoading
    );
  }

  @action
  updateCodePath(url: URL | undefined) {
    if (url) {
      this.operatorModeStateService.updateCodePath(url);
    }
  }

  @action
  isSelected(el: ElementInFile) {
    return this.args.selectedElement === el;
  }

  get isCardInstance() {
    return this.args.readyFile.url.endsWith('.json');
  }
  get isModule() {
    return hasExecutableExtension(this.args.readyFile.url);
  }

  get isBinary() {
    return this.args.readyFile.isBinary;
  }

  private get fileExtension() {
    if (!this.args.cardInstance) {
      return '.' + this.args.readyFile.url.split('.').pop() || '';
    } else {
      return '';
    }
  }

  get buildMenuItems(): MenuItem[] {
    if (!this.args.elements) {
      return [];
    }
    return this.args.elements.map((el) => {
      const isSelected = this.args.selectedElement === el;
      return menuItemFunc(
        [
          el.card.displayName,
          () => {
            this.args.selectElement(el);
          },
        ],
        { selected: isSelected },
      );
    });
  }

  get numberOfElementsInFileString() {
    let numberOfElements = this.args.elements?.length || 0;
    return `${numberOfElements} ${getPlural('item', numberOfElements)}`;
  }

  <template>
    <div ...attributes>
      {{#if this.isLoading}}
        <div class='loading'>
          <LoadingIndicator />
        </div>
      {{else}}
        {{#if this.isModule}}
          <div class='in-this-file-panel'>
            <div class='in-this-file-panel-banner'>
              <header class='panel-header' aria-label='In This File Header'>
                In This File
              </header>
              <span class='number-items'>{{this.numberOfElementsInFileString}}
              </span>
            </div>
            <CardContainer>
              <div class='banner'>
                <Label class='banner-title'>
                  {{@readyFile.name}}</Label>
              </div>
              <BoxelMenu
                @class='in-this-file-menu'
                @items={{this.buildMenuItems}}
                @itemClass='in-this-file-menu-item'
              />
            </CardContainer>
          </div>
        {{/if}}

        {{#if (or this.isCardInstance this.isModule)}}
          <div class='inheritance-panel'>
            <header class='panel-header' aria-label='Inheritance Panel Header'>
              Card Inheritance
            </header>
            {{#if this.isCardInstance}}
              {{! JSON case when visting, eg Author/1.json }}
              <InstanceDefinitionContainer
                @fileURL={{@readyFile.url}}
                @name={{@cardInstance.title}}
                @fileExtension='.JSON'
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
                @fileURL={{this.cardType.type.module}}
                @name={{this.cardType.type.displayName}}
                @fileExtension={{this.cardType.type.moduleMeta.extension}}
                @onSelectDefinition={{this.updateCodePath}}
                @url={{this.cardType.type.module}}
              />
            {{else if this.isModule}}
              <ModuleDefinitionContainer
                @fileURL={{this.cardType.type.module}}
                @name={{this.cardType.type.displayName}}
                @fileExtension={{this.cardType.type.moduleMeta.extension}}
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
                  @fileURL={{this.cardType.type.super.module}}
                  @name={{this.cardType.type.super.displayName}}
                  @fileExtension={{this.cardType.type.super.moduleMeta.extension}}
                  @onSelectDefinition={{this.updateCodePath}}
                  @url={{this.cardType.type.super.module}}
                />
              {{/if}}
            {{/if}}
          </div>
        {{/if}}

        {{#if this.isBinary}}
          <div class='details-panel'>
            <header class='panel-header' aria-label='Details Panel Header'>
              Details
            </header>
            <FileDefinitionContainer
              @fileURL={{@readyFile.url}}
              @fileExtension={{this.fileExtension}}
              @infoText={{this.lastModified.value}}
              @actions={{array
                (hash label='Delete' handler=@delete icon='icon-trash')
              }}
            />
          </div>
        {{/if}}
      {{/if}}
    </div>
    <style>
      .in-this-file-panel-banner {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .panel-header {
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
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
      .in-this-file-panel,
      .details-panel,
      .inheritance-panel {
        padding-top: var(--boxel-sp-sm);
        gap: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
      }
      .in-this-file-menu {
        padding: var(--boxel-sp-xs);
      }

      :global(.in-this-file-menu-item) {
        --boxel-menu-selected-background-color: var(--boxel-highlight);
        --boxel-menu-selected-font-color: var(--boxel-light-100);
        --boxel-menu-selected-hover-font-color: var(--boxel-dark);
      }
      :global(.in-this-file-menu-item .check-icon) {
        display: none;
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
      }
      .chain {
        display: flex;
        font-size: var(--boxel-font-size);
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        justify-content: center;
      }
      .chain-icon {
        --icon-color: var(--boxel-dark);
      }
    </style>
  </template>
}
