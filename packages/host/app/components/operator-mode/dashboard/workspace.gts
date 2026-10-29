import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import DotsHorizontal from '@cardstack/boxel-icons/dots';
import Globe from '@cardstack/boxel-icons/globe';
import Lock from '@cardstack/boxel-icons/lock';
import Group from '@cardstack/boxel-icons/users';
import IconX from '@cardstack/boxel-icons/x';
import { IconButton } from '@cardstack/pretui/components/icon-button';
import { Menu as PretMenu } from '@cardstack/pretui/components/menu';
import { Spinner } from '@cardstack/pretui/components/spinner';

import perform from 'ember-concurrency/helpers/perform';
import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';

import { BoxelDropdown, Menu, RealmIcon } from '@cardstack/boxel-ui/components';
import { cn, cssVar, eq, gt, or } from '@cardstack/boxel-ui/helpers';
import { Star, StarFilled } from '@cardstack/boxel-ui/icons';

import type { RealmIdentifier } from '@cardstack/runtime-common';

import RealmURLTooltip from '@cardstack/host/components/realm-url-tooltip';
import { WorkspaceActions } from '@cardstack/host/lib/workspace-actions';
import focusWhenSelected from '@cardstack/host/modifiers/focus-when-selected';
import type RealmService from '@cardstack/host/services/realm';

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

// A row's trailing time drops the "Updated" its position already says.
const UPDATED_PREFIX = /^Updated /;

