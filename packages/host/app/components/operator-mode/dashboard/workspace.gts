import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import ArchiveIcon from '@cardstack/boxel-icons/archive';
import CopyIcon from '@cardstack/boxel-icons/copy';
import DotsHorizontal from '@cardstack/boxel-icons/dots';
import FileSettingsIcon from '@cardstack/boxel-icons/file-settings';
import Globe from '@cardstack/boxel-icons/globe';
import Lock from '@cardstack/boxel-icons/lock';
import RefreshIcon from '@cardstack/boxel-icons/refresh-cw';
import IconTrash from '@cardstack/boxel-icons/trash-2';
import Group from '@cardstack/boxel-icons/users';
import IconX from '@cardstack/boxel-icons/x';
import { Button } from '@cardstack/pretui/components/button';
import { IconButton } from '@cardstack/pretui/components/icon-button';
import { Menu as PretMenu } from '@cardstack/pretui/components/menu';
import { Spinner } from '@cardstack/pretui/components/spinner';

import { didCancel, dropTask, task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';
import { modifier } from 'ember-modifier';
import pluralize from 'pluralize';

import { BoxelDropdown, Menu, RealmIcon } from '@cardstack/boxel-ui/components';
import { MenuItem, cn, cssVar, eq, gt, or } from '@cardstack/boxel-ui/helpers';
import { Star, StarFilled } from '@cardstack/boxel-ui/icons';

import {
  ensureTrailingSlash,
  logger,
  RealmPaths,
  resolveRRIReference,
  rri,
  SupportedMimeType,
  type RealmIdentifier,
} from '@cardstack/runtime-common';

import RealmURLTooltip from '@cardstack/host/components/realm-url-tooltip';
import {
  realmURLDisplayText,
  urlDisplayText,
} from '@cardstack/host/lib/realm-utils';
import {
  publishedRealmURLsFromInfo,
  skillsRealmURL,
} from '@cardstack/host/lib/utils';
import { wallpaperImage } from '@cardstack/host/lib/workspace-list';
import focusWhenSelected from '@cardstack/host/modifiers/focus-when-selected';
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

import HostedPill from './hosted-pill';
import ItemContainer from './item-container';

import type { MenuEntry } from '@cardstack/pretui/internal/menu';

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

// A Tab stop only while the element overflows, so a long text can be
// scrolled from the keyboard and a short one adds no stop. Passed the text,
// it measures again when the text changes in a box that doesn't resize.
const focusableWhenScrollable = modifier(
  (element: HTMLElement, [_text]: [string | undefined]) => {
    let update = () => {
      if (element.scrollHeight > element.clientHeight) {
        element.tabIndex = 0;
      } else {
        element.removeAttribute('tabindex');
      }
    };
    let observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  },
);

// A row's trailing time drops the "Updated" its position already says.
const UPDATED_PREFIX = /^Updated /;

export default class Workspace extends Component<Signature> {
  <template>
    {{#if this.loadRealmTask.isRunning}}
      {{! Still a stop in the keyboard walk, so the cursor has somewhere to
          rest while the workspace loads. }}
      <div
        class={{cn
          'workspace'
          (concat 'is-' @variant)
          'is-loading'
          is-selected=this.showSelectionRing
        }}
        tabindex='-1'
        data-nav-index={{@navIndex}}
        {{focusWhenSelected @isSelected scrollOnOpen='when-off-screen'}}
        data-test-workspace-loading-indicator
      >
        <Spinner @size={{20}} aria-hidden='true' />
        <span class='boxel-sr-only'>Loading workspace</span>
      </div>
    {{else}}
      <div
        class={{cn
          'workspace'
          (concat 'is-' @variant)
          is-open=this.isHostDropdownOpen
          is-selected=this.showSelectionRing
        }}
        style={{cssVar workspace-background-image-url=this.backgroundImageURL}}
        data-workspace-tile
        {{this.captureTile}}
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
              {{focusableWhenScrollable this.reindexError}}
              data-test-reindex-error-message
            >{{this.reindexError}}</span>
            <IconButton
              class='reindex-error-dismiss'
              @label='Dismiss error'
              @appearance='plain'
              @size='s'
              {{on 'click' this.clearReindexError}}
              data-test-reindex-error-dismiss
            >
              <IconX class='control-icon' width='14' height='14' />
            </IconButton>
          </div>
        {{/if}}
        {{! The URL describes the workspace rather than naming it, so it sits
            outside the button: text inside a button joins its accessible
            name. Hidden, so it's read only as that description, which
            aria-describedby still reaches. }}
        <span
          id={{this.realmURLDescriptionId}}
          class='boxel-sr-only'
          aria-hidden='true'
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
                  aria-describedby={{this.descriptionIds}}
                  data-nav-index={{@navIndex}}
                  {{on 'click' this.openWorkspace}}
                  {{focusWhenSelected
                    @isSelected
                    scrollOnOpen='when-off-screen'
                  }}
                  data-test-workspace-button={{this.name}}
                >
                  {{! The name beside it labels the button. }}
                  <RealmIcon
                    class='desk-pill-icon'
                    @realmInfo={{this.realmInfo}}
                    aria-hidden='true'
                  />
                  <span
                    class='desk-pill-name'
                    data-test-workspace-name
                  >{{this.name}}</span>
                </button>
              </RealmURLTooltip>
              {{#if this.hasPublishedRealms}}
                <HostedPill class='desk-live' data-test-workspace-hosted />
              {{/if}}
            </div>
            {{! Room for the workspace's pinned cards. }}
            <div class='desk-pins'></div>
          </div>
          <div class='desk-caption'>
            {{! Always rendered, so the counts, which load after the desk,
                fill reserved space instead of growing the caption. }}
            <div class='desk-caption-line'>
              {{! Hidden, as the button reads it in its description. }}
              <span
                class={{cn 'visibility-chip' (concat 'is-' this.visibility)}}
                aria-hidden='true'
                data-test-workspace-visibility
              >
                <this.visibilityIcon width='12' height='12' />
                <span
                  data-test-workspace-visibility-word
                >{{this.visibility}}</span>
                <span
                  id={{this.visibilityDescriptionId}}
                  class='boxel-sr-only'
                >{{this.visibilityLabel}}</span>
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
                {{! A link in running text, so a native one rather than a Pret
                    UI Button, which is for standalone actions. }}
                <a
                  class='desk-host-link'
                  href={{this.primaryPublishedURL}}
                  target='_blank'
                  rel='noopener noreferrer'
                  title={{this.primaryPublishedURL}}
                  data-test-desk-host-link={{@realmIdentifier}}
                ><span class='desk-host-url'>{{this.displayPublishedURL}}</span>
                  <span aria-hidden='true'>↗</span><span class='boxel-sr-only'>
                    (opens in a new tab)</span></a>
                {{! The other sites in a menu, which stays on screen where a
                    tooltip can't. }}
                {{#if (gt this.publishedRealmURLs.length 1)}}
                  <PretMenu
                    @items={{this.extraHostMenuItems}}
                    @label='More hosted sites'
                    @open={{this.isHostDropdownOpen}}
                    @onOpenChange={{this.setHostDropdownOpen}}
                  >
                    <:trigger as |_open toggle|>
                      <Button
                        class='desk-host-more'
                        @appearance='link'
                        aria-label={{this.extraPublishedLabel}}
                        {{on 'click' toggle}}
                        data-test-desk-host-more={{@realmIdentifier}}
                      >+{{this.extraPublishedCount}}</Button>
                    </:trigger>
                  </PretMenu>
                {{/if}}
              </div>
            {{/if}}
          </div>
        {{else if (eq @variant 'row')}}
          {{! The row's wallpaper is decoration; its name, below, is the
              button. }}
          <span class='wallpaper row-thumb' aria-hidden='true'>
            {{! Above the row's hit area so its tooltip shows; a click on it
                still opens the workspace. }}
            <RealmURLTooltip
              class='row-icon-tooltip'
              @realmURL={{@realmIdentifier}}
              {{on 'click' this.openWorkspace}}
            >
              <span class='realm-icon-wrapper'>
                <RealmIcon
                  class='workspace-realm-icon'
                  @realmInfo={{this.realmInfo}}
                />
              </span>
            </RealmURLTooltip>
          </span>
        {{else}}
          <ItemContainer
            class='tile-face'
            aria-describedby={{this.descriptionIds}}
            data-nav-index={{@navIndex}}
            {{on 'click' this.openWorkspace}}
            {{focusWhenSelected @isSelected scrollOnOpen='when-off-screen'}}
            data-test-workspace-button={{this.name}}
          >
            <span class='wallpaper'>
              <RealmURLTooltip @realmURL={{@realmIdentifier}}>
                <span class='realm-icon-wrapper'>
                  <RealmIcon
                    class='workspace-realm-icon'
                    @realmInfo={{this.realmInfo}}
                    @canAnimate={{true}}
                  />
                </span>
              </RealmURLTooltip>
            </span>
          </ItemContainer>
        {{/if}}

        <div class={{cn 'favorite-btn' is-favorited=this.isFavorited}}>
          {{! The star's fill already shows the state, so it takes no
              pressed tint, which would show as a gray square on the chip.
              Its tip opens to the right, into the tile: centered above the
              corner, it would run past the tile into a narrow gutter. }}
          <IconButton
            @label='Favorite'
            @appearance='plain'
            @pressed={{this.isFavorited}}
            @pressedTint={{false}}
            @tooltip={{if
              this.isFavorited
              'Remove from Favorites'
              'Add to Favorites'
            }}
            @tooltipSide='right'
            {{on 'click' this.toggleFavorite}}
            data-test-workspace-favorite-btn={{@realmIdentifier}}
          >
            {{#if this.isFavorited}}
              <StarFilled class='control-icon' width='16' height='16' />
            {{else}}
              <Star class='control-icon' width='16' height='16' />
            {{/if}}
          </IconButton>
        </div>
        {{! The options menu uses BoxelDropdown: Pret UI's Menu takes items
            alone, with no room for the dates under them. }}
        <div class='menu-btn'>
          <BoxelDropdown @contentClass='workspace-menu-dropdown'>
            <:trigger as |bindings|>
              <IconButton
                @label='Options'
                @appearance='plain'
                {{bindings}}
                {{this.captureMenuTrigger}}
                data-test-workspace-menu-trigger={{@realmIdentifier}}
              >
                <DotsHorizontal class='control-icon' width='16' height='16' />
              </IconButton>
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
            <div class='host-menu'>
              <PretMenu
                class='host-menu-wrap'
                @items={{this.hostMenuItems}}
                @align='end'
                @label='Hosted sites'
                @open={{this.isHostDropdownOpen}}
                @onOpenChange={{this.setHostDropdownOpen}}
              >
                <:trigger as |_open toggle|>
                  <button
                    type='button'
                    class='host-trigger'
                    aria-label={{this.hostTriggerLabel}}
                    {{on 'click' toggle}}
                    data-test-host-trigger={{@realmIdentifier}}
                  >
                    <Globe
                      class='host-trigger-globe'
                      width='13'
                      height='13'
                      aria-hidden='true'
                    />
                    <span
                      class='host-trigger-url'
                    >{{this.displayPublishedURL}}</span>
                    {{#if (gt this.publishedRealmURLs.length 1)}}
                      <span
                        class='host-trigger-more'
                      >+{{this.extraPublishedCount}}</span>
                    {{/if}}
                  </button>
                </:trigger>
              </PretMenu>
            </div>
          {{/if}}

          <div class='info'>
            {{#if (eq @variant 'row')}}
              {{! The row's one button: it opens the workspace, carries the
                    keyboard cursor and stretches over the whole row. The
                    star, menu and globe sit above it. }}
              <button
                type='button'
                class='name row-open'
                aria-describedby={{this.descriptionIds}}
                data-nav-index={{@navIndex}}
                {{on 'click' this.openWorkspace}}
                {{focusWhenSelected @isSelected scrollOnOpen='when-off-screen'}}
                data-test-workspace-button={{this.name}}
                data-test-workspace-name
              >{{this.name}}</button>
            {{else}}
              <span class='name' data-test-workspace-name>{{this.name}}</span>
            {{/if}}
            {{! Hidden, as the button reads the chip and the time in its
                description. }}
            <span
              class={{cn 'visibility-chip' (concat 'is-' this.visibility)}}
              aria-hidden='true'
              data-test-workspace-visibility
            >
              <this.visibilityIcon width='12' height='12' />
              <span
                data-test-workspace-visibility-word
              >{{this.visibility}}</span>
              <span
                id={{this.visibilityDescriptionId}}
                class='boxel-sr-only'
              >{{this.visibilityLabel}}</span>
            </span>
            {{#if this.showsUpdatedTime}}
              <span
                class='updated'
                aria-hidden='true'
                data-test-workspace-updated
              >
                <span>{{this.updatedAgoLabel}}</span>
                <span
                  id={{this.updatedDescriptionId}}
                  class='boxel-sr-only'
                >{{this.spokenUpdatedAtLabel}}</span>
              </span>
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
        --_workspace-control-size: var(--boxel-button-xs);
        --_workspace-control-radius: var(--boxel-border-radius-sm);
        --_workspace-control-inset: 0.5rem;
        --_workspace-glass: var(--boxel-dark-40);
        --_workspace-glass-blur: blur(0.375rem);
        --_workspace-chin-height: 2.25rem;
        --_workspace-chip-height: 1.25rem;
        --_workspace-icon-size: 2.625rem;
        --_workspace-desk-height: 17rem;
        --_workspace-desk-radius: 1.5rem;
        --_workspace-row-tint-hover: color-mix(
          in oklch,
          var(--boxel-light) 9%,
          transparent
        );

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
        height: var(--_workspace-desk-height);
        border-radius: var(--_workspace-desk-radius);
      }
      /* Transparent rather than none, so forced-colors mode, which drops
         the ring's box-shadow, still draws a focus outline. */
      .workspace.is-loading:focus {
        outline: 2px solid transparent;
      }
      .workspace.is-loading.is-selected,
      .workspace.is-loading:focus-visible {
        box-shadow: var(--dashboard-ring);
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
        --boxel-realm-icon-size: var(--_workspace-icon-size);
        --boxel-realm-icon-border-radius: var(--boxel-border-radius-sm);
        --boxel-realm-icon-background-color: var(--boxel-light);
      }

      /* The star and the menu: glass chips over the wallpaper, shown on
         hover, on keyboard focus inside the workspace, and under the
         cursor's ring. A favorited star stays. The button fills its chip. */
      .favorite-btn,
      .menu-btn {
        --pretui-button-h: var(--_workspace-control-size);
        --pretui-button-radius: var(--_workspace-control-radius);
        position: absolute;
        top: var(--_workspace-control-inset);
        z-index: 3;
        display: flex;
        width: var(--_workspace-control-size);
        height: var(--_workspace-control-size);
        border-radius: var(--_workspace-control-radius);
        opacity: 0;
        transition:
          opacity var(--boxel-transition),
          background-color var(--boxel-transition);
      }
      .favorite-btn {
        left: var(--_workspace-control-inset);
      }
      .menu-btn {
        right: var(--_workspace-control-inset);
      }
      .workspace:hover :is(.favorite-btn, .menu-btn),
      .workspace.is-selected :is(.favorite-btn, .menu-btn),
      .workspace:has(:focus-visible:not([data-nav-index]))
        :is(.favorite-btn, .menu-btn),
      .menu-btn:has([aria-expanded='true']),
      .favorite-btn.is-favorited {
        opacity: 1;
        background-color: var(--_workspace-glass);
        backdrop-filter: var(--_workspace-glass-blur);
      }
      /* The icons are colored here: Pret UI's neutral button sets its own
         ink on the button, so a value inherited from the chip wouldn't
         reach them. A favorited or hovered star takes the primary color. */
      .control-icon {
        color: var(--boxel-light);
      }
      .favorite-btn.is-favorited .control-icon,
      .workspace .favorite-btn:hover .control-icon {
        color: var(--primary);
      }

      /* Who can see the workspace, as a tinted chip so Private, Shared and
         Public read apart at a glance. */
      .visibility-chip {
        --_workspace-chip-color: var(--boxel-light-60);
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        height: var(--_workspace-chip-height);
        padding: 0 var(--boxel-sp-xs) 0 var(--boxel-sp-4xs);
        border: 1px solid
          color-mix(in oklch, var(--_workspace-chip-color) 30%, transparent);
        border-radius: var(--boxel-border-radius);
        background-color: color-mix(
          in oklch,
          var(--_workspace-chip-color) 12%,
          transparent
        );
        color: var(--_workspace-chip-color);
        font: 600 var(--boxel-font-xs);
        text-transform: capitalize;
        white-space: nowrap;
      }
      .visibility-chip.is-shared {
        --_workspace-chip-color: var(--boxel-cyan);
      }
      .visibility-chip.is-public {
        --_workspace-chip-color: var(--boxel-highlight);
      }

      /* Desk. */
      .workspace.is-desk {
        --_workspace-control-size: 2.125rem;
        --_workspace-control-inset: var(--boxel-sp-sm);
        --_workspace-glass: color-mix(
          in oklch,
          var(--boxel-800) 60%,
          transparent
        );
        --_workspace-glass-blur: blur(0.5rem);
        --_workspace-control-radius: var(--boxel-border-radius);
        gap: var(--boxel-sp-xs);
      }
      .workspace.is-desk :is(.favorite-btn, .menu-btn) {
        opacity: 1;
        background-color: var(--_workspace-glass);
        backdrop-filter: var(--_workspace-glass-blur);
      }
      .desk-surface {
        position: relative;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        height: var(--_workspace-desk-height);
        padding: var(--_workspace-control-inset);
        overflow: hidden;
        border-radius: var(--_workspace-desk-radius);
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
      /* The ring shows under the keyboard cursor and on any keyboard focus,
         as when a modal hands focus back. */
      .workspace.is-desk.is-selected .desk-surface,
      .workspace.is-desk:has(.desk-pill:focus-visible) .desk-surface {
        box-shadow:
          var(--dashboard-ring),
          0 0.625rem 1.5rem var(--boxel-dark-10);
      }
      /* The bare wallpaper opens the workspace for a pointer; the keyboard
         has the name pill, so this stays out of the tab order. */
      .desk-hit {
        position: absolute;
        inset: 0;
        cursor: pointer;
      }
      .desk-top {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-height: var(--_workspace-control-size);
        /* Room for the star and the menu, which sit over the surface. */
        padding-inline: calc(
          var(--_workspace-control-size) + var(--boxel-sp-4xs)
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
        height: var(--_workspace-control-size);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-sm) var(--boxel-sp-5xs)
          var(--boxel-sp-5xs);
        border: 0;
        border-radius: var(--boxel-border-radius-lg);
        background-color: var(--_workspace-glass);
        backdrop-filter: var(--_workspace-glass-blur);
        color: var(--boxel-light);
        font: 600 var(--boxel-font);
        pointer-events: auto;
      }
      .desk-pill:hover {
        background-color: color-mix(
          in oklch,
          var(--boxel-800) 78%,
          transparent
        );
      }
      /* The surface draws the ring; the transparent outline stands in for
         it in forced-colors mode, which drops box-shadows. */
      .desk-pill:focus-visible {
        outline: 2px solid transparent;
      }
      .desk-pill-icon {
        --boxel-realm-icon-size: 1.625rem;
        --boxel-realm-icon-border-radius: var(--boxel-border-radius-sm);
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
        --hosted-pill-background: var(--_workspace-glass);
        margin-left: auto;
        backdrop-filter: var(--_workspace-glass-blur);
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
        min-height: var(--_workspace-chip-height);
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
      /* Counts arrive late and change on re-index; fixed-width digits keep
         the caption from shifting. */
      .desk-stat-number {
        color: var(--foreground);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
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
      /* Positioned, so its screen-reader text is clipped with it instead of
         widening the page. The address truncates; the arrow always shows. */
      .desk-host-link {
        position: relative;
        display: inline-flex;
        gap: var(--boxel-sp-5xs);
        min-width: 0;
        overflow: hidden;
        color: inherit;
        font-weight: 600;
        text-underline-offset: 0.1875rem;
      }
      .desk-host-url {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* As tall as a line of the caption, where a Button would be taller. */
      .desk-host-more {
        --pretui-button-h: 1lh;
        flex: none;
        box-sizing: border-box;
        height: 1lh;
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
      .workspace.is-tile.is-selected::after,
      .workspace.is-tile:has(.tile-face:focus-visible)::after {
        border-color: var(--boxel-highlight);
        box-shadow: 0 0 0 1px var(--boxel-highlight);
      }
      .host-menu {
        position: absolute;
        top: calc(var(--dashboard-tile-height) - var(--_workspace-chin-height));
        left: 0;
        z-index: 3;
        display: flex;
        width: 100%;
        height: var(--_workspace-chin-height);
      }
      /* The open menu's panel is stacked with the chin, so the chin rises
         above the tile's frame, which would otherwise draw across it. */
      .workspace.is-open .host-menu {
        z-index: 5;
      }
      /* Pret UI's Menu has no knob to stretch its trigger's box. */
      .host-menu-wrap,
      .host-menu :deep(.pretui-menu-trigger) {
        width: 100%;
        height: 100%;
      }
      .host-trigger {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        width: 100%;
        height: 100%;
        padding: 0 var(--boxel-sp-xs) 0 var(--boxel-sp-sm);
        overflow: hidden;
        border: none;
        border-radius: 0 0 var(--dashboard-tile-radius)
          var(--dashboard-tile-radius);
        background-color: var(--boxel-dark-40);
        backdrop-filter: var(--_workspace-glass-blur);
        color: var(--boxel-light);
      }
      .host-trigger:hover {
        background-color: var(--boxel-dark-50);
      }
      .host-trigger:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: -2px;
      }
      /* Lime is Hosted's color in every variant. */
      .host-trigger-globe {
        flex-shrink: 0;
        color: var(--boxel-lime);
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
      .info {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        min-width: 0;
      }
      /* One line under every tile, so tiles keep one height and their chips
         line up across the row. */
      .name {
        display: block;
        width: 100%;
        overflow: hidden;
        font: 400 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Row: a thumbnail, the name, who can see it and when it changed. */
      .workspace.is-row {
        --_workspace-control-inset: 0.375rem;
        --_workspace-control-step: calc(
          var(--_workspace-control-size) + var(--boxel-sp-4xs)
        );
        --_workspace-controls: 2;
        --_workspace-icon-size: 1.5rem;
        --_workspace-time-max-width: 6rem;
        box-sizing: border-box;
        flex-direction: row;
        align-items: center;
        gap: var(--boxel-sp-sm);
        height: var(--dashboard-row-height);
        /* The end clears the controls: the star and the menu, and on a
           hosted row the globe. */
        padding: var(--boxel-sp-xs)
          calc(
            var(--_workspace-control-inset) + var(--_workspace-controls) *
              var(--_workspace-control-step)
          )
          var(--boxel-sp-xs) var(--boxel-sp-xs);
        border-radius: var(--dashboard-tile-radius);
        background-color: var(--dashboard-row-tint);
        box-shadow: inset 0 0 0 1px var(--boxel-light-10);
        transition: background-color var(--boxel-transition);
      }
      .workspace.is-row:has(.host-menu) {
        --_workspace-controls: 3;
      }
      .workspace.is-row:hover {
        background-color: var(--_workspace-row-tint-hover);
      }
      /* Over the list's scrim, so a row the cursor rests on is never hidden
         under it; the Show more toggle, later in the page at the same level,
         stays on top. */
      .workspace.is-row.is-selected,
      .workspace.is-row:has(.row-open:focus-visible) {
        z-index: 3;
        box-shadow: inset 0 0 0 2px var(--boxel-highlight);
      }
      /* With its site menu open, the workspace sits above its neighbors and
         the selected row, so the menu isn't drawn under them. */
      .workspace.is-open {
        z-index: 5;
      }
      /* A long list of wallpapers is noise at scan distance: the row shows
         the realm's mark, and its wallpaper only while hovered. */
      .row-thumb {
        flex: none;
        width: calc(var(--dashboard-row-height) - 2 * var(--boxel-sp-xs));
        height: 100%;
        border-radius: var(--boxel-border-radius-lg);
        background-color: var(--dashboard-thumb-tint);
      }
      .row-thumb::before {
        opacity: 0;
      }
      .workspace.is-row:hover .row-thumb::before {
        opacity: 1;
      }
      .row-icon-tooltip {
        position: relative;
        z-index: 2;
        cursor: pointer;
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
      /* A button ignores line-clamp, so the name truncates on one line. Its
         hit area covers the row; the controls sit above it. */
      .row-open {
        padding: 0;
        border: 0;
        background-color: transparent;
        color: var(--boxel-light);
      }
      .row-open::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 1;
        border-radius: inherit;
      }
      /* The row draws the ring; the transparent outline stands in for it in
         forced-colors mode, which drops box-shadows. */
      .row-open:focus-visible {
        outline: 2px solid transparent;
      }
      /* Under the row's hit area, so a click on it opens the workspace. */
      .updated {
        position: absolute;
        right: var(--boxel-sp-sm);
        bottom: var(--boxel-sp-xs);
        max-width: var(--_workspace-time-max-width);
        overflow: hidden;
        color: var(--muted-foreground);
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
          var(--_workspace-control-inset) + var(--_workspace-control-step)
        );
      }
      .is-row .host-menu {
        top: var(--_workspace-control-inset);
        left: auto;
        right: calc(
          var(--_workspace-control-inset) + 2 * var(--_workspace-control-step)
        );
        width: var(--_workspace-control-size);
        height: var(--_workspace-control-size);
        opacity: 0;
        transition: opacity var(--boxel-transition);
      }
      .is-row .host-trigger {
        justify-content: center;
        padding: 0;
        border-radius: 50%;
      }
      .workspace.is-row:hover .host-menu,
      .workspace.is-row.is-open .host-menu,
      .workspace.is-row.is-selected .host-menu,
      .is-row .host-menu:has(:focus-visible) {
        opacity: 1;
      }
      .is-row :is(.host-trigger-url, .host-trigger-more) {
        display: none;
      }

      /* Above an open site menu's chin, which sits over the face too. The
         menu's panel opens below the face, out of the alert's way. */
      .reindex-error {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 6;
        box-sizing: border-box;
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-5xs);
        width: 100%;
        max-height: 100%;
        padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
        border-radius: var(--dashboard-tile-radius) var(--dashboard-tile-radius)
          0 0;
        background-color: var(--boxel-error-100);
        color: var(--boxel-light);
        font: 600 var(--boxel-font-xs);
      }
      /* Within the face, not over the name or caption beneath it. */
      .is-tile .reindex-error {
        max-height: var(--dashboard-tile-height);
      }
      .is-desk .reindex-error {
        max-height: var(--_workspace-desk-height);
      }
      /* The whole error shows; a long one scrolls inside the tile, under a
         dismiss button that stays put. Stretched, it takes the alert's
         clamped height. */
      .reindex-error-message {
        flex: 1;
        align-self: stretch;
        min-width: 0;
        overflow-y: auto;
        overflow-wrap: break-word;
      }
      .reindex-error-message:focus-visible {
        outline: 2px solid var(--ring);
      }
      .reindex-error-dismiss {
        flex-shrink: 0;
      }

      .menu-footer {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-top: 1px solid var(--border);
      }
      .menu-footer-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-6xs);
      }
      .menu-footer-label,
      .menu-footer-value {
        color: var(--muted-foreground);
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
  // The workspace shows a spinner until it finishes; both steps answer at once
  // for a realm already logged in and loaded.
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

  private get visibilityDescriptionId() {
    return `${guidFor(this)}-visibility`;
  }

  private get updatedDescriptionId() {
    return `${guidFor(this)}-updated`;
  }

  private get showsUpdatedTime() {
    return this.args.variant === 'row' && !!this.updatedAtLabel;
  }

  // What the workspace's button says after its name. The chip and the row's
  // time show short forms, so each carries its full label for this.
  private get descriptionIds() {
    let ids = [this.visibilityDescriptionId];
    if (this.showsUpdatedTime) {
      ids.push(this.updatedDescriptionId);
    }
    ids.push(this.realmURLDescriptionId);
    return ids.join(' ');
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
      resolveRRIReference('./realm', rri(this.args.realmIdentifier)),
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
    return urlDisplayText(this.primaryPublishedURL);
  }

  private get extraPublishedCount() {
    return Math.max(this.publishedRealmURLs.length - 1, 0);
  }

  // Starts with the visible "+N", so the name contains what's on screen.
  private get extraPublishedLabel() {
    return `+${this.extraPublishedCount} more hosted ${pluralize('site', this.extraPublishedCount)}`;
  }

  private get hostTriggerLabel() {
    return `Hosted at ${this.displayPublishedURL}`;
  }

  private get hostMenuItems(): MenuEntry[] {
    return this.siteMenuItems(this.publishedRealmURLs);
  }

  // A desk links its primary site beside the "+N", so its menu holds the
  // other sites alone, as many as the "+N" says.
  private get extraHostMenuItems(): MenuEntry[] {
    return this.siteMenuItems(this.publishedRealmURLs.slice(1));
  }

  private siteMenuItems(urls: string[]): MenuEntry[] {
    return [
      {
        kind: 'section',
        label: 'Launch in new window',
        items: urls.map((url) => ({
          label: urlDisplayText(url),
          onSelect: () => this.openPublishedRealm(url),
        })),
      },
    ];
  }

  @action private setHostDropdownOpen(open: boolean) {
    this.isHostDropdownOpen = open;
  }

  @action private openPublishedRealm(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  private get backgroundImageURL() {
    return wallpaperImage(this.realmInfo.backgroundURL);
  }

  private get visibility() {
    return this.realmInfo.visibility;
  }

  private get visibilityIcon() {
    switch (this.visibility) {
      case 'public':
        return Globe;
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

  private get spokenUpdatedAtLabel() {
    let { updatedAt } = this.realmInfo;
    return updatedAt
      ? formatUpdatedTime(new Date(updatedAt), { spoken: true })
      : undefined;
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
  // dashboard; removing it then clears the stacks. A stack's base card counts
  // as well as its top one: a stack based on the workspace's index card makes
  // it the current realm, and once it has left the available realms the
  // current realm no longer says so.
  private isOnScreen(realmIdentifier: RealmIdentifier) {
    let realmPath = new RealmPaths(
      realmIdentifier,
      this.network.virtualNetwork,
    );
    let { codePath, stacks } = this.operatorModeStateService.state;
    return (
      this.operatorModeStateService.realmURL ===
        this.network.virtualNetwork.toURL(realmIdentifier).href ||
      stacks.some((stack) =>
        [stack[0], stack[stack.length - 1]].some((item) =>
          item?.id ? realmPath.inRealm(rri(item.id)) : false,
        ),
      ) ||
      this.operatorModeStateService
        .getOpenCardIds()
        .some((cardId) => realmPath.inRealm(cardId)) ||
      Boolean(codePath && realmPath.inRealm(codePath))
    );
  }

  private async leaveRemovedWorkspace(wasActive: boolean) {
    if (wasActive) {
      this.operatorModeStateService.clearStacks();
      await this.operatorModeStateService.updateCodePath(null);
      this.operatorModeStateService.openWorkspaceChooser();
    }
  }

  // Plain async methods, not part of the tasks: archiving or deleting drops
  // this workspace from the list before it returns, and the teardown that
  // follows can cancel the task, which would skip everything after it. With
  // the row gone the dashboard is usable again, so whether the workspace is
  // still on screen is checked once the removal returns.
  private async archiveAndLeave() {
    let { realmIdentifier } = this.args;
    await this.realmServer.archiveRealm(realmIdentifier);
    // Archiving seals the realm; its session goes so background requests
    // don't loop on 403. Restoring creates a new one.
    this.realm.removeRealm(realmIdentifier);
    await this.leaveRemovedWorkspace(this.isOnScreen(realmIdentifier));
  }

  private archiveWorkspaceTask = dropTask(async () => {
    this.archiveError = undefined;
    try {
      await this.archiveAndLeave();
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

  private async deleteAndLeave() {
    let { realmIdentifier } = this.args;
    let { publishedRealmURLs } = this;
    await this.realmServer.deleteRealm(realmIdentifier);
    await this.matrixService.removeRealmFromAccountData(realmIdentifier);
    this.recentFilesService.removeRecentFilesForRealmURL(realmIdentifier);
    for (let publishedRealmURL of publishedRealmURLs) {
      this.recentFilesService.removeRecentFilesForRealmURL(publishedRealmURL);
    }
    this.realm.removeRealm(realmIdentifier);
    await this.leaveRemovedWorkspace(this.isOnScreen(realmIdentifier));
  }

  private deleteWorkspaceTask = dropTask(async () => {
    this.deleteError = undefined;
    try {
      await this.deleteAndLeave();
      this.showDeleteModal = false;
    } catch (error: any) {
      this.deleteError = error.message;
    }
  });
}
