import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import ArchiveIcon from '@cardstack/boxel-icons/archive';
import CircleAlert from '@cardstack/boxel-icons/circle-alert';
import FileSettingsIcon from '@cardstack/boxel-icons/file-settings';
import Home from '@cardstack/boxel-icons/home';
import { dropTask, task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import pluralize from 'pluralize';

import {
  BoxelDropdown,
  Button,
  ContextButton,
  LoadingIndicator,
  Menu,
  RealmIcon,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { MenuItem, cssVar, gt } from '@cardstack/boxel-ui/helpers';
import {
  Group,
  IconGlobe,
  IconTrash,
  Lock,
  Star,
  StarFilled,
} from '@cardstack/boxel-ui/icons';

import {
  hasExecutableExtension,
  RealmPaths,
  SupportedMimeType,
  type RealmIdentifier,
} from '@cardstack/runtime-common';

import ModalContainer from '@cardstack/host/components/modal-container';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import focusWhenSelected from './focus-when-selected';
import ItemContainer from './item-container';
import WorkspaceLoadingIndicator from './workspace-loading-indicator';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    realmIdentifier: RealmIdentifier;
    showMenu?: boolean;
    isSelected?: boolean;
    navIndex?: number;
  };
}

export default class Workspace extends Component<Signature> {
  <template>
    {{#if this.loadRealmTask.isRunning}}
      <WorkspaceLoadingIndicator />
    {{else}}
      <div
        class='workspace-card
          {{if this.isHostDropdownOpen "is-open"}}
          {{if @isSelected "is-selected"}}'
        data-test-workspace={{this.name}}
        data-test-workspace-selected={{if @isSelected this.name}}
        {{on 'mouseleave' this.closeHostDropdown}}
        ...attributes
      >
        <ItemContainer
          data-test-workspace-button={{this.name}}
          data-nav-index={{@navIndex}}
          {{on 'click' this.openWorkspace}}
          {{focusWhenSelected @isSelected}}
        >
          <div
            class='tile-icon'
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
        <ContextButton
          class='tile-favorite-btn {{if this.isFavorited "is-favorited"}}'
          @label={{if this.isFavorited 'Unfavorite' 'Favorite'}}
          @icon={{if this.isFavorited StarFilled Star}}
          @variant='ghost'
          @width='16'
          @height='16'
          {{on 'click' this.toggleFavorite}}
          data-test-workspace-favorite-btn={{@realmIdentifier}}
        />
        <div class='tile-menu-btn'>
          <BoxelDropdown>
            <:trigger as |bindings|>
              <ContextButton
                @label='Options'
                @variant='ghost'
                @width='16'
                @height='16'
                data-test-workspace-menu-trigger={{@realmIdentifier}}
                {{bindings}}
              />
            </:trigger>
            <:content as |dd|>
              <Menu @items={{this.tileMenuItems}} @closeMenu={{dd.close}} />
            </:content>
          </BoxelDropdown>
        </div>
        {{#if this.hasPublishedRealms}}
          <button
            class='host-trigger'
            type='button'
            data-test-host-trigger={{@realmIdentifier}}
            {{on 'click' this.toggleHostDropdown}}
          >
            <span class='trigger-house'><Home width='13' height='13' /></span>
            <span class='trigger-url'>{{this.displayPublishedURL}}</span>
            {{#if (gt this.publishedRealmURLs.length 1)}}
              <span class='trigger-chevron'>&#x25BE;</span>
            {{/if}}
          </button>

          {{#if this.isHostDropdownOpen}}
            <div
              class='host-dropdown'
              data-test-host-dropdown={{@realmIdentifier}}
            >
              <span class='dropdown-header'>Launch in new window</span>
              <ul class='dropdown-list'>
                {{#each this.publishedRealmURLs as |url|}}
                  <li>
                    <button
                      type='button'
                      class='dropdown-option'
                      data-test-host-dropdown-option={{url}}
                      {{on 'click' (fn this.openPublishedRealm url)}}
                    >
                      <span class='option-url'>{{url}}</span>
                    </button>
                  </li>
                {{/each}}
              </ul>
            </div>
          {{/if}}
        {{/if}}

        <div class='info {{if this.isHostDropdownOpen "info--hidden"}}'>
          <span class='name' data-test-workspace-name>{{this.name}}</span>
          <span class='visibility' data-test-workspace-visibility>
            {{#if this.hasPublishedRealms}}
              <Tooltip @placement='top'>
                <:trigger>
                  <span class='hosted-icon'>
                    <Home width='13' height='13' />
                  </span>
                </:trigger>
                <:content>Hosted on the web</:content>
              </Tooltip>
            {{/if}}
            <Tooltip @placement='top'>
              <:trigger>
                <this.visibilityIcon width='12' height='12' />
              </:trigger>
              <:content>
                {{this.visibilityLabel}}
              </:content>
            </Tooltip>
            <span class='visibility-label'>{{this.visibility}}</span>
          </span>
        </div>
      </div>
      {{#if this.showDeleteModal}}
        <ModalContainer
          @title=''
          @onClose={{this.closeDeleteModal}}
          @size='medium'
          @cardContainerClass='workspace-chooser-delete-modal'
          class='workspace-chooser-delete-modal-container'
          data-test-delete-modal={{@realmIdentifier}}
        >
          <:content>
            <div class='delete-modal__header'>
              <CircleAlert class='delete-modal__warning-icon' />
              <h2 class='delete-modal__title'>Delete Workspace</h2>
            </div>

            <div class='delete-modal__workspace-card'>
              <div class='delete-modal__realm-icon-wrapper'>
                <RealmIcon
                  class='delete-modal__realm-icon'
                  @realmInfo={{this.realmInfo}}
                />
              </div>
              <div class='delete-modal__workspace-info'>
                <span class='delete-modal__workspace-name'>{{this.name}}</span>
                {{#if this.loadDeleteSummaryTask.isRunning}}
                  <span class='delete-modal__workspace-meta'>
                    Checking what will be removed from this workspace…
                  </span>
                {{else if this.deleteSummaryText}}
                  <span class='delete-modal__workspace-meta'>
                    Contains
                    <strong>{{this.deleteSummaryText}}</strong>
                  </span>
                {{/if}}
              </div>
            </div>

            <div class='delete-modal__warning-box'>
              <p class='delete-modal__warning-text'>
                <strong>
                  This permanently deletes the workspace and any custom domains
                  tied to it.
                </strong>
                <strong>
                  Links to cards in this workspace may stop working elsewhere.
                </strong>
              </p>
              {{#if this.hasPublishedRealms}}
                <div class='delete-modal__realms'>
                  <p class='delete-modal__realms-title'>
                    Published
                    {{pluralize 'realm' this.publishedRealmURLs.length}}
                    that will also be removed
                  </p>
                  <ul class='delete-modal__realms-list'>
                    {{#each this.publishedRealmURLs as |publishedRealmURL|}}
                      <li>{{publishedRealmURL}}</li>
                    {{/each}}
                  </ul>
                </div>
              {{/if}}
            </div>

            {{#if this.deleteError}}
              <p class='delete-modal__error'>{{this.deleteError}}</p>
            {{/if}}
          </:content>
          <:footer>
            <div class='delete-modal__footer'>
              <div class='delete-modal__actions'>
                {{#if this.deleteWorkspaceTask.isRunning}}
                  <LoadingIndicator class='delete-modal__spinner' />
                {{else}}
                  <Button
                    {{on 'click' this.closeDeleteModal}}
                    class='delete-modal__cancel'
                    data-test-cancel-delete-button
                  >
                    Cancel
                  </Button>
                  <button
                    type='button'
                    class='delete-modal__confirm'
                    data-test-confirm-delete-button
                    {{on 'click' (perform this.deleteWorkspaceTask)}}
                  >
                    Delete this workspace
                  </button>
                {{/if}}
              </div>
              <span class='delete-modal__disclaimer'>
                This action is not reversible
              </span>
            </div>
          </:footer>
        </ModalContainer>
      {{/if}}
      {{#if this.showArchiveModal}}
        <ModalContainer
          @title=''
          @onClose={{this.closeArchiveModal}}
          @size='medium'
          @cardContainerClass='workspace-chooser-archive-modal'
          class='workspace-chooser-archive-modal-container'
          data-test-archive-modal={{@realmIdentifier}}
        >
          <:content>
            <div class='archive-modal__header'>
              <ArchiveIcon class='archive-modal__icon' />
              <h2 class='archive-modal__title'>Archive Workspace</h2>
            </div>

            <div class='archive-modal__workspace-card'>
              <div class='archive-modal__realm-icon-wrapper'>
                <RealmIcon
                  class='archive-modal__realm-icon'
                  @realmInfo={{this.realmInfo}}
                />
              </div>
              <div class='archive-modal__workspace-info'>
                <span class='archive-modal__workspace-name'>{{this.name}}</span>
              </div>
            </div>

            <div class='archive-modal__info-box'>
              <p class='archive-modal__info-text'>
                Archiving hides this workspace from your realm list and stops
                its indexer. While archived, it
                <strong>
                  will not be available for viewing or editing — to you or any
                  other user
                </strong>
                — until you restore it.
              </p>
              <p class='archive-modal__info-text'>
                You can restore it at any time from the Archived section of the
                workspace chooser.
              </p>
            </div>

            {{#if this.archiveError}}
              <p class='archive-modal__error'>{{this.archiveError}}</p>
            {{/if}}
          </:content>
          <:footer>
            <div class='archive-modal__footer'>
              <div class='archive-modal__actions'>
                {{#if this.archiveWorkspaceTask.isRunning}}
                  <LoadingIndicator class='archive-modal__spinner' />
                {{else}}
                  <Button
                    {{on 'click' this.closeArchiveModal}}
                    class='archive-modal__cancel'
                    data-test-cancel-archive-button
                  >
                    Cancel
                  </Button>
                  <button
                    type='button'
                    class='archive-modal__confirm'
                    data-test-confirm-archive-button
                    {{on 'click' (perform this.archiveWorkspaceTask)}}
                  >
                    Archive this workspace
                  </button>
                {{/if}}
              </div>
              <span class='archive-modal__disclaimer'>
                You can restore this workspace later
              </span>
            </div>
          </:footer>
        </ModalContainer>
      {{/if}}
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
        width: var(--boxel-xxs-container);
        height: 10.375rem;
        box-sizing: border-box;
        border-radius: var(--boxel-border-radius-xl);
        border: 1px solid rgba(255 255 255 / 25%);
        pointer-events: none;
        z-index: 20;
      }
      .workspace-card:hover::after {
        border-color: rgba(255 255 255 / 50%);
      }
      .workspace-card.is-selected::after {
        border-color: var(--boxel-teal);
        box-shadow: 0 0 0 1px var(--boxel-teal);
      }
      .tile-favorite-btn {
        position: absolute;
        top: 0.5rem;
        left: 0.5rem;
        z-index: 3;
        color: var(--boxel-light);
        --icon-color: var(--boxel-light);
        opacity: 0;
        transition: opacity 0.15s ease;
      }
      .workspace-card:hover .tile-favorite-btn {
        opacity: 1;
      }
      .tile-favorite-btn:hover {
        background: rgba(0 0 0 / 40%);
        backdrop-filter: blur(6px);
        border-radius: var(--boxel-border-radius-sm);
      }
      .tile-favorite-btn.is-favorited {
        color: var(--boxel-teal);
        --icon-color: var(--boxel-teal);
        opacity: 1;
      }
      .tile-menu-btn {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        z-index: 3;
        color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-sm);
        width: var(--boxel-button-xs);
        height: var(--boxel-button-xs);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        --boxel-icon-button-width: var(--boxel-button-xs);
        --boxel-icon-button-height: var(--boxel-button-xs);
      }
      .tile-menu-btn:hover {
        background: rgba(0 0 0 / 40%);
        backdrop-filter: blur(6px);
      }
      .tile-menu-btn:focus-within {
        background: var(--boxel-highlight);
        color: var(--boxel-highlight-foreground);
      }
      .tile-icon {
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
        border-radius: calc(
          var(--boxel-border-radius-xs) + var(--boxel-border-radius-sm)
        );
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
        --boxel-realm-icon-size: 2.625rem;
        --boxel-realm-icon-border-radius: calc(
          var(--boxel-border-radius-xs) + 6px
        );
        --boxel-realm-icon-background-color: var(--boxel-light);
      }
      .info {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: var(--boxel-sp-xs);
        gap: var(--boxel-sp-5xs);
        max-width: var(--boxel-xxs-container);
      }
      .info > span {
        text-overflow: ellipsis;
        overflow: hidden;
        width: 100%;
        text-wrap: nowrap;
        text-align: center;
        letter-spacing: var(--boxel-lsp);
      }
      .info > .name {
        color: var(--boxel-light);
        font: 400 var(--boxel-font-sm);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        text-wrap: wrap;
        overflow-wrap: anywhere;
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
      .visibility :deep([data-tooltip-trigger]) {
        display: inline-flex;
        align-items: center;
      }
      .visibility-label {
        margin-left: var(--boxel-sp-6xs);
      }
      .hosted-icon {
        color: var(--boxel-teal);
        display: flex;
        align-items: center;
        margin-right: var(--boxel-sp-6xs);
      }
      .realm-url {
        font-size: var(--boxel-font-xs);
        color: var(--boxel-500);
        max-width: 8.75rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .info--hidden {
        visibility: hidden;
      }
      .host-trigger {
        position: absolute;
        top: calc(10.375rem - 2.25rem);
        left: 0;
        width: var(--boxel-xxs-container);
        height: 2.25rem;
        background: rgba(0 0 0 / 40%);
        backdrop-filter: blur(6px);
        border: none;
        border-radius: 0 0 var(--boxel-border-radius-xl)
          var(--boxel-border-radius-xl);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        padding: 0 var(--boxel-sp-xs) 0 var(--boxel-sp-sm);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.5s ease;
        z-index: 7;
        overflow: hidden;
      }
      .workspace-card:hover .host-trigger,
      .workspace-card.is-open .host-trigger {
        opacity: 1;
        transition: none;
      }
      .trigger-house {
        color: var(--boxel-teal);
        display: flex;
        align-items: center;
        flex-shrink: 0;
      }
      .trigger-url {
        font-size: var(--boxel-font-size-2xs);
        color: var(--boxel-light);
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        text-align: left;
      }
      .trigger-chevron {
        font-size: var(--boxel-font-size-xs);
        color: var(--boxel-light);
        flex-shrink: 0;
      }
      .host-dropdown {
        position: absolute;
        top: 10.375rem;
        left: 0;
        width: var(--boxel-xxs-container);
        background: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        box-shadow: 0 4px 16px rgba(0 0 0 / 25%);
        z-index: 10;
        padding: var(--boxel-sp-xs) 0 var(--boxel-sp-2xs);
        display: flex;
        flex-direction: column;
      }
      .dropdown-header {
        font-size: var(--boxel-font-size-2xs);
        font-weight: 600;
        color: var(--boxel-550);
        padding: 0 var(--boxel-sp-sm) 0.5rem;
        border-bottom: 1px solid rgba(0 0 0 / 8%);
        display: block;
      }
      .dropdown-list {
        list-style: none;
        margin: 0;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-2xs);
      }
      .dropdown-list li {
        margin: 0;
        padding: 0;
      }
      .dropdown-option {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: var(--boxel-sp-2xs) 0.5rem;
        background: none;
        border: none;
        border-radius: var(--boxel-border-radius-sm);
        cursor: pointer;
        text-align: left;
      }
      .dropdown-option:hover {
        background: rgba(0 0 0 / 6%);
      }
      .option-url {
        font-size: var(--boxel-font-size-xs);
        color: var(--boxel-dark);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .workspace-menu {
        position: absolute;
        top: var(--boxel-sp-xs);
        right: var(--boxel-sp-xs);
        z-index: 1;
      }
      .workspace-menu__trigger {
        --boxel-icon-button-width: 2.65rem;
        --boxel-icon-button-height: 1.85rem;
        --boxel-icon-button-padding: 0 0.38rem;
        color: var(--boxel-light-100);
        background: rgb(24 25 32 / 86%);
        border: 1px solid rgb(255 255 255 / 62%);
        border-radius: 6px;
        box-shadow: 0 6px 14px rgb(0 0 0 / 22%);
        backdrop-filter: blur(10px);
      }
      .workspace-menu__trigger :deep(svg) {
        width: 1.7rem;
        height: 1.7rem;
      }
      .workspace-menu__trigger:hover,
      .workspace-menu__trigger[aria-expanded='true'] {
        color: var(--boxel-dark);
        background: var(--boxel-highlight);
        border-color: rgb(255 255 255 / 78%);
      }
      :global(.workspace-menu__content) {
        min-width: 11rem;
      }
      .workspace-menu__list {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
      .workspace-chooser-delete-modal-container > :deep(.boxel-modal__inner) {
        display: flex;
      }
      :deep(.workspace-chooser-delete-modal) {
        border-radius: var(--boxel-border-radius-xxl);
        max-width: var(--boxel-md-container);
        height: auto;
        display: flex;
        flex-direction: column;
      }
      :deep(.workspace-chooser-delete-modal > .dialog-box__header) {
        display: none;
      }
      :deep(.workspace-chooser-delete-modal > .dialog-box__content) {
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl);
        overflow: visible;
        height: auto;
        flex: none;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }
      :deep(.workspace-chooser-delete-modal > .dialog-box__content > * + *) {
        margin-top: 0;
      }
      :deep(.workspace-chooser-delete-modal > .dialog-box__footer) {
        height: auto;
        flex: none;
        padding: 0 var(--boxel-sp-xl) var(--boxel-sp-xl);
        border-top: none;
      }
      .delete-modal__header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .delete-modal__warning-icon {
        width: var(--boxel-icon-lg);
        height: var(--boxel-icon-lg);
        min-width: var(--boxel-icon-lg);
        color: var(--boxel-danger);
        flex-shrink: 0;
      }
      .delete-modal__title {
        font-size: 1.625rem;
        font-weight: 700;
        color: var(--boxel-dark);
        margin: 0;
      }
      .delete-modal__workspace-card {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        background: var(--boxel-light-100);
        border-radius: var(--boxel-border-radius-lg);
        padding: var(--boxel-sp);
        min-height: 5.125rem;
      }
      .delete-modal__realm-icon-wrapper {
        position: relative;
        flex-shrink: 0;
        border-radius: calc(
          var(--boxel-border-radius-xs) + var(--boxel-border-radius-sm)
        );
        display: flex;
      }
      .delete-modal__realm-icon-wrapper::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: inset 0 0 0 1px rgba(255 255 255 / 50%);
        z-index: 1;
        pointer-events: none;
      }
      .delete-modal__realm-icon {
        --boxel-realm-icon-size: 2.625rem;
        --boxel-realm-icon-border-radius: calc(
          var(--boxel-border-radius-xs) + 6px
        );
        --boxel-realm-icon-background-color: var(--boxel-light);
      }
      .delete-modal__workspace-info {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }
      .delete-modal__workspace-name {
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        color: var(--boxel-dark);
      }
      .delete-modal__workspace-meta {
        font-size: var(--boxel-font-size-sm);
        font-weight: 400;
        color: var(--boxel-dark);
      }
      .delete-modal__warning-box {
        background: var(--boxel-danger-bg);
        border-radius: var(--boxel-border-radius-lg);
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .delete-modal__warning-text {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        color: var(--boxel-dark);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-2xs);
      }
      .delete-modal__realms {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: var(--boxel-sp-4xs);
      }
      .delete-modal__realms-title {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        color: var(--boxel-dark);
      }
      .delete-modal__realms-list {
        margin: 0;
        padding-left: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .delete-modal__realms-list li {
        font-size: var(--boxel-font-size-sm);
        font-weight: 500;
        color: var(--boxel-dark);
        list-style: disc;
      }
      .delete-modal__error {
        color: var(--boxel-danger);
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        margin: 0;
      }
      .delete-modal__footer {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: var(--boxel-sp-xs);
        width: 100%;
      }
      .delete-modal__actions {
        display: flex;
        gap: var(--boxel-sp-sm);
        align-items: center;
      }
      .delete-modal__cancel {
        background: none;
        border: 1px solid var(--boxel-450);
        border-radius: var(--boxel-border-radius-xxl);
        padding: 0 var(--boxel-sp-lg);
        height: var(--boxel-button-tall);
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        color: var(--boxel-dark);
        cursor: pointer;
        transition:
          border-color 0.15s ease,
          background 0.15s ease;
      }
      .delete-modal__cancel:hover {
        border-color: var(--boxel-550);
        background: var(--boxel-light-100);
      }
      .delete-modal__confirm {
        background: var(--boxel-danger);
        border: none;
        border-radius: var(--boxel-border-radius-xxl);
        padding: 0 1.5rem;
        height: var(--boxel-button-tall);
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        color: var(--boxel-light);
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .delete-modal__confirm:hover {
        background: var(--boxel-danger-hover);
      }
      .delete-modal__disclaimer {
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        color: var(--boxel-danger);
      }
      .delete-modal__spinner {
        --boxel-loading-indicator-size: 2rem;
      }
      .workspace-chooser-archive-modal-container > :deep(.boxel-modal__inner) {
        display: flex;
      }
      :deep(.workspace-chooser-archive-modal) {
        border-radius: var(--boxel-border-radius-xxl);
        max-width: var(--boxel-md-container);
        height: auto;
        display: flex;
        flex-direction: column;
      }
      :deep(.workspace-chooser-archive-modal > .dialog-box__header) {
        display: none;
      }
      :deep(.workspace-chooser-archive-modal > .dialog-box__content) {
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl);
        overflow: visible;
        height: auto;
        flex: none;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }
      :deep(.workspace-chooser-archive-modal > .dialog-box__content > * + *) {
        margin-top: 0;
      }
      :deep(.workspace-chooser-archive-modal > .dialog-box__footer) {
        height: auto;
        flex: none;
        padding: 0 var(--boxel-sp-xl) var(--boxel-sp-xl);
        border-top: none;
      }
      .archive-modal__header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .archive-modal__icon {
        width: var(--boxel-icon-lg);
        height: var(--boxel-icon-lg);
        min-width: var(--boxel-icon-lg);
        color: var(--boxel-dark);
        flex-shrink: 0;
      }
      .archive-modal__title {
        font-size: 1.625rem;
        font-weight: 700;
        color: var(--boxel-dark);
        margin: 0;
      }
      .archive-modal__workspace-card {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        background: var(--boxel-light-100);
        border-radius: var(--boxel-border-radius-lg);
        padding: var(--boxel-sp);
        min-height: 5.125rem;
      }
      .archive-modal__realm-icon-wrapper {
        position: relative;
        flex-shrink: 0;
        border-radius: calc(
          var(--boxel-border-radius-xs) + var(--boxel-border-radius-sm)
        );
        display: flex;
      }
      .archive-modal__realm-icon-wrapper::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: inset 0 0 0 1px rgba(255 255 255 / 50%);
        z-index: 1;
        pointer-events: none;
      }
      .archive-modal__realm-icon {
        --boxel-realm-icon-size: 2.625rem;
        --boxel-realm-icon-border-radius: calc(
          var(--boxel-border-radius-xs) + 6px
        );
        --boxel-realm-icon-background-color: var(--boxel-light);
      }
      .archive-modal__workspace-info {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }
      .archive-modal__workspace-name {
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        color: var(--boxel-dark);
      }
      .archive-modal__info-box {
        background: var(--boxel-light-100);
        border-radius: var(--boxel-border-radius-lg);
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .archive-modal__info-text {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        font-weight: 400;
        color: var(--boxel-dark);
      }
      .archive-modal__error {
        color: var(--boxel-danger);
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        margin: 0;
      }
      .archive-modal__footer {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: var(--boxel-sp-xs);
        width: 100%;
      }
      .archive-modal__actions {
        display: flex;
        gap: var(--boxel-sp-sm);
        align-items: center;
      }
      .archive-modal__cancel {
        background: none;
        border: 1px solid var(--boxel-450);
        border-radius: var(--boxel-border-radius-xxl);
        padding: 0 var(--boxel-sp-lg);
        height: var(--boxel-button-tall);
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        color: var(--boxel-dark);
        cursor: pointer;
        transition:
          border-color 0.15s ease,
          background 0.15s ease;
      }
      .archive-modal__cancel:hover {
        border-color: var(--boxel-550);
        background: var(--boxel-light-100);
      }
      .archive-modal__confirm {
        background: var(--boxel-dark);
        border: none;
        border-radius: var(--boxel-border-radius-xxl);
        padding: 0 1.5rem;
        height: var(--boxel-button-tall);
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        color: var(--boxel-light);
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .archive-modal__confirm:hover {
        background: var(--boxel-700);
      }
      .archive-modal__disclaimer {
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        color: var(--boxel-500);
      }
      .archive-modal__spinner {
        --boxel-loading-indicator-size: 2rem;
      }
    </style>
  </template>

  get isFavorited() {
    return this.matrixService.workspaceFavorites.includes(
      this.args.realmIdentifier,
    );
  }

  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private recentFilesService: RecentFilesService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @tracked private showDeleteModal = false;
  @tracked private deleteError: string | undefined;
  @tracked private deleteSummary: WorkspaceDeleteSummary | undefined;
  @tracked private showArchiveModal = false;
  @tracked private archiveError: string | undefined;
  @tracked private isHostDropdownOpen = false;

  constructor(...args: [any, any]) {
    super(...args);
    this.loadRealmTask.perform();
  }

  private loadRealmTask = task(async () => {
    await this.realm.login(this.args.realmIdentifier);
    await this.realm.ensureRealmMeta(this.args.realmIdentifier);
  });

  @cached
  private get realmInfo() {
    return this.realm.info(this.args.realmIdentifier);
  }

  private get name() {
    return this.realmInfo.name;
  }

  get tileMenuItems() {
    let items = [
      new MenuItem({
        label: this.isFavorited ? 'Unfavorite' : 'Favorite',
        icon: this.isFavorited ? StarFilled : Star,
        action: this.toggleFavorite,
      }),
      new MenuItem({
        label: 'Realm Settings',
        icon: FileSettingsIcon,
        action: this.openRealmConfig,
      }),
    ];
    // Archive is owner-only and appears only on tiles the user owns.
    if (this.canArchiveWorkspace) {
      items.push(
        new MenuItem({
          label: 'Archive Workspace',
          icon: ArchiveIcon,
          action: this.openArchiveModal,
        }),
      );
    }
    items.push(
      new MenuItem({
        label: 'Delete Workspace',
        icon: IconTrash,
        action: this.openDeleteModal,
        dangerous: true,
        disabled: !this.canDeleteWorkspace,
      }),
    );
    return items;
  }

  @action openRealmConfig() {
    let realmURL = this.args.realmIdentifier.endsWith('/')
      ? this.args.realmIdentifier
      : `${this.args.realmIdentifier}/`;
    this.operatorModeStateService.openCardInInteractMode(
      `${realmURL}realm`,
      'edit',
    );
    this.operatorModeStateService.closeWorkspaceChooser();
  }

  @action async toggleFavorite() {
    if (this.isFavorited) {
      await this.matrixService.removeWorkspaceFavorite(
        this.args.realmIdentifier,
      );
    } else {
      await this.matrixService.addWorkspaceFavorite(this.args.realmIdentifier);
    }
  }

  private get primaryPublishedURL() {
    return this.publishedRealmURLs[0] ?? '';
  }

  private get displayPublishedURL() {
    try {
      let url = new URL(this.primaryPublishedURL);
      return url.host + url.pathname.replace(/\/$/, '');
    } catch {
      return this.primaryPublishedURL;
    }
  }

  @action toggleHostDropdown(event: Event) {
    event.stopPropagation();
    if (!this.hasPublishedRealms) return;
    this.isHostDropdownOpen = !this.isHostDropdownOpen;
  }

  @action openPublishedRealm(url: string, event: MouseEvent) {
    event.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
    this.isHostDropdownOpen = false;
  }

  @action closeHostDropdown() {
    this.isHostDropdownOpen = false;
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

  private get visibilityLabel() {
    switch (this.visibility) {
      case 'public':
        return 'Public workspace';
      case 'shared':
        return 'Shared workspace';
      case 'private':
        return 'Private workspace';
      default:
        return '';
    }
  }

  private get canDeleteWorkspace() {
    return this.realm.isRealmOwner(this.args.realmIdentifier);
  }

  private get canArchiveWorkspace() {
    return this.realm.isRealmOwner(this.args.realmIdentifier);
  }

  private get deleteSummaryText() {
    if (!this.deleteSummary) {
      return null;
    }
    let { cards, definitions, files } = this.deleteSummary;
    return formatWorkspaceDeleteSummary([
      { label: 'card', count: cards },
      { label: 'definition', count: definitions },
      { label: 'file', count: files },
    ]);
  }

  private get publishedRealmURLs() {
    let { lastPublishedAt } = this.realmInfo;
    if (!lastPublishedAt || typeof lastPublishedAt !== 'object') {
      return [];
    }

    return Object.entries(lastPublishedAt)
      .sort(([, leftPublishedAt], [, rightPublishedAt]) => {
        return Number(rightPublishedAt) - Number(leftPublishedAt);
      })
      .map(([publishedRealmURL]) => publishedRealmURL);
  }

  private get hasPublishedRealms() {
    return this.publishedRealmURLs.length > 0;
  }

  @action async openWorkspace() {
    await this.operatorModeStateService.openWorkspace(
      this.args.realmIdentifier,
    );
  }

  @action openDeleteModal() {
    if (!this.canDeleteWorkspace) {
      return;
    }
    this.deleteSummary = undefined;
    this.deleteError = undefined;
    this.showDeleteModal = true;
    this.loadDeleteSummaryTask.perform();
  }

  @action closeDeleteModal() {
    if (this.deleteWorkspaceTask.isRunning) {
      return;
    }
    this.showDeleteModal = false;
    this.deleteError = undefined;
  }

  @action openArchiveModal() {
    if (!this.canArchiveWorkspace) {
      return;
    }
    this.archiveError = undefined;
    this.showArchiveModal = true;
  }

  @action closeArchiveModal() {
    if (this.archiveWorkspaceTask.isRunning) {
      return;
    }
    this.showArchiveModal = false;
    this.archiveError = undefined;
  }

  private archiveWorkspaceTask = dropTask(async () => {
    this.archiveError = undefined;

    try {
      let realmPath = new RealmPaths(this.args.realmIdentifier);
      let isActiveWorkspace =
        this.operatorModeStateService.realmURL === this.args.realmIdentifier ||
        this.operatorModeStateService
          .getOpenCardIds()
          .some((cardId) => realmPath.inRealm(cardId)) ||
        this.operatorModeStateService.codePathString?.startsWith(
          this.args.realmIdentifier,
        );

      await this.realmServer.archiveRealm(this.args.realmIdentifier);
      // Archiving seals the realm; drop its local session so background
      // requests don't loop on 403. Restoring re-creates the session.
      this.realm.removeRealm(this.args.realmIdentifier);

      if (isActiveWorkspace) {
        this.operatorModeStateService.clearStacks();
        await this.operatorModeStateService.updateCodePath(null);
        this.operatorModeStateService.openWorkspaceChooser();
      }

      this.showArchiveModal = false;
    } catch (error: any) {
      this.archiveError = error.message;
    }
  });

  private loadDeleteSummaryTask = dropTask(async () => {
    try {
      let response = await this.network.authedFetch(
        `${this.args.realmIdentifier}_mtimes`,
        {
          headers: {
            Accept: SupportedMimeType.Mtimes,
          },
        },
      );
      if (!response.ok) {
        throw new Error(
          `Failed to fetch workspace contents: ${response.status}`,
        );
      }
      let json = (await response.json()) as {
        data: {
          attributes: {
            mtimes: Record<string, number>;
          };
        };
      };
      this.deleteSummary = summarizeWorkspaceContents(
        Object.keys(json.data.attributes.mtimes),
      );
    } catch (error) {
      console.error(error);
      this.deleteSummary = undefined;
    }
  });

  private deleteWorkspaceTask = dropTask(async () => {
    this.deleteError = undefined;

    try {
      let realmPath = new RealmPaths(this.args.realmIdentifier);
      let isActiveWorkspace =
        this.operatorModeStateService.realmURL === this.args.realmIdentifier ||
        this.operatorModeStateService
          .getOpenCardIds()
          .some((cardId) => realmPath.inRealm(cardId)) ||
        this.operatorModeStateService.codePathString?.startsWith(
          this.args.realmIdentifier,
        );

      await this.realmServer.deleteRealm(this.args.realmIdentifier);
      await this.matrixService.removeRealmFromAccountData(
        this.args.realmIdentifier,
      );
      this.recentFilesService.removeRecentFilesForRealmURL(
        this.args.realmIdentifier,
      );
      for (let publishedRealmURL of this.publishedRealmURLs) {
        this.recentFilesService.removeRecentFilesForRealmURL(publishedRealmURL);
      }
      this.realm.removeRealm(this.args.realmIdentifier);

      if (isActiveWorkspace) {
        this.operatorModeStateService.clearStacks();
        await this.operatorModeStateService.updateCodePath(null);
        this.operatorModeStateService.openWorkspaceChooser();
      }

      this.showDeleteModal = false;
    } catch (error: any) {
      this.deleteError = error.message;
    }
  });
}

interface WorkspaceDeleteSummary {
  cards: number;
  definitions: number;
  files: number;
}

function summarizeWorkspaceContents(
  fileURLs: string[],
): WorkspaceDeleteSummary {
  return fileURLs.reduce(
    (summary, fileURL) => {
      let path = new URL(fileURL).pathname;
      if (path.endsWith('/realm.json')) {
        return summary;
      }
      if (path.endsWith('.json')) {
        summary.cards++;
      } else if (hasExecutableExtension(path)) {
        summary.definitions++;
      } else {
        summary.files++;
      }
      return summary;
    },
    {
      cards: 0,
      definitions: 0,
      files: 0,
    } as WorkspaceDeleteSummary,
  );
}

export function formatWorkspaceDeleteSummary(
  counts: { label: string; count: number }[],
): string {
  let nonZeroCounts = counts
    .filter(({ count }) => count > 0)
    .map(({ label, count }) => `${count} ${pluralize(label, count)}`);

  if (nonZeroCounts.length === 0) {
    return 'no cards, definitions, or files';
  }

  return joinWithAnd(nonZeroCounts);
}

export function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? '';
  }

  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }

  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}