export default class Workspace extends Component<Signature> {
  <template>
    {{#if this.workspace.loadRealmTask.isRunning}}
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
        style={{cssVar
          workspace-background-image-url=this.workspace.backgroundImageURL
        }}
        data-workspace-tile
        {{this.workspace.captureTile}}
        data-test-workspace={{this.workspace.name}}
        data-test-workspace-variant={{@variant}}
        data-test-workspace-selected={{if @isSelected this.workspace.name}}
        data-test-workspace-ring={{if
          this.showSelectionRing
          this.workspace.name
        }}
        ...attributes
      >
        {{#if this.workspace.reindexError}}
          <div class='reindex-error' role='alert' data-test-reindex-error>
            <span
              class='reindex-error-message'
              title={{this.workspace.reindexError}}
            >{{this.workspace.reindexError}}</span>
            <IconButton
              class='reindex-error-dismiss'
              @label='Dismiss error'
              @appearance='plain'
              @size='s'
              {{on 'click' this.workspace.clearReindexError}}
              data-test-reindex-error-dismiss
            >
              <IconX class='control-icon' width='14' height='14' />
            </IconButton>
          </div>
        {{/if}}
        {{! The URL describes the workspace rather than naming it, so it sits
            outside the button: text inside a button joins its accessible
            name. }}
        <span
          id={{this.realmURLDescriptionId}}
          class='boxel-sr-only'
        >{{this.workspace.realmURLText}}</span>

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
              {{on 'click' this.workspace.openWorkspace}}
            ></div>
            <div class='desk-top'>
              <RealmURLTooltip
                class='desk-pill-tooltip'
                @realmURL={{@realmIdentifier}}
                @label={{this.workspace.name}}
              >
                <button
                  type='button'
                  class='desk-pill'
                  aria-describedby={{this.realmURLDescriptionId}}
                  data-nav-index={{@navIndex}}
                  {{on 'click' this.workspace.openWorkspace}}
                  {{focusWhenSelected
                    @isSelected
                    scrollOnOpen='when-off-screen'
                  }}
                  data-test-workspace-button={{this.workspace.name}}
                >
                  {{! The name beside it labels the button. }}
                  <RealmIcon
                    class='desk-pill-icon'
                    @realmInfo={{this.workspace.realmInfo}}
                    aria-hidden='true'
                  />
                  <span
                    class='desk-pill-name'
                    data-test-workspace-name
                  >{{this.workspace.name}}</span>
                </button>
              </RealmURLTooltip>
              {{#if this.workspace.hasPublishedRealms}}
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
              <span
                class={{cn
                  'visibility-chip'
                  (concat 'is-' this.workspace.visibility)
                }}
                title={{this.workspace.visibilityLabel}}
                data-test-workspace-visibility
              >
                <this.visibilityIcon
                  width='12'
                  height='12'
                  aria-hidden='true'
                />
                {{this.workspace.visibility}}
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
            {{#if this.workspace.hasPublishedRealms}}
              <div class='desk-host-line'>
                <span class='desk-host-dot' aria-hidden='true'></span>
                <span>Hosted at</span>
                {{! A link in running text, so a native one rather than a Pret
                    UI Button, which is for standalone actions. }}
                <a
                  class='desk-host-link'
                  href={{this.workspace.primaryPublishedURL}}
                  target='_blank'
                  rel='noopener noreferrer'
                  title={{this.workspace.primaryPublishedURL}}
                  data-test-desk-host-link={{@realmIdentifier}}
                ><span
                    class='desk-host-url'
                  >{{this.workspace.displayPublishedURL}}</span>
                  <span aria-hidden='true'>↗</span><span class='boxel-sr-only'>
                    (opens in a new tab)</span></a>
                {{#if (gt this.workspace.publishedRealmURLs.length 1)}}
                  <span
                    class='desk-host-more'
                    title={{this.extraPublishedTitle}}
                  >+{{this.extraPublishedCount}}<span class='boxel-sr-only'>
                      more:
                      {{this.extraPublishedTitle}}</span></span>
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
              {{on 'click' this.workspace.openWorkspace}}
            >
              <span class='realm-icon-wrapper'>
                <RealmIcon
                  class='workspace-realm-icon'
                  @realmInfo={{this.workspace.realmInfo}}
                />
              </span>
            </RealmURLTooltip>
          </span>
        {{else}}
          <ItemContainer
            class='tile-face'
            aria-describedby={{this.realmURLDescriptionId}}
            data-nav-index={{@navIndex}}
            {{on 'click' this.workspace.openWorkspace}}
            {{focusWhenSelected @isSelected scrollOnOpen='when-off-screen'}}
            data-test-workspace-button={{this.workspace.name}}
          >
            <span class='wallpaper'>
              <RealmURLTooltip @realmURL={{@realmIdentifier}}>
                <span class='realm-icon-wrapper'>
                  <RealmIcon
                    class='workspace-realm-icon'
                    @realmInfo={{this.workspace.realmInfo}}
                    @canAnimate={{true}}
                  />
                </span>
              </RealmURLTooltip>
            </span>
          </ItemContainer>
        {{/if}}

        <div
          class={{cn 'favorite-btn' is-favorited=this.workspace.isFavorited}}
        >
          {{! The star's fill already shows the state, so it takes no
              pressed tint, which would show as a gray square on the chip.
              Its tip opens to the right, into the tile: centered above the
              corner, it would run past the tile into a narrow gutter. }}
          <IconButton
            @label='Favorite'
            @appearance='plain'
            @pressed={{this.workspace.isFavorited}}
            @pressedTint={{false}}
            @tooltip={{if
              this.workspace.isFavorited
              'Remove from Favorites'
              'Add to Favorites'
            }}
            @tooltipSide='right'
            {{on 'click' this.workspace.toggleFavorite}}
            data-test-workspace-favorite-btn={{@realmIdentifier}}
          >
            {{#if this.workspace.isFavorited}}
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
                {{this.workspace.captureMenuTrigger}}
                data-test-workspace-menu-trigger={{@realmIdentifier}}
              >
                <DotsHorizontal class='control-icon' width='16' height='16' />
              </IconButton>
            </:trigger>
            <:content as |dd|>
              <Menu
                @items={{this.workspace.menuItems}}
                @closeMenu={{dd.close}}
              />
              {{#if
                (or this.workspace.updatedAtLabel this.workspace.createdAtLabel)
              }}
                <div
                  class='menu-footer'
                  data-test-workspace-menu-footer={{@realmIdentifier}}
                >
                  {{#if this.workspace.updatedAtLabel}}
                    <span
                      class='menu-footer-value'
                    >{{this.workspace.updatedAtLabel}}</span>
                  {{/if}}
                  {{#if this.workspace.createdAtLabel}}
                    <span class='menu-footer-row'>
                      <span class='menu-footer-label'>Created</span>
                      <span
                        class='menu-footer-value'
                      >{{this.workspace.createdAtLabel}}</span>
                    </span>
                  {{/if}}
                </div>
              {{/if}}
            </:content>
          </BoxelDropdown>
        </div>

        {{#unless (eq @variant 'desk')}}
          {{#if this.workspace.hasPublishedRealms}}
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
                    >{{this.workspace.displayPublishedURL}}</span>
                    {{#if (gt this.workspace.publishedRealmURLs.length 1)}}
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
                aria-describedby={{this.realmURLDescriptionId}}
                data-nav-index={{@navIndex}}
                {{on 'click' this.workspace.openWorkspace}}
                {{focusWhenSelected @isSelected scrollOnOpen='when-off-screen'}}
                data-test-workspace-button={{this.workspace.name}}
                data-test-workspace-name
              >{{this.workspace.name}}</button>
            {{else}}
              <span
                class='name'
                data-test-workspace-name
              >{{this.workspace.name}}</span>
            {{/if}}
            {{! On a row the chip sits above its hit area so its title shows; a
                click on it still opens the workspace. }}
            <span
              {{! template-lint-disable no-invalid-interactive }}
              class={{cn
                'visibility-chip'
                (concat 'is-' this.workspace.visibility)
              }}
              title={{this.workspace.visibilityLabel}}
              {{on 'click' this.openFromRow}}
              data-test-workspace-visibility
            >
              <this.visibilityIcon width='12' height='12' aria-hidden='true' />
              {{this.workspace.visibility}}
            </span>
            {{#if (eq @variant 'row')}}
              {{#if this.workspace.updatedAtLabel}}
                <span
                  class='updated'
                  data-test-workspace-updated
                >{{this.updatedAgoLabel}}</span>
              {{/if}}
            {{/if}}
          </div>
        {{/unless}}
      </div>
      {{! Sent out of the workspace so a size container around it can't trap
          these fixed-position modals. }}
      {{#if this.workspace.showDeleteModal}}
        <ToElsewhere
          @named='modal-elsewhere'
          @send={{component
            DeleteWorkspaceModal
            realmIdentifier=@realmIdentifier
            realmInfo=this.workspace.realmInfo
            name=this.workspace.name
            realmURLText=this.workspace.realmURLText
            isLoadingSummary=this.workspace.loadDeleteSummaryTask.isRunning
            summaryText=this.workspace.deleteSummaryText
            publishedRealmURLs=this.workspace.publishedRealmURLs
            error=this.workspace.deleteError
            isDeleting=this.workspace.deleteWorkspaceTask.isRunning
            onConfirm=(perform this.workspace.deleteWorkspaceTask)
            onClose=this.workspace.closeDeleteModal
            returnFocusTarget=this.workspace.returnFocusTarget
          }}
        />
      {{/if}}
      {{#if this.workspace.showArchiveModal}}
        <ToElsewhere
          @named='modal-elsewhere'
          @send={{component
            ArchiveWorkspaceModal
            realmIdentifier=@realmIdentifier
            realmInfo=this.workspace.realmInfo
            name=this.workspace.name
            realmURLText=this.workspace.realmURLText
            error=this.workspace.archiveError
            isArchiving=this.workspace.archiveWorkspaceTask.isRunning
            onConfirm=(perform this.workspace.archiveWorkspaceTask)
            onClose=this.workspace.closeArchiveModal
            returnFocusTarget=this.workspace.returnFocusTarget
          }}
        />
      {{/if}}
      {{#if this.workspace.showDuplicateModal}}
        <ToElsewhere
          @named='modal-elsewhere'
          @send={{component
            DuplicateWorkspaceModal
            realmIdentifier=@realmIdentifier
            realmInfo=this.workspace.realmInfo
            name=this.workspace.name
            error=this.workspace.duplicateError
            isDuplicating=this.workspace.duplicateWorkspaceTask.isRunning
            progressLabel=this.workspace.duplicateProgressLabel
            onConfirm=(perform this.workspace.duplicateWorkspaceTask)
            onClose=this.workspace.closeDuplicateModal
            returnFocusTarget=this.workspace.returnFocusTarget
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
      .desk-host-more {
        position: relative;
        flex: none;
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
      /* Above the row's hit area, so its title shows. */
      .is-row .visibility-chip {
        position: relative;
        z-index: 2;
        cursor: pointer;
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
        background-color: var(--boxel-error-100);
        color: var(--boxel-light);
        font: 600 var(--boxel-font-xs);
      }
      .reindex-error-message {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        overflow-wrap: break-word;
        /* A long server error is capped at a few lines; the title has it
           whole. */
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        line-clamp: 3;
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

  @service declare private realm: RealmService;

  @tracked private isHostDropdownOpen = false;

  private workspace = new WorkspaceActions(
    this,
    () => this.args.realmIdentifier,
  );

  private get realmURLDescriptionId() {
    return `${guidFor(this)}-realm-url`;
  }

  private get showSelectionRing() {
    return Boolean(this.args.isSelected && this.args.selectionActive);
  }

  private get extraPublishedCount() {
    return Math.max(this.workspace.publishedRealmURLs.length - 1, 0);
  }

  private get extraPublishedTitle() {
    return this.workspace.publishedRealmURLs.slice(1).join('\n');
  }

  private get hostTriggerLabel() {
    return `Hosted at ${this.workspace.displayPublishedURL}`;
  }

  private get hostMenuItems(): MenuEntry[] {
    return [
      {
        kind: 'section',
        label: 'Launch in new window',
        items: this.workspace.publishedRealmURLs.map((url) => ({
          label: url,
          onSelect: () => this.workspace.openPublishedRealm(url),
        })),
      },
    ];
  }

  @action private setHostDropdownOpen(open: boolean) {
    this.isHostDropdownOpen = open;
  }

  private get visibilityIcon() {
    switch (this.workspace.visibility) {
      case 'public':
        return Globe;
      case 'shared':
        return Group;
      default:
        return Lock;
    }
  }

  private get updatedAgoLabel() {
    return this.workspace.updatedAtLabel?.replace(UPDATED_PREFIX, '');
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

  // A tile opens from its face alone; a row opens from anywhere on it.
  @action private async openFromRow() {
    if (this.args.variant === 'row') {
      await this.workspace.openWorkspace();
    }
  }
}
