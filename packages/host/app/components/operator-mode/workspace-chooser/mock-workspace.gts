import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { fn, hash } from '@ember/helper';

import { BoxelDropdown, ContextButton, Menu, RealmIcon } from '@cardstack/boxel-ui/components';
import { MenuItem, cssVar, eq } from '@cardstack/boxel-ui/helpers';
import CircleAlert from '@cardstack/boxel-icons/circle-alert';
import House from '@cardstack/boxel-icons/house';
import { IconGlobe, IconTrash, Lock, Star, StarFilled } from '@cardstack/boxel-ui/icons';

import ItemContainer from './item-container';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    name: string;
    backgroundImageURL: string;
    realmIconURL?: string;
    hosted?: boolean;
    hostLocations?: Array<{ realmIconURL: string; url: string }>;
    visibility?: 'public' | 'private';
    isFavorited?: boolean;
    onToggleFavorite?: () => void;
    darken?: boolean;
  };
}

export default class MockWorkspace extends Component<Signature> {
  @tracked isDropdownOpen = false;
  @tracked isDeleteModalOpen = false;
  @tracked private _localIsFavorited = this.args.isFavorited ?? false;

  get isFavorited() {
    return this.args.onToggleFavorite
      ? (this.args.isFavorited ?? false)
      : this._localIsFavorited;
  }

  get generatedURL() {
    const slug = this.args.name.toLowerCase().replace(/\s+/g, '-');
    return `app.boxel.ai/${slug}`;
  }

  get tileMenuItems() {
    return [
      new MenuItem({
        label: this.isFavorited ? 'Unfavorite' : 'Favorite',
        icon: this.isFavorited ? StarFilled : Star,
        action: this.toggleFavorite,
      }),
      new MenuItem({ label: 'Delete Workspace', icon: IconTrash, action: this.openDeleteModal, dangerous: true }),
    ];
  }

  @action openDeleteModal() {
    this.isDeleteModalOpen = true;
  }

  @action closeDeleteModal() {
    this.isDeleteModalOpen = false;
  }

  @action toggleFavorite() {
    if (this.args.onToggleFavorite) {
      this.args.onToggleFavorite();
    } else {
      this._localIsFavorited = !this._localIsFavorited;
    }
  }

