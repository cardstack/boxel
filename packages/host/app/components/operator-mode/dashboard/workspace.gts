import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import ArchiveIcon from '@cardstack/boxel-icons/archive';
import CopyIcon from '@cardstack/boxel-icons/copy';
import FileSettingsIcon from '@cardstack/boxel-icons/file-settings';
import Globe from '@cardstack/boxel-icons/globe';
import RefreshIcon from '@cardstack/boxel-icons/refresh-cw';
import { didCancel, dropTask, task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';
import { modifier } from 'ember-modifier';
import pluralize from 'pluralize';

import {
  BoxelDropdown,
  ContextButton,
  LoadingIndicator,
  Menu,
  RealmIcon,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { MenuItem, cssVar, eq, gt, or } from '@cardstack/boxel-ui/helpers';
import {
  Group,
  IconGlobe,
  IconTrash,
  IconX,
  Lock,
  Star,
  StarFilled,
} from '@cardstack/boxel-ui/icons';

import {
  ensureTrailingSlash,
  logger,
  RealmPaths,
  SupportedMimeType,
  type RealmIdentifier,
} from '@cardstack/runtime-common';

import RealmURLTooltip from '@cardstack/host/components/realm-url-tooltip';
import { realmURLDisplayText } from '@cardstack/host/lib/realm-utils';
import {
  publishedRealmURLsFromInfo,
  skillsRealmURL,
} from '@cardstack/host/lib/utils';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';
import type WorkspaceDuplicationService from '@cardstack/host/services/workspace-duplication';

import {
  WORKSPACE_TILE_TARGET,
  formatRelativeTime,
  formatUpdatedTime,
  formatWorkspaceDeleteSummary,
  summarizeWorkspaceContents,
} from '../workspace-chooser/workspace';
import {
  ArchiveWorkspaceModal,
  DeleteWorkspaceModal,
  DuplicateWorkspaceModal,
} from '../workspace-chooser/workspace-modals';

import focusWhenSelected from './focus-when-selected';
import ItemContainer from './item-container';

// A favorite is a desk: its wallpaper as a surface, with room for the
// workspace's pinned cards. A recent workspace is a tile with its wallpaper
// and, when hosted, its site's address as a chin. The rest are rows, where
// names are what you scan.
export type WorkspaceVariant = 'desk' | 'tile' | 'row';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    realmIdentifier: RealmIdentifier;
    variant: WorkspaceVariant;
    isSelected?: boolean;
    // Whether the keyboard cursor is showing. The selected workspace holds
    // focus from the start, so Enter works at once, but its ring waits for
    // the keyboard.
    selectionActive?: boolean;
    navIndex?: number;
  };
}

const log = logger('component:dashboard/workspace');

// A row's trailing time drops the "Updated" its position already says.
const UPDATED_PREFIX = /^Updated /;

