import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import { BoxelDropdown, ContextButton, Menu, RealmIcon } from '@cardstack/boxel-ui/components';
import { MenuItem, cssVar } from '@cardstack/boxel-ui/helpers';
import { Group, IconGlobe, IconTrash, Lock, Star, StarFilled } from '@cardstack/boxel-ui/icons';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';

import ItemContainer from './item-container';
import WorkspaceLoadingIndicator from './workspace-loading-indicator';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    realmURL: string;
  };
}

export default class Workspace extends Component<Signature> {
  <template>
    {{#if this.loadRealmTask.isRunning}}
      <WorkspaceLoadingIndicator />
    {{else}}
      <div class='workspace-card' ...attributes>
        <ItemContainer
          data-test-workspace={{this.name}}
          {{on 'click' this.openWorkspace}}
        >
          <div
            class='icon'
            style={{cssVar
              workspace-background-image-url=this.backgroundImageURL
            }}
          >
            <div class='realm-icon-wrapper'>
              <RealmIcon
                class='workspace-realm-icon'
                @realmInfo={{this.realmInfo}}
              />
            </div>
          </div>
        </ItemContainer>
        <button
          class='tile-favorite-btn {{if this.isFavorited "is-favorited"}}'
          type='button'
          {{on 'click' this.toggleFavorite}}
          aria-label={{if this.isFavorited 'Unfavorite' 'Favorite'}}
        >
          {{#if this.isFavorited}}
            <StarFilled width='16' height='16' />
          {{else}}
            <Star width='16' height='16' />
          {{/if}}
        </button>
        <div class='tile-menu-btn'>
          <BoxelDropdown @autoClose={{true}}>
            <:trigger as |bindings|>
              <ContextButton @label='Options' @variant='ghost' @width='16' @height='16' {{bindings}} />
            </:trigger>
            <:content as |dd|>
              <Menu @items={{this.tileMenuItems}} @closeMenu={{dd.close}} />
            </:content>
          </BoxelDropdown>
        </div>
        <div class='info'>
          <span class='name' data-test-workspace-name>{{this.name}}</span>
          <span
            class='visibility'
            data-test-workspace-visibility
          >
            <this.visibilityIcon width='12' height='12' />
            {{this.visibility}}
          </span>
        </div>
      </div>
    {{/if}}
    <style scoped>
      .workspace-card {
        display: flex;
        flex-direction: column;
        width: fit-content;
        position: relative;
        cursor: pointer;
        --item-container-border-color: transparent;
        --item-container-border-hover-color: transparent;
      }
      .workspace-card::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 250px;
        height: 166px;
        box-sizing: border-box;
        border-radius: 15px;
        border: 1px solid rgba(255 255 255 / 25%);
        pointer-events: none;
        z-index: 20;
      }
      .workspace-card:hover::after {
        border-color: rgba(255 255 255 / 50%);
      }
      .tile-favorite-btn {
        position: absolute;
        top: 8px;
        left: 8px;
        z-index: 3;
        color: white;
        --icon-color: white;
        opacity: 0;
        transition: opacity 0.15s ease;
        background: none;
        border: none;
        padding: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .workspace-card:hover .tile-favorite-btn {
        opacity: 1;
      }
      .tile-favorite-btn:hover {
        background: rgba(0 0 0 / 40%);
        backdrop-filter: blur(6px);
        border-radius: 6px;
      }
      .tile-favorite-btn.is-favorited {
        color: #00FFBA;
        --icon-color: #00FFBA;
        opacity: 1;
      }
      .tile-menu-btn {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 3;
        color: white;
        opacity: 0;
        transition: opacity 0.15s ease;
        border-radius: 6px;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        --boxel-icon-button-width: 24px;
        --boxel-icon-button-height: 24px;
      }
      .workspace-card:hover .tile-menu-btn,
      .tile-menu-btn:focus-within {
        opacity: 1;
      }
      .tile-menu-btn:hover {
        background: rgba(0 0 0 / 40%);
        backdrop-filter: blur(6px);
      }
      .icon {
        background-color: var(--boxel-500);
        background-image: var(--workspace-background-image-url);
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;

        position: relative;
        height: 100%;
        width: 100%;

        display: flex;
        justify-content: center;
        align-items: center;
      }
      .realm-icon-wrapper {
        flex-shrink: 0;
        position: relative;
        z-index: 1;
        border-radius: calc(var(--boxel-border-radius-xs) + 6px);
        display: flex;
        box-shadow: 0 2px 6px rgb(0 0 0 / 30%);
      }
      .realm-icon-wrapper::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: inset 0 0 0 1px rgba(255 255 255 / 50%);
        z-index: 1;
        pointer-events: none;
      }
      .workspace-realm-icon {
        --boxel-realm-icon-size: 42px;
        --boxel-realm-icon-border-radius: calc(var(--boxel-border-radius-xs) + 6px);
        --boxel-realm-icon-background-color: var(--boxel-light);
      }
      .info {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: var(--boxel-sp-xs);
        gap: var(--boxel-sp-5xs);
      }
      .info > span {
        text-overflow: ellipsis;
        overflow: hidden;
        width: 100%;
        text-wrap: nowrap;
        text-align: center;
        letter-spacing: 0.4pt;
      }
      .name {
        color: var(--boxel-light);
        font: 400 var(--boxel-font-sm);
      }
      .visibility {
        color: var(--boxel-400);
        font: 400 var(--boxel-font-xs);
        text-transform: capitalize;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-5xs);
        --icon-color: var(--boxel-400);
      }
    </style>
  </template>

  @tracked isFavorited = false;

  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;

  constructor(...args: [any, any]) {
    super(...args);
    this.loadRealmTask.perform();
  }

  private loadRealmTask = task(async () => {
    await this.realm.login(this.args.realmURL);
    await this.realm.ensureRealmMeta(this.args.realmURL);
  });

  @cached
  private get realmInfo() {
    const info = this.realm.info(this.args.realmURL);
    if (info.name === 'Boxel Skills') {
      return { ...info, iconURL: '/assets/images/wrench-realm-icon.svg' };
    }
    if (info.name === 'Cardstack Catalog') {
      return { ...info, iconURL: '/assets/images/boxel-icon-figma.svg' };
    }
    return info;
  }

  private get name() {
    return this.realmInfo.name;
  }

  get tileMenuItems() {
    return [
      new MenuItem({
        label: this.isFavorited ? 'Unfavorite' : 'Favorite',
        icon: this.isFavorited ? StarFilled : Star,
        action: this.toggleFavorite,
      }),
      new MenuItem({ label: 'Delete Workspace', icon: IconTrash, action: () => {}, dangerous: true }),
    ];
  }

  @action toggleFavorite() {
    this.isFavorited = !this.isFavorited;
  }

  private get backgroundURL() {
    return this.realmInfo.backgroundURL;
  }

  private get backgroundImageURL() {
    return this.backgroundURL ? `url(${this.backgroundURL})` : '';
  }

  private get visibility() {
    return this.realmInfo.visibility;
  }

  private get visibilityIcon() {
    switch (this.visibility) {
      case 'public':
        return IconGlobe;
      case 'shared':
        return Group;
      case 'private':
        return Lock;
      default:
        throw new Error('unknown realm visibility');
    }
  }

  @action async openWorkspace() {
    await this.operatorModeStateService.openWorkspace(this.args.realmURL);
  }
}