  @action toggleDropdown(event: MouseEvent) {
    event.stopPropagation();
    if (!this.args.hosted || !this.args.hostLocations?.length) return;
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  @action selectHost(_url: string, event: MouseEvent) {
    event.stopPropagation();
    this.isDropdownOpen = false;
  }

  @action closeDropdown() {
    this.isDropdownOpen = false;
  }

  <template>
    <div
      class='workspace-card {{if this.isDropdownOpen "is-open"}}'
      {{on 'mouseleave' this.closeDropdown}}
    >
      <ItemContainer>
        <div
          class='icon {{if @darken "icon--darken"}}'
          style={{cssVar workspace-background-image-url=@backgroundImageURL}}
        >
        </div>
      </ItemContainer>

      {{#if @realmIconURL}}
        <div class='realm-icon-wrapper'>
          <RealmIcon
            class='floating-realm-icon'
            @realmInfo={{hash iconURL=@realmIconURL name=@name publishable=null}}
          />
        </div>
      {{/if}}

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

      {{#if @hosted}}
        <button
          class='host-trigger'
          type='button'
          {{on 'click' this.toggleDropdown}}
        >
          <span class='trigger-house'><House width='13' height='13' /></span>
          <span class='trigger-url'>{{this.generatedURL}}</span>
          {{#if @hostLocations}}
            <span class='trigger-chevron'>▾</span>
          {{/if}}
        </button>

        {{#if this.isDropdownOpen}}
          <div class='host-dropdown'>
            <span class='dropdown-header'>Launch in new window</span>
            <ul class='dropdown-list'>
              {{#each @hostLocations as |location|}}
                <li>
                  <button
                    type='button'
                    class='dropdown-option'
                    {{on 'click' (fn this.selectHost location.url)}}
                  >
                    <span class='option-url'>{{location.url}}</span>
                  </button>
                </li>
              {{/each}}
            </ul>
          </div>
        {{/if}}
      {{/if}}

      <div class='info {{if this.isDropdownOpen "info--hidden"}}'>
        <span class='name'>{{@name}}</span>
        <span class='visibility'>
          {{#if @hosted}}
            <span class='hosted-icon'>
              <House width='13' height='13' />
            </span>
          {{/if}}
          {{#if (eq @visibility 'private')}}
            <Lock width='12' height='12' />
            Private
          {{else}}
            <IconGlobe width='12' height='12' />
            Public
          {{/if}}
        </span>
      </div>
    </div>

    {{#if this.isDeleteModalOpen}}
      <div class='delete-modal-overlay' role='dialog' aria-modal='true'>
        <button
          type='button'
          class='delete-modal-scrim'
          {{on 'click' this.closeDeleteModal}}
          aria-label='Close'
        ></button>
        <div class='delete-modal'>
          <div class='delete-modal__header'>
            <CircleAlert class='delete-modal__warning-icon' />
            <h2 class='delete-modal__title'>Delete Workspace</h2>
          </div>

          <div class='delete-modal__workspace-card'>
            {{#if @realmIconURL}}
              <div class='delete-modal__realm-icon-wrapper'>
                <RealmIcon
                  class='delete-modal__realm-icon'
                  @realmInfo={{hash iconURL=@realmIconURL name=@name publishable=null}}
                />
              </div>
            {{/if}}
            <div class='delete-modal__workspace-info'>
              <span class='delete-modal__workspace-name'>{{@name}}</span>
              <span class='delete-modal__workspace-meta'>Contains <strong>2 cards</strong> and <strong>1 definition</strong></span>
            </div>
          </div>

          <div class='delete-modal__warning-box'>
            <p class='delete-modal__warning-text'>
              <strong>This permanently deletes the workspace and any custom domains tied to it.</strong>
              <strong>Links to cards in this workspace may stop working elsewhere.</strong>
            </p>
            {{#if @hostLocations.length}}
              <div class='delete-modal__realms'>
                <p class='delete-modal__realms-title'>Published realms that will also be removed</p>
                <ul class='delete-modal__realms-list'>
                  {{#each @hostLocations as |location|}}
                    <li>{{location.url}}</li>
                  {{/each}}
                </ul>
              </div>
            {{/if}}
          </div>

          <div class='delete-modal__footer'>
            <div class='delete-modal__actions'>
              <button
                type='button'
                class='delete-modal__cancel'
                {{on 'click' this.closeDeleteModal}}
              >Cancel</button>
              <button type='button' class='delete-modal__confirm'>
                Delete this workspace
              </button>
            </div>
            <span class='delete-modal__disclaimer'>This action is not reversible</span>
          </div>
        </div>
      </div>
    {{/if}}

    <style scoped>
      .workspace-card {
        display: flex;
        flex-direction: column;
        width: fit-content;
        position: relative;
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
        justify-content: flex-start;
        align-items: flex-end;
        padding: var(--boxel-sp-xs);
      }
      .realm-icon-wrapper {
        position: absolute;
        left: 50%;
        top: 83px; /* vertical center of 166px tile */
        transform: translate(-50%, -50%);
        z-index: 8; /* above trigger bar (z-index: 7) */
        pointer-events: none;
        border-radius: calc(var(--boxel-border-radius-xs) + 6px);
        display: flex;
        box-shadow: 0 2px 6px rgb(0 0 0 / 30%);
      }
      .realm-icon-wrapper::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: 0 0 0 1px rgba(255 255 255 / 50%);
        z-index: 1;
        pointer-events: none;
      }
      .floating-realm-icon {
        --boxel-realm-icon-size: 40px;
        --boxel-realm-icon-border-radius: calc(var(--boxel-border-radius-xs) + 6px);
        --boxel-realm-icon-background-color: var(--boxel-light);
      }

      .tile-favorite-btn {
        position: absolute;
        top: 8px;
        left: 8px;
        z-index: 9;
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
        z-index: 9;
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
        background: rgba(0 0 0 / 50%);
        backdrop-filter: blur(6px);
      }

      /* Host trigger bar — overlaid at bottom of the 166px tile image */
      .host-trigger {
        position: absolute;
        top: calc(166px - 36px);
        left: 0;
        width: 250px;
        height: 36px;
        background: rgba(0 0 0 / 40%);
        backdrop-filter: blur(6px);
        border: none;
        border-radius: 0 0 15px 15px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 10px 0 15px;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.5s ease;
        z-index: 7; /* above diagonal cards (max z-index: 6) */
        overflow: hidden;
      }
      .workspace-card:hover .host-trigger,
      .workspace-card.is-open .host-trigger {
        opacity: 1;
        transition: none; /* appear instantly; fade-out is governed by the default state's 0.5s */
      }
      .trigger-house {
        color: #00FFBA;
        display: flex;
        align-items: center;
        flex-shrink: 0;
      }
      .trigger-url {
        font-size: 11px;
        color: white;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        text-align: left;
      }
      .trigger-chevron {
        font-size: 12px;
        color: white;
        flex-shrink: 0;
      }

      /* Host dropdown */
      .host-dropdown {
        position: absolute;
        top: 166px;
        left: 0;
        width: 250px;
        background: white;
        border-radius: 10px;
        box-shadow: 0 4px 16px rgba(0 0 0 / 25%);
        z-index: 10;
        padding: 10px 0 6px;
        display: flex;
        flex-direction: column;
      }
      .dropdown-header {
        font-size: 11px;
        font-weight: 600;
        color: #444;
        padding: 0 12px 8px;
        border-bottom: 1px solid rgba(0 0 0 / 8%);
        display: block;
      }
      .dropdown-list {
        list-style: none;
        margin: 0;
        padding: 4px 6px;
      }
      .dropdown-list li {
        margin: 0;
        padding: 0;
      }
      .dropdown-option {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        background: none;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        text-align: left;
      }
      .dropdown-option:hover {
        background: rgba(0 0 0 / 6%);
      }
      .option-url {
        font-size: 12px;
        color: #1a1628;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .info {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: var(--boxel-sp-xs);
        gap: var(--boxel-sp-5xs);
      }
      .info--hidden {
        visibility: hidden;
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
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-5xs);
        --icon-color: var(--boxel-400);
      }
      .hosted-icon {
        color: #00FFBA;
        display: flex;
        align-items: center;
        margin-right: 2px;
      }

      /* Delete Workspace Modal */
      .delete-modal-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
      }
      .delete-modal-scrim {
        position: absolute;
        inset: 0;
        background: rgb(0 0 0 / 35%);
        border: none;
        padding: 0;
        cursor: default;
      }
      .delete-modal {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-lg) 30px 30px;
        background: white;
        border-radius: 20px;
        width: 650px;
        box-shadow: 0 24px 60px rgb(0 0 0 / 35%), 0 8px 20px rgb(0 0 0 / 20%);
      }
      .delete-modal__header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .delete-modal__warning-icon {
        width: 40px;
        height: 40px;
        min-width: 40px;
        color: #ff5050;
        --icon-color: #ff5050;
        flex-shrink: 0;
      }
      .delete-modal__title {
        font-size: 26px;
        font-weight: 700;
        color: black;
        margin: 0;
      }
      .delete-modal__workspace-card {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        background: #f4f4f4;
        border-radius: 13px;
        padding: 15px 15px 15px 15px;
        min-height: 82px;
      }
      .delete-modal__realm-icon-wrapper {
        position: relative;
        flex-shrink: 0;
        border-radius: calc(var(--boxel-border-radius-xs) + 6px);
        display: flex;
      }
      .delete-modal__realm-icon-wrapper::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: 0 0 0 1px rgba(255 255 255 / 50%);
        z-index: 1;
        pointer-events: none;
      }
      .delete-modal__realm-icon {
        --boxel-realm-icon-size: 40px;
        --boxel-realm-icon-border-radius: calc(var(--boxel-border-radius-xs) + 6px);
        --boxel-realm-icon-background-color: var(--boxel-light);
      }
      .delete-modal__workspace-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .delete-modal__workspace-name {
        font-size: 14px;
        font-weight: 700;
        color: black;
      }
      .delete-modal__workspace-meta {
        font-size: 14px;
        font-weight: 400;
        color: black;
      }
      .delete-modal__warning-box {
        background: #ffe9e9;
        border-radius: 13px;
        padding: 24px 24px 24px 24px;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .delete-modal__warning-text {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
        color: black;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .delete-modal__realms {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 4px;
      }
      .delete-modal__realms-title {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
        color: black;
      }
      .delete-modal__realms-list {
        margin: 0;
        padding-left: 21px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .delete-modal__realms-list li {
        font-size: 14px;
        font-weight: 500;
        color: black;
        list-style: disc;
      }
      .delete-modal__footer {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: var(--boxel-sp-xs);
      }
      .delete-modal__actions {
        display: flex;
        gap: var(--boxel-sp-sm);
        align-items: center;
      }
      .delete-modal__cancel {
        background: none;
        border: 1px solid #939393;
        border-radius: 20px;
        padding: 0 20px;
        height: 40px;
        font-size: 14px;
        font-weight: 700;
        color: black;
        cursor: pointer;
        transition: border-color 0.15s ease, background 0.15s ease;
      }
      .delete-modal__cancel:hover {
        border-color: #555;
        background: #f4f4f4;
      }
      .delete-modal__confirm {
        background: #ff5050;
        border: none;
        border-radius: 20px;
        padding: 0 24px;
        height: 40px;
        font-size: 14px;
        font-weight: 700;
        color: white;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .delete-modal__confirm:hover {
        background: #e03e3e;
      }
      .delete-modal__disclaimer {
        font-size: 12px;
        font-weight: 700;
        color: #ff5050;
      }
    </style>
  </template>
}