export default class Workspace extends Component<Signature> {
  <template>
    {{#if this.loadRealmTask.isRunning}}
      <div
        class='workspace is-{{@variant}} is-loading'
        data-test-workspace-loading-indicator
      >
        <LoadingIndicator @color='var(--boxel-light)' />
      </div>
    {{else}}
      <div
        class='workspace is-{{@variant}}
          {{if this.isHostDropdownOpen "is-open"}}
          {{if this.showSelectionRing "is-selected"}}'
        style={{cssVar workspace-background-image-url=this.backgroundImageURL}}
        data-theme='dark'
        {{on 'mouseleave' this.closeHostDropdown}}
        {{this.captureTile}}
        data-workspace-tile
        data-test-workspace={{this.name}}
        data-test-workspace-variant={{@variant}}
        data-test-workspace-selected={{if @isSelected this.name}}
        data-test-workspace-ring={{if this.showSelectionRing this.name}}
        ...attributes
      >
        {{#if this.reindexError}}
          <div class='reindex-error' role='alert' data-test-reindex-error>
            <span
              class='reindex-error-message'
              title={{this.reindexError}}
            >{{this.reindexError}}</span>
            <button
              type='button'
              class='reindex-error-dismiss'
              aria-label='Dismiss error'
              {{on 'click' this.clearReindexError}}
              data-test-reindex-error-dismiss
            >
              <IconX width='11' height='11' />
            </button>
          </div>
        {{/if}}
        {{! The URL describes the workspace rather than naming it, so it sits
            outside the button: text inside a button joins its accessible
            name. }}
        <span
          id={{this.realmURLDescriptionId}}
          class='boxel-sr-only'
        >{{this.realmURLText}}</span>

        {{#if (eq @variant 'desk')}}
          {{! A desk is a surface, not one button: the name pill, the star
              and the menu are separate controls, and the bare wallpaper
              opens the workspace for a pointer. The pill carries the
              keyboard cursor. }}
          <div class='desk-surface'>
            <div
              {{! template-lint-disable no-invalid-interactive }}
              class='desk-hit'
              aria-hidden='true'
              {{on 'click' this.openWorkspace}}
            ></div>
            <div class='desk-top'>
              <RealmURLTooltip
                class='desk-pill-tooltip'
                @realmURL={{@realmIdentifier}}
                @label={{this.name}}
              >
                <button
                  type='button'
                  class='desk-pill'
                  aria-describedby={{this.realmURLDescriptionId}}
                  data-nav-index={{@navIndex}}
                  {{on 'click' this.openWorkspace}}
                  {{focusWhenSelected @isSelected}}
                  data-test-workspace-button={{this.name}}
                >
                  <RealmIcon
                    class='desk-pill-icon'
                    @realmInfo={{this.realmInfo}}
                  />
                  <span
                    class='desk-pill-name'
                    data-test-workspace-name
                  >{{this.name}}</span>
                </button>
              </RealmURLTooltip>
              {{#if this.hasPublishedRealms}}
                <span class='desk-live' data-test-workspace-hosted>Hosted</span>
              {{/if}}
            </div>
            {{! The workspace's pinned cards go here (CS-14169). }}
            <div class='desk-pins'></div>
          </div>
          <div class='desk-caption'>
            {{! Always rendered, so the counts, which load after the desk,
                fill reserved space instead of growing the caption. }}
            <div class='desk-caption-line'>
              <span
                class='visibility-chip is-{{this.visibility}}'
                title={{this.visibilityLabel}}
                data-test-workspace-visibility
              >
                <this.visibilityIcon
                  width='12'
                  height='12'
                  aria-hidden='true'
                />
                {{this.visibility}}
              </span>
              <span
                class='desk-stats'
                data-test-workspace-stats={{@realmIdentifier}}
              >
                {{#each this.tileStats as |stat|}}
                  <span
                    class='desk-stat'
                    data-test-workspace-stat={{stat.label}}
                  >
                    <span>{{stat.label}}</span>
                    <span class='desk-stat-number'>{{stat.count}}</span>
                  </span>
                {{/each}}
              </span>
            </div>
            {{#if this.hasPublishedRealms}}
              <div class='desk-host-line'>
                <span class='desk-host-dot' aria-hidden='true'></span>
                <span>Hosted at</span>
                <button
                  type='button'
                  class='desk-host-link'
                  {{on
                    'click'
                    (fn this.openPublishedRealm this.primaryPublishedURL)
                  }}
                  data-test-desk-host-link={{@realmIdentifier}}
                >{{this.displayPublishedURL}}
                  <span aria-hidden='true'>↗</span></button>
                {{#if (gt this.publishedRealmURLs.length 1)}}
                  <span
                    class='desk-host-more'
                    title={{this.extraPublishedTitle}}
                  >+{{this.extraPublishedCount}}</span>
                {{/if}}
              </div>
            {{/if}}
          </div>
        {{else if (eq @variant 'row')}}
          {{! The row's wallpaper is decoration; its name, below, is the
              button. }}
          <span class='wallpaper row-thumb' aria-hidden='true'>
            <span class='realm-icon-wrapper'>
              <RealmIcon
                class='workspace-realm-icon'
                @realmInfo={{this.realmInfo}}
              />
            </span>
          </span>
        {{else}}
          <ItemContainer
            class='tile-face'
            aria-describedby={{this.realmURLDescriptionId}}
            data-nav-index={{@navIndex}}
            {{on 'click' this.openWorkspace}}
            {{focusWhenSelected @isSelected}}
            data-test-workspace-button={{this.name}}
          >
            <span class='wallpaper'>
              <span class='realm-icon-wrapper'>
                <RealmIcon
                  class='workspace-realm-icon'
                  @realmInfo={{this.realmInfo}}
                  @canAnimate={{true}}
                />
              </span>
            </span>
          </ItemContainer>
        {{/if}}

        <div class='favorite-btn {{if this.isFavorited "is-favorited"}}'>
          <Tooltip @placement='top'>
            <:trigger>
              <ContextButton
                @label={{this.favoriteLabel}}
                @icon={{if this.isFavorited StarFilled Star}}
                @variant='ghost'
                @width='16'
                @height='16'
                {{on 'click' this.toggleFavorite}}
                data-test-workspace-favorite-btn={{@realmIdentifier}}
              />
            </:trigger>
            <:content>{{this.favoriteLabel}}</:content>
          </Tooltip>
        </div>
        <div class='menu-btn'>
          <BoxelDropdown @contentClass='workspace-menu-dropdown'>
            <:trigger as |bindings|>
              <ContextButton
                @label='Options'
                @variant='ghost'
                @width='16'
                @height='16'
                {{bindings}}
                {{this.captureMenuTrigger}}
                data-test-workspace-menu-trigger={{@realmIdentifier}}
              />
            </:trigger>
            <:content as |dd|>
              <Menu @items={{this.menuItems}} @closeMenu={{dd.close}} />
              {{#if (or this.updatedAtLabel this.createdAtLabel)}}
                <div
                  class='menu-footer'
                  data-test-workspace-menu-footer={{@realmIdentifier}}
                >
                  {{#if this.updatedAtLabel}}
                    <span
                      class='menu-footer-value'
                    >{{this.updatedAtLabel}}</span>
                  {{/if}}
                  {{#if this.createdAtLabel}}
                    <span class='menu-footer-row'>
                      <span class='menu-footer-label'>Created</span>
                      <span
                        class='menu-footer-value'
                      >{{this.createdAtLabel}}</span>
                    </span>
                  {{/if}}
                </div>
              {{/if}}
            </:content>
          </BoxelDropdown>
        </div>

        {{#unless (eq @variant 'desk')}}
          {{#if this.hasPublishedRealms}}
            {{! A tile wears its site's address as a chin; a row folds it
                to a globe beside the menu. }}
            <button
              type='button'
              class='host-trigger'
              aria-label={{this.hostTriggerLabel}}
              aria-expanded={{if this.isHostDropdownOpen 'true' 'false'}}
              {{on 'click' this.toggleHostDropdown}}
              data-test-host-trigger={{@realmIdentifier}}
            >
              <Globe
                class='host-trigger-globe'
                width='13'
                height='13'
                aria-hidden='true'
              />
              <span class='host-trigger-url'>{{this.displayPublishedURL}}</span>
              {{#if (gt this.publishedRealmURLs.length 1)}}
                <span
                  class='host-trigger-more'
                >+{{this.extraPublishedCount}}</span>
              {{/if}}
            </button>
            {{#if this.isHostDropdownOpen}}
              <div
                class='host-dropdown'
                data-test-host-dropdown={{@realmIdentifier}}
              >
                <span class='host-dropdown-header'>Launch in new window</span>
                <ul class='host-dropdown-list'>
                  {{#each this.publishedRealmURLs as |url|}}
                    <li>
                      <button
                        type='button'
                        class='host-dropdown-option'
                        {{on 'click' (fn this.openPublishedRealm url)}}
                        data-test-host-dropdown-option={{url}}
                      >{{url}}</button>
                    </li>
                  {{/each}}
                </ul>
              </div>
            {{/if}}
          {{/if}}

          <div class='info'>
            {{! Hovering the name shows it whole, over the realm URL that
                tells same-named workspaces apart. }}
            <RealmURLTooltip
              class='name-tooltip'
              @realmURL={{@realmIdentifier}}
              @label={{this.name}}
            >
              {{#if (eq @variant 'row')}}
                {{! The row's one button: it opens the workspace, carries the
                    keyboard cursor and stretches over the whole row. The
                    star, menu and globe sit above it. }}
                <button
                  type='button'
                  class='name row-open'
                  aria-describedby={{this.realmURLDescriptionId}}
                  data-nav-index={{@navIndex}}
                  {{on 'click' this.openWorkspace}}
                  {{focusWhenSelected @isSelected}}
                  data-test-workspace-button={{this.name}}
                  data-test-workspace-name
                >{{this.name}}</button>
              {{else}}
                <span class='name' data-test-workspace-name>{{this.name}}</span>
              {{/if}}
            </RealmURLTooltip>
            <span
              class='visibility-chip is-{{this.visibility}}'
              title={{this.visibilityLabel}}
              data-test-workspace-visibility
            >
              <this.visibilityIcon width='12' height='12' aria-hidden='true' />
              {{this.visibility}}
            </span>
            {{#if (eq @variant 'row')}}
              {{#if this.updatedAtLabel}}
                <span
                  class='updated'
                  title={{this.updatedAtLabel}}
                  data-test-workspace-updated
                >{{this.updatedAgoLabel}}</span>
              {{/if}}
            {{/if}}
          </div>
        {{/unless}}
      </div>
      {{! Sent out of the workspace so a size container around it can't trap
          these fixed-position modals. }}
      {{#if this.showDeleteModal}}
        <ToElsewhere
          @named='modal-elsewhere'
          @send={{component
            DeleteWorkspaceModal
            realmIdentifier=@realmIdentifier
            realmInfo=this.realmInfo
            name=this.name
            realmURLText=this.realmURLText
            isLoadingSummary=this.loadDeleteSummaryTask.isRunning
            summaryText=this.deleteSummaryText
            publishedRealmURLs=this.publishedRealmURLs
            error=this.deleteError
            isDeleting=this.deleteWorkspaceTask.isRunning
            onConfirm=(perform this.deleteWorkspaceTask)
            onClose=this.closeDeleteModal
            returnFocusTarget=this.returnFocusTarget
          }}
        />
      {{/if}}
      {{#if this.showArchiveModal}}
        <ToElsewhere
          @named='modal-elsewhere'
          @send={{component
            ArchiveWorkspaceModal
            realmIdentifier=@realmIdentifier
            realmInfo=this.realmInfo
            name=this.name
            realmURLText=this.realmURLText
            error=this.archiveError
            isArchiving=this.archiveWorkspaceTask.isRunning
            onConfirm=(perform this.archiveWorkspaceTask)
            onClose=this.closeArchiveModal
            returnFocusTarget=this.returnFocusTarget
          }}
        />
      {{/if}}
      {{#if this.showDuplicateModal}}
        <ToElsewhere
          @named='modal-elsewhere'
          @send={{component
            DuplicateWorkspaceModal
            realmIdentifier=@realmIdentifier
            realmInfo=this.realmInfo
            name=this.name
            error=this.duplicateError
            isDuplicating=this.duplicateWorkspaceTask.isRunning
            progressLabel=this.duplicateProgressLabel
            onConfirm=(perform this.duplicateWorkspaceTask)
            onClose=this.closeDuplicateModal
            returnFocusTarget=this.returnFocusTarget
          }}
        />
      {{/if}}
    {{/if}}
    <style scoped>
      .workspace {
        --workspace-control-size: var(--boxel-button-xs);
        --workspace-control-inset: 0.5rem;
        --workspace-glass: var(--boxel-dark-40);
        --workspace-chin-height: 2.25rem;
        --workspace-icon-size: 2.625rem;
        --workspace-desk-height: 17rem;
        --workspace-desk-radius: 1.5rem;

        position: relative;
        display: flex;
        flex-direction: column;
        min-width: 0;
        color: var(--boxel-light);
      }
      .workspace.is-loading {
        align-items: center;
        justify-content: center;
        height: var(--dashboard-tile-height);
        border-radius: var(--dashboard-tile-radius);
        background-color: var(--boxel-dark-50);
      }
      .workspace.is-loading.is-desk {
        height: var(--workspace-desk-height);
      }

      /* The wallpaper is its own layer, so a hover can reveal or scale it
         without moving what sits on top. */
      .wallpaper {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .wallpaper::before {
        content: '';
        position: absolute;
        inset: 0;
        background-color: var(--boxel-500);
        background-image: var(--workspace-background-image-url);
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        transition: opacity var(--boxel-transition);
      }
      .realm-icon-wrapper {
        position: relative;
        display: flex;
        flex-shrink: 0;
        border-radius: var(--boxel-border-radius-sm);
        box-shadow: 0 0.125rem 0.375rem var(--boxel-dark-40);
      }
      .realm-icon-wrapper::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: inset 0 0 0 1px var(--boxel-light-50);
        pointer-events: none;
      }
      .workspace-realm-icon {
        --boxel-realm-icon-size: var(--workspace-icon-size);
        --boxel-realm-icon-border-radius: var(--boxel-border-radius-sm);
        --boxel-realm-icon-background-color: var(--boxel-light);
      }

      /* The star and the menu: glass chips over the wallpaper, shown on
         hover, on keyboard focus inside the workspace, and under the
         cursor's ring. A favorited star stays. */
      .favorite-btn,
      .menu-btn {
        --boxel-icon-button-width: var(--workspace-control-size);
        --boxel-icon-button-height: var(--workspace-control-size);
        position: absolute;
        top: var(--workspace-control-inset);
        z-index: 3;
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--workspace-control-size);
        height: var(--workspace-control-size);
        overflow: hidden;
        border-radius: var(--boxel-border-radius-sm);
        color: var(--boxel-light);
        --icon-color: var(--boxel-light);
        opacity: 0;
        transition:
          opacity 0.15s ease,
          background-color 0.15s ease;
      }
      .favorite-btn {
        left: var(--workspace-control-inset);
      }
      .menu-btn {
        right: var(--workspace-control-inset);
      }
      .workspace:hover :is(.favorite-btn, .menu-btn),
      .workspace.is-selected :is(.favorite-btn, .menu-btn),
      .workspace:has(:focus-visible:not([data-nav-index]))
        :is(.favorite-btn, .menu-btn),
      .favorite-btn.is-favorited {
        opacity: 1;
        background-color: var(--workspace-glass);
        backdrop-filter: blur(0.375rem);
      }
      .favorite-btn.is-favorited {
        color: var(--boxel-highlight);
        --icon-color: var(--boxel-highlight);
      }
      /* Hovered, the glass brightens rather than fills: the star turns the
         highlight, the menu just lifts. */
      .workspace :is(.favorite-btn, .menu-btn):hover {
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 18%,
          var(--workspace-glass)
        );
      }
      .workspace .favorite-btn:hover {
        color: var(--boxel-highlight);
        --icon-color: var(--boxel-highlight);
      }
      .menu-btn:has([aria-expanded='true']) {
        opacity: 1;
        background-color: var(--boxel-highlight);
        color: var(--boxel-highlight-foreground);
        --icon-color: var(--boxel-highlight-foreground);
      }
      /* The wrapper's overflow would clip the button's own outline, so the
         wrapper draws it. */
      :is(.favorite-btn, .menu-btn):has(:focus-visible) {
        outline: var(--boxel-outline);
        outline-offset: -1px;
      }
      /* Tooltip wraps its trigger in a fit-content box; the whole chip stays
         the hover target. */
      .favorite-btn > :deep(.trigger),
      .favorite-btn :deep(button) {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
      }

      /* Who can see the workspace, as a tinted chip so Private, Shared and
         Public read apart at a glance. Lime is kept for Hosted. */
      .visibility-chip {
        --chip-color: var(--boxel-light-60);
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        height: 1.25rem;
        padding: 0 var(--boxel-sp-xs) 0 var(--boxel-sp-4xs);
        border: 1px solid
          color-mix(in oklch, var(--chip-color) 30%, transparent);
        border-radius: 0.625rem;
        background-color: color-mix(
          in oklch,
          var(--chip-color) 12%,
          transparent
        );
        color: var(--chip-color);
        font: 600 var(--boxel-font-xs);
        text-transform: capitalize;
        white-space: nowrap;
        --icon-color: currentColor;
      }
      .visibility-chip.is-shared {
        --chip-color: var(--boxel-cyan);
      }
      .visibility-chip.is-public {
        --chip-color: var(--boxel-highlight);
      }

      /* Desk. */
      .workspace.is-desk {
        --workspace-control-size: 2.125rem;
        --workspace-control-inset: 0.75rem;
        --workspace-glass: color-mix(
          in oklch,
          var(--boxel-800) 60%,
          transparent
        );
        gap: var(--boxel-sp-xs);
      }
      .workspace.is-desk :is(.favorite-btn, .menu-btn) {
        border-radius: 0.625rem;
        opacity: 1;
        background-color: var(--workspace-glass);
        backdrop-filter: blur(0.5rem);
      }
      .desk-surface {
        position: relative;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        height: var(--workspace-desk-height);
        padding: var(--workspace-control-inset);
        overflow: hidden;
        border-radius: var(--workspace-desk-radius);
        background-color: var(--boxel-500);
        background-image: var(--workspace-background-image-url);
        background-position: center;
        background-size: cover;
        box-shadow:
          0 0.625rem 1.5rem var(--boxel-dark-10),
          inset 0 0 0 1px var(--boxel-light-25);
        transition: box-shadow var(--boxel-transition);
      }
      .workspace.is-desk:hover .desk-surface {
        box-shadow:
          0 0.875rem 2rem var(--boxel-dark-30),
          inset 0 0 0 1px var(--boxel-light-50);
      }
      .workspace.is-desk.is-selected .desk-surface {
        box-shadow:
          0 0 0 2px var(--boxel-highlight),
          0 0.625rem 1.5rem var(--boxel-dark-10);
      }
      /* The bare wallpaper opens the workspace for a pointer; the keyboard
         has the name pill, so this stays out of the tab order. */
      .desk-hit {
        position: absolute;
        inset: 0;
        padding: 0;
        border: 0;
        background: none;
        cursor: pointer;
      }
      .desk-top {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-height: var(--workspace-control-size);
        /* Room for the star and the menu, which sit over the surface. */
        padding-inline: calc(
          var(--workspace-control-size) + var(--boxel-sp-4xs)
        );
        pointer-events: none;
      }
      .desk-pill-tooltip {
        min-width: 0;
      }
      .desk-pill {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        max-width: 100%;
        height: var(--workspace-control-size);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-sm) var(--boxel-sp-5xs)
          var(--boxel-sp-5xs);
        border: 0;
        border-radius: 0.75rem;
        background-color: var(--workspace-glass);
        backdrop-filter: blur(0.5rem);
        color: var(--boxel-light);
        font: 600 var(--boxel-font);
        cursor: pointer;
        pointer-events: auto;
      }
      .desk-pill:hover {
        background-color: color-mix(
          in oklch,
          var(--boxel-800) 78%,
          transparent
        );
      }
      .desk-pill:focus-visible {
        outline: none;
      }
      .desk-pill-icon {
        --boxel-realm-icon-size: 1.625rem;
        --boxel-realm-icon-border-radius: 0.4375rem;
        --boxel-realm-icon-background-color: var(--boxel-light);
        flex: none;
      }
      .desk-pill-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .desk-live {
        flex: none;
        margin-left: auto;
        padding: var(--boxel-sp-6xs) var(--boxel-sp-xs);
        border-radius: 0.75rem;
        background-color: var(--workspace-glass);
        backdrop-filter: blur(0.5rem);
        color: var(--boxel-lime);
        font: 600 var(--boxel-font-size-2xs) / 1.5
          var(--boxel-monospace-font-family);
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .desk-live::before {
        content: '● ' / '';
      }
      .desk-pins {
        position: relative;
        flex: 1;
        pointer-events: none;
      }
      .desk-caption {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        padding-inline: var(--boxel-sp-4xs);
        color: var(--muted-foreground);
        font: 400 var(--boxel-font-sm);
      }
      .desk-caption-line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-5xs) var(--boxel-sp-sm);
        min-height: 1.25rem;
      }
      .desk-stats {
        display: inline-flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-sm);
        min-height: 1lh;
      }
      .desk-stat {
        display: inline-flex;
        gap: var(--boxel-sp-5xs);
      }
      .desk-stat-number {
        color: var(--foreground);
        font-weight: 600;
      }
      .desk-host-line {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
        color: var(--foreground);
        white-space: nowrap;
      }
      .desk-host-dot {
        flex: none;
        width: 0.4375rem;
        height: 0.4375rem;
        border-radius: 50%;
        background-color: var(--boxel-lime);
      }
      .desk-host-link {
        min-width: 0;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 0.1875rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }
      .desk-host-link:focus-visible {
        outline: 2px solid var(--boxel-highlight);
        outline-offset: 2px;
      }

      /* Tile: the wallpaper face, its hosted chin, then the name and who can
         see it. */
      .workspace.is-tile {
        gap: var(--boxel-sp-xs);
      }
      /* The face's frame, and the cursor's ring when it rests here. Drawn
         over the face, whose wallpaper would cover an inset shadow. */
      .workspace.is-tile::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        z-index: 4;
        box-sizing: border-box;
        width: 100%;
        height: var(--dashboard-tile-height);
        border: 1px solid var(--boxel-light-25);
        border-radius: var(--dashboard-tile-radius);
        pointer-events: none;
      }
      .workspace.is-tile:hover::after {
        border-color: var(--boxel-light-50);
      }
      .workspace.is-tile.is-selected::after {
        border-color: var(--boxel-highlight);
        box-shadow: 0 0 0 1px var(--boxel-highlight);
      }
      .tile-face {
        cursor: pointer;
      }
      .host-trigger {
        position: absolute;
        top: calc(var(--dashboard-tile-height) - var(--workspace-chin-height));
        left: 0;
        z-index: 3;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        width: 100%;
        height: var(--workspace-chin-height);
        padding: 0 var(--boxel-sp-xs) 0 var(--boxel-sp-sm);
        overflow: hidden;
        border: none;
        border-radius: 0 0 var(--dashboard-tile-radius)
          var(--dashboard-tile-radius);
        background-color: var(--boxel-dark-40);
        backdrop-filter: blur(0.375rem);
        color: var(--boxel-light);
        cursor: pointer;
      }
      .host-trigger:hover {
        background-color: var(--boxel-dark-50);
      }
      .host-trigger:focus-visible {
        outline: var(--boxel-outline);
        outline-offset: -2px;
      }
      .host-trigger-globe {
        flex-shrink: 0;
        color: var(--boxel-highlight);
        --icon-color: var(--boxel-highlight);
      }
      .host-trigger-url {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 400 var(--boxel-font-xs);
      }
      .host-trigger-more {
        flex-shrink: 0;
        font: 600 var(--boxel-font-xs);
      }
      .host-dropdown {
        position: absolute;
        top: var(--dashboard-tile-height);
        right: 0;
        z-index: 10;
        display: flex;
        flex-direction: column;
        width: var(--boxel-xxs-container);
        max-width: 100%;
        padding: var(--boxel-sp-xs) 0 var(--boxel-sp-2xs);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light);
        box-shadow: 0 0.25rem 1rem var(--boxel-dark-30);
        color: var(--boxel-dark);
      }
      .host-dropdown-header {
        padding: 0 var(--boxel-sp-sm) var(--boxel-sp-xs);
        border-bottom: 1px solid var(--boxel-200);
        color: var(--boxel-550);
        font-size: var(--boxel-font-size-2xs);
        font-weight: 600;
      }
      .host-dropdown-list {
        margin: 0;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-2xs);
        list-style: none;
      }
      .host-dropdown-option {
        display: block;
        width: 100%;
        padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
        overflow: hidden;
        border: none;
        border-radius: var(--boxel-border-radius-sm);
        background: none;
        color: var(--boxel-dark);
        font: 400 var(--boxel-font-xs);
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }
      .host-dropdown-option:hover {
        background-color: var(--boxel-100);
      }
      .info {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        min-width: 0;
      }
      /* A tile's site list opens over its name. */
      .is-tile.is-open .info {
        visibility: hidden;
      }
      /* The name's tooltip trigger spans the column, so the name truncates
         in it. */
      .name-tooltip {
        width: 100%;
        min-width: 0;
      }
      /* One line under every tile, so tiles keep one height and their chips
         line up across the row; hovering the name shows it whole. */
      .name {
        display: block;
        width: 100%;
        overflow: hidden;
        color: var(--boxel-light);
        font: 400 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Row: a thumbnail, the name, who can see it and when it changed. */
      .workspace.is-row {
        --workspace-control-inset: 0.375rem;
        --workspace-control-step: calc(var(--workspace-control-size) + 0.25rem);
        --workspace-icon-size: 1.5rem;
        --workspace-time-inset: 0.75rem;
        --workspace-time-max-width: 6rem;
        box-sizing: border-box;
        flex-direction: row;
        align-items: center;
        gap: var(--boxel-sp-sm);
        height: var(--dashboard-row-height);
        /* The end clears the star and the menu. */
        padding: var(--boxel-sp-xs)
          calc(
            var(--workspace-control-inset) + 2 * var(--workspace-control-step)
          )
          var(--boxel-sp-xs) var(--boxel-sp-xs);
        border-radius: var(--dashboard-tile-radius);
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 4%,
          transparent
        );
        box-shadow: inset 0 0 0 1px
          color-mix(in oklch, var(--boxel-light) 8%, transparent);
        transition: background-color var(--boxel-transition);
      }
      .workspace.is-row:hover {
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 9%,
          transparent
        );
      }
      .workspace.is-row.is-selected {
        box-shadow: inset 0 0 0 2px var(--boxel-highlight);
      }
      /* A long list of wallpapers is noise at scan distance: the row shows
         the realm's mark, and its wallpaper only while hovered. */
      .row-thumb {
        flex: none;
        width: calc(var(--dashboard-row-height) - 2 * var(--boxel-sp-xs));
        height: 100%;
        border-radius: 0.75rem;
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 6%,
          transparent
        );
      }
      .row-thumb::before {
        opacity: 0;
      }
      .workspace.is-row:hover .row-thumb::before {
        opacity: 1;
      }
      .is-row .info {
        flex: 1;
        align-items: flex-start;
        gap: var(--boxel-sp-4xs);
      }
      .is-row .name {
        font-weight: 600;
        text-align: left;
      }
      /* Above the row's hit area, so its title shows. */
      .is-row .visibility-chip {
        position: relative;
        z-index: 2;
      }
      /* A button ignores line-clamp, so the name truncates on one line. Its
         hit area covers the row; the controls sit above it. */
      .row-open {
        padding: 0;
        border: 0;
        background: none;
        cursor: pointer;
      }
      .row-open::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 1;
        border-radius: inherit;
      }
      .row-open:focus-visible {
        outline: none;
      }
      /* Above the row's hit area, so its title, the full date, shows. */
      .updated {
        position: absolute;
        right: var(--workspace-time-inset);
        bottom: var(--boxel-sp-xs);
        z-index: 2;
        max-width: var(--workspace-time-max-width);
        overflow: hidden;
        color: var(--boxel-400);
        font-size: var(--boxel-font-size-2xs);
        text-align: right;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* The row's controls gather top-right, above the time: the menu at the
         end, the star before it and, on a hosted row, the globe before
         that. */
      .is-row .favorite-btn {
        left: auto;
        right: calc(
          var(--workspace-control-inset) + var(--workspace-control-step)
        );
      }
      .is-row .host-trigger {
        top: var(--workspace-control-inset);
        left: auto;
        right: calc(
          var(--workspace-control-inset) + 2 * var(--workspace-control-step)
        );
        justify-content: center;
        width: var(--workspace-control-size);
        height: var(--workspace-control-size);
        padding: 0;
        border-radius: 50%;
        opacity: 0;
        transition: opacity var(--boxel-transition);
      }
      .workspace.is-row:hover .host-trigger,
      .workspace.is-row.is-open .host-trigger,
      .workspace.is-row.is-selected .host-trigger,
      .is-row .host-trigger:focus-visible {
        opacity: 1;
      }
      .is-row :is(.host-trigger-url, .host-trigger-more) {
        display: none;
      }
      .is-row .host-dropdown {
        top: 100%;
      }

      .reindex-error {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 5;
        box-sizing: border-box;
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-5xs);
        width: 100%;
        padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
        border-radius: var(--dashboard-tile-radius) var(--dashboard-tile-radius)
          0 0;
        background-color: var(--boxel-danger);
        color: var(--boxel-light);
        font: 600 var(--boxel-font-xs);
      }
      .reindex-error-message {
        flex: 1;
        overflow: hidden;
        overflow-wrap: anywhere;
        /* A long server error is capped at a few lines; the title has it
           whole. */
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        line-clamp: 3;
      }
      .reindex-error-dismiss {
        display: flex;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        margin: 0;
        padding: var(--boxel-sp-6xs);
        border: none;
        border-radius: var(--boxel-border-radius-xs);
        background: transparent;
        color: inherit;
        --icon-color: currentColor;
        cursor: pointer;
      }
      .reindex-error-dismiss:hover {
        background-color: var(--boxel-light-25);
      }

      .menu-footer {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-top: 1px solid var(--boxel-light-25);
      }
      .menu-footer-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-6xs);
      }
      .menu-footer-label,
      .menu-footer-value {
        color: var(--boxel-450);
        font-size: var(--boxel-font-size-2xs);
      }
    </style>
  </template>

  @service declare private workspaceDuplication: WorkspaceDuplicationService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private recentFilesService: RecentFilesService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @tracked private showDeleteModal = false;
  @tracked private deleteError: string | undefined;
  @tracked private deleteSummary:
    | ReturnType<typeof summarizeWorkspaceContents>
    | undefined;
  @tracked private showArchiveModal = false;
  @tracked private archiveError: string | undefined;
  @tracked private showDuplicateModal = false;
  @tracked private duplicateError: string | undefined;
  private duplicateAbortController: AbortController | undefined;
  @tracked private duplicateProgress:
    | { copied: number; total: number }
    | undefined;
  @tracked private isHostDropdownOpen = false;
  @tracked private reindexError: string | undefined;

  constructor(...args: [any, any]) {
    super(...args);
    this.loadRealmTask
      .perform()
      .catch((error: unknown) => this.reportRealmLoadFailure(error));
  }

  willDestroy() {
    super.willDestroy();
    this.clearReindexError();
  }

  // Fills in the session and the realm metadata the workspace renders from.
  // It renders at once off `realm.info()`, which answers synchronously with a
  // placeholder, so nothing awaits this.
  private loadRealmTask = task(async () => {
    await this.realm.login(this.args.realmIdentifier);
    await this.realm.ensureRealmMeta(this.args.realmIdentifier);
  });

  // Best-effort: on failure the workspace keeps its placeholder name. Caught
  // so an unconsumed task error doesn't fail whichever test is running, and
  // logged with its stack, since a dropped connection's `Failed to fetch`
  // names neither the request nor the caller.
  private reportRealmLoadFailure(error: unknown) {
    if (didCancel(error)) {
      return;
    }
    log.warn(
      `workspace background realm load failed for ${this.args.realmIdentifier}: ${error}`,
      error instanceof Error ? error.stack : undefined,
    );
  }

  private tileElement: HTMLElement | undefined;
  private captureTile = modifier((element: HTMLElement) => {
    this.tileElement = element;
  });
  private menuTrigger: HTMLElement | undefined;
  private captureMenuTrigger = modifier((element: HTMLElement) => {
    this.menuTrigger = element;
  });

  // Recorded when a modal opens, since a delete or archive removes this
  // workspace before the modal hands focus back. The position is within its
  // own list, and the list's ancestors are kept too, as the list itself goes
  // once empty.
  private focusContext:
    | { list: HTMLElement; ancestors: HTMLElement[]; position: number }
    | undefined;

  private workspaceTargets(container: HTMLElement) {
    return [...container.querySelectorAll<HTMLElement>(WORKSPACE_TILE_TARGET)];
  }

  private rememberFocusContext() {
    let list = this.tileElement?.parentElement;
    if (!list) {
      this.focusContext = undefined;
      return;
    }
    let ancestors: HTMLElement[] = [];
    for (let el = list.parentElement; el; el = el.parentElement) {
      ancestors.push(el);
    }
    this.focusContext = {
      list,
      ancestors,
      position: this.workspaceTargets(list).findIndex((target) =>
        this.tileElement?.contains(target),
      ),
    };
  }

  // Focus goes back to the menu trigger. Once the workspace is gone it goes
  // to the one that took its place in the list, or else the last one left in
  // it, or else the nearest one outside it. New Workspace comes last, so
  // Enter doesn't create a workspace.
  private returnFocusTarget = (): HTMLElement | undefined => {
    if (this.menuTrigger?.isConnected) {
      return this.menuTrigger;
    }
    if (!this.focusContext) {
      return undefined;
    }
    let { list, ancestors, position } = this.focusContext;
    if (list.isConnected) {
      let targets = this.workspaceTargets(list);
      let target = targets[position] ?? targets.at(-1);
      if (target) {
        return target;
      }
    }
    for (let ancestor of ancestors) {
      let target = ancestor.isConnected
        ? ancestor.querySelector<HTMLElement>(WORKSPACE_TILE_TARGET)
        : null;
      if (target) {
        return target;
      }
    }
    for (let container of [list, ...ancestors]) {
      let target = container.isConnected
        ? container.querySelector<HTMLElement>('[data-nav-index]')
        : null;
      if (target) {
        return target;
      }
    }
    return undefined;
  };

  @cached
  private get realmInfo() {
    return this.realm.info(this.args.realmIdentifier);
  }

  private get name() {
    return this.realmInfo.name;
  }

  private get realmURLDescriptionId() {
    return `${guidFor(this)}-realm-url`;
  }

  private get realmURLText() {
    return realmURLDisplayText(
      this.network.virtualNetwork,
      this.args.realmIdentifier,
    );
  }

  private get showSelectionRing() {
    return Boolean(this.args.isSelected && this.args.selectionActive);
  }

  private get isFavorited() {
    return this.matrixService.workspaceFavorites.includes(
      this.args.realmIdentifier,
    );
  }

  // Both the button's accessible name and its tooltip, so they can't drift.
  private get favoriteLabel() {
    return this.isFavorited ? 'Remove from Favorites' : 'Add to Favorites';
  }

  private get menuItems() {
    let items = [
      new MenuItem({
        label: this.isFavorited ? 'Unfavorite' : 'Favorite',
        icon: this.isFavorited ? StarFilled : Star,
        action: this.toggleFavorite,
      }),
    ];
    // Only the skills realm duplicates: its contents are all relative
    // references, which a file-by-file copy keeps intact.
    if (this.canDuplicateWorkspace) {
      items.push(
        new MenuItem({
          label: 'Duplicate Workspace',
          icon: CopyIcon,
          action: this.openDuplicateModal,
        }),
      );
    }
    items.push(
      new MenuItem({
        id: 'realm-settings',
        label: 'Realm Settings',
        icon: FileSettingsIcon,
        action: this.openRealmConfig,
      }),
    );
    if (this.isRealmOwner) {
      items.push(
        new MenuItem({
          label: 'Re-index',
          icon: RefreshIcon,
          action: this.reindexWorkspaceTask.perform,
          // The live indexing flag, not the task, which resolves as soon as
          // the server accepts the request.
          disabled: this.realmInfo.isIndexing,
        }),
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
        disabled: !this.isRealmOwner,
      }),
    );
    return items;
  }

  @action private openRealmConfig() {
    this.operatorModeStateService.openCardInInteractMode(
      `${ensureTrailingSlash(this.args.realmIdentifier)}realm`,
      'edit',
    );
    this.operatorModeStateService.closeWorkspaceChooser();
  }

  @action private async toggleFavorite() {
    if (this.isFavorited) {
      await this.matrixService.removeWorkspaceFavorite(
        this.args.realmIdentifier,
      );
    } else {
      await this.matrixService.addWorkspaceFavorite(this.args.realmIdentifier);
    }
  }

  private get publishedRealmURLs() {
    return publishedRealmURLsFromInfo(this.realmInfo);
  }

  private get hasPublishedRealms() {
    return this.publishedRealmURLs.length > 0;
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

  private get extraPublishedCount() {
    return Math.max(this.publishedRealmURLs.length - 1, 0);
  }

  private get extraPublishedTitle() {
    return this.publishedRealmURLs.slice(1).join('\n');
  }

  private get hostTriggerLabel() {
    return `Hosted at ${this.displayPublishedURL}`;
  }

  @action private toggleHostDropdown(event: Event) {
    event.stopPropagation();
    this.isHostDropdownOpen = !this.isHostDropdownOpen;
  }

  @action private openPublishedRealm(url: string, event: MouseEvent) {
    event.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
    this.isHostDropdownOpen = false;
  }

  @action private closeHostDropdown() {
    this.isHostDropdownOpen = false;
  }

  private get backgroundImageURL() {
    let { backgroundURL } = this.realmInfo;
    return backgroundURL ? `url(${backgroundURL})` : '';
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
      default:
        return Lock;
    }
  }

  private get visibilityLabel() {
    switch (this.visibility) {
      case 'public':
        return 'Public workspace';
      case 'shared':
        return 'Shared workspace';
      default:
        return 'Private workspace';
    }
  }

  private get createdAtLabel() {
    let { createdAt } = this.realmInfo;
    return createdAt ? formatRelativeTime(new Date(createdAt)) : undefined;
  }

  private get updatedAtLabel() {
    let { updatedAt } = this.realmInfo;
    return updatedAt ? formatUpdatedTime(new Date(updatedAt)) : undefined;
  }

  private get updatedAgoLabel() {
    return this.updatedAtLabel?.replace(UPDATED_PREFIX, '');
  }

  // A desk's Cards / Files / Definitions counts. A stat with no count is
  // dropped rather than shown as 0. The counts are requested for favorites
  // alone, after the desk renders, so the caption reserves their line.
  private get tileStats(): { label: string; count: number }[] {
    let counts = this.realm.indexCounts(this.args.realmIdentifier);
    if (!counts) {
      return [];
    }
    return [
      { label: 'Cards', count: counts.cardCount },
      { label: 'Files', count: counts.fileCount },
      { label: 'Definitions', count: counts.definitionCount },
    ].filter((stat): stat is { label: string; count: number } => !!stat.count);
  }

  private get isRealmOwner() {
    return this.realm.isRealmOwner(this.args.realmIdentifier);
  }

  private get canDuplicateWorkspace() {
    return ensureTrailingSlash(this.args.realmIdentifier) === skillsRealmURL;
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

  private get duplicateProgressLabel() {
    if (!this.duplicateProgress) {
      return 'Preparing to copy…';
    }
    let { copied, total } = this.duplicateProgress;
    return `Copying ${copied} of ${total} ${pluralize('file', total)}…`;
  }

  @action private async openWorkspace() {
    await this.operatorModeStateService.openWorkspace(
      this.args.realmIdentifier,
    );
  }

  @action private openDeleteModal() {
    if (!this.isRealmOwner) {
      return;
    }
    this.deleteSummary = undefined;
    this.deleteError = undefined;
    this.rememberFocusContext();
    this.showDeleteModal = true;
    this.loadDeleteSummaryTask.perform();
  }

  @action private closeDeleteModal() {
    if (this.deleteWorkspaceTask.isRunning) {
      return;
    }
    this.showDeleteModal = false;
    this.deleteError = undefined;
  }

  @action private openArchiveModal() {
    if (!this.isRealmOwner) {
      return;
    }
    this.archiveError = undefined;
    this.rememberFocusContext();
    this.showArchiveModal = true;
  }

  @action private closeArchiveModal() {
    if (this.archiveWorkspaceTask.isRunning) {
      return;
    }
    this.showArchiveModal = false;
    this.archiveError = undefined;
  }

  @action private openDuplicateModal() {
    if (!this.canDuplicateWorkspace) {
      return;
    }
    this.duplicateError = undefined;
    this.rememberFocusContext();
    this.showDuplicateModal = true;
  }

  @action private closeDuplicateModal() {
    if (this.duplicateWorkspaceTask.isRunning) {
      this.cancelDuplication();
      return;
    }
    this.showDuplicateModal = false;
    this.duplicateError = undefined;
  }

  // The modal closes at once; the service notices the abort at its next
  // batch and cleans up the partial realm in the background.
  @action private cancelDuplication() {
    this.duplicateAbortController?.abort();
    this.showDuplicateModal = false;
    this.duplicateProgress = undefined;
  }

  @action private clearReindexError() {
    this.reindexError = undefined;
  }

  // Whether the workspace, or anything open from it, is on screen behind the
  // dashboard; removing it then clears the stacks.
  private get isActiveWorkspace() {
    let realmPath = new RealmPaths(this.args.realmIdentifier);
    return (
      this.operatorModeStateService.realmURL === this.args.realmIdentifier ||
      this.operatorModeStateService
        .getOpenCardIds()
        .some((cardId) => realmPath.inRealm(cardId)) ||
      Boolean(
        this.operatorModeStateService.state.codePath?.startsWith(
          this.args.realmIdentifier,
        ),
      )
    );
  }

  private async leaveRemovedWorkspace(wasActive: boolean) {
    if (wasActive) {
      this.operatorModeStateService.clearStacks();
      await this.operatorModeStateService.updateCodePath(null);
      this.operatorModeStateService.openWorkspaceChooser();
    }
  }

  private archiveWorkspaceTask = dropTask(async () => {
    this.archiveError = undefined;
    try {
      let wasActive = this.isActiveWorkspace;
      await this.realmServer.archiveRealm(this.args.realmIdentifier);
      // Archiving seals the realm; its session goes so background requests
      // don't loop on 403. Restoring creates a new one.
      this.realm.removeRealm(this.args.realmIdentifier);
      await this.leaveRemovedWorkspace(wasActive);
      this.showArchiveModal = false;
    } catch (error: any) {
      this.archiveError = error.message;
    }
  });

  private duplicateWorkspaceTask = dropTask(async () => {
    this.duplicateError = undefined;
    this.duplicateProgress = undefined;
    this.duplicateAbortController = new AbortController();
    try {
      await this.workspaceDuplication.duplicateWorkspace(
        this.args.realmIdentifier,
        {
          onProgress: (copied, total) => {
            this.duplicateProgress = { copied, total };
          },
          signal: this.duplicateAbortController.signal,
        },
      );
      this.showDuplicateModal = false;
    } catch (error: any) {
      // A cancel is the user's own doing; only real failures are shown.
      if (error?.name !== 'AbortError') {
        this.duplicateError = String(error?.message ?? error);
      }
    } finally {
      // Also runs when teardown cancels the task, so the service stops
      // copying rather than carrying on with no UI attached.
      this.duplicateAbortController?.abort();
      this.duplicateProgress = undefined;
      this.duplicateAbortController = undefined;
    }
  });

  private reindexWorkspaceTask = dropTask(async () => {
    this.clearReindexError();
    try {
      await this.realm.fullReindex(this.args.realmIdentifier);
    } catch (error: any) {
      // Stays until dismissed or retried, so a failed pass is noticed.
      this.reindexError = String(error?.message ?? error);
    }
  });

  private loadDeleteSummaryTask = dropTask(async () => {
    try {
      let response = await this.network.authedFetch(
        `${this.args.realmIdentifier}_mtimes`,
        { headers: { Accept: SupportedMimeType.Mtimes } },
      );
      if (!response.ok) {
        throw new Error(
          `Failed to fetch workspace contents: ${response.status}`,
        );
      }
      let json = (await response.json()) as {
        data: { attributes: { mtimes: Record<string, number> } };
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
      let wasActive = this.isActiveWorkspace;
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
      await this.leaveRemovedWorkspace(wasActive);
      this.showDeleteModal = false;
    } catch (error: any) {
      this.deleteError = error.message;
    }
  });
}
