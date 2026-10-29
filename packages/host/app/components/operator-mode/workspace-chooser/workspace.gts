import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Home from '@cardstack/boxel-icons/home';
import perform from 'ember-concurrency/helpers/perform';
import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';

import {
  BoxelDropdown,
  ContextButton,
  Menu,
  RealmIcon,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { cssVar, gt, or } from '@cardstack/boxel-ui/helpers';
import {
  Group,
  IconGlobe,
  IconX,
  Lock,
  Star,
  StarFilled,
} from '@cardstack/boxel-ui/icons';

import type { RealmIdentifier } from '@cardstack/runtime-common';

import RealmURLTooltip from '@cardstack/host/components/realm-url-tooltip';
import { WorkspaceActions } from '@cardstack/host/lib/workspace-actions';
import focusWhenSelected from '@cardstack/host/modifiers/focus-when-selected';
import type RealmService from '@cardstack/host/services/realm';

import ItemContainer from './item-container';
import WorkspaceLoadingIndicator from './workspace-loading-indicator';
import {
  ArchiveWorkspaceModal,
  DeleteWorkspaceModal,
  DuplicateWorkspaceModal,
} from './workspace-modals';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    realmIdentifier: RealmIdentifier;
    showMenu?: boolean;
    isSelected?: boolean;
    // Whether the user has actively engaged the keyboard selection (moved it
    // off its default). The tile is still `isSelected` on open — it holds focus
    // so arrow keys and Enter work — but its selection ring stays hidden until
    // this is true, so opening the chooser doesn't look like a tile is already
    // picked (which reads as a second selection alongside a favorited tile).
    selectionActive?: boolean;
    isFavoritesSection?: boolean;
    enlargedWidth?: string;
    navIndex?: number;
  };
}

export default class Workspace extends Component<Signature> {
  <template>
    {{#if this.workspace.loadRealmTask.isRunning}}
      <WorkspaceLoadingIndicator />
    {{else}}
      <div
        class='workspace-card
          {{if this.isHostDropdownOpen "is-open"}}
          {{if this.showSelectionRing "is-selected"}}
          {{if @isFavoritesSection "is-enlarged"}}'
        style={{cssVar favorite-tile-width=@enlargedWidth}}
        data-theme='dark'
        {{on 'mouseleave' this.closeHostDropdown}}
        {{this.workspace.captureTile}}
        data-workspace-tile
        data-test-workspace={{this.workspace.name}}
        data-test-workspace-selected={{if @isSelected this.workspace.name}}
        ...attributes
      >
        {{#if this.workspace.reindexError}}
          <div class='reindex-error' role='alert' data-test-reindex-error>
            <span
              class='reindex-error__message'
              title={{this.workspace.reindexError}}
            >{{this.workspace.reindexError}}</span>
            <button
              type='button'
              class='reindex-error__dismiss'
              aria-label='Dismiss error'
              data-test-reindex-error-dismiss
              {{on 'click' this.workspace.clearReindexError}}
            >
              <IconX width='11' height='11' />
            </button>
          </div>
        {{/if}}
        {{! The URL describes the tile rather than naming it, so it sits
            outside the button: text inside a button joins its accessible
            name, and the tile's name is the workspace's. }}
        <span
          id={{this.realmURLDescriptionId}}
          class='boxel-sr-only'
        >{{this.workspace.realmURLText}}</span>
        <ItemContainer
          aria-describedby={{this.realmURLDescriptionId}}
          data-test-workspace-button={{this.workspace.name}}
          data-nav-index={{@navIndex}}
          {{on 'click' this.workspace.openWorkspace}}
          {{focusWhenSelected @isSelected}}
        >
          <div
            class='tile-icon'
            style={{cssVar
              workspace-background-image-url=this.workspace.backgroundImageURL
            }}
          >
            {{#if @isFavoritesSection}}
              <div class='tile-scrim'></div>
              <div class='tile-content'>
                <RealmURLTooltip @realmURL={{@realmIdentifier}}>
                  <div class='realm-icon-wrapper'>
                    <RealmIcon
                      class='workspace-realm-icon'
                      @realmInfo={{this.workspace.realmInfo}}
                      @canAnimate={{true}}
                    />
                  </div>
                </RealmURLTooltip>
                <div class='tile-text'>
                  <span
                    class='tile-name'
                    data-test-workspace-name
                  >{{this.workspace.name}}</span>
                  {{! Always rendered so the counts, which load after the tile,
                      fill reserved space instead of growing it. }}
                  <div
                    class='tile-metadata-row'
                    data-test-workspace-stats={{@realmIdentifier}}
                  >
                    {{#each this.tileStats as |stat|}}
                      <Tooltip @placement='top'>
                        <:trigger>
                          <span
                            class='tile-stat'
                            data-test-workspace-stat={{stat.label}}
                          >
                            <span class='tile-stat-label'>{{stat.label}}</span>
                            <span class='tile-stat-number'>{{stat.count}}</span>
                          </span>
                        </:trigger>
                        <:content>{{stat.label}} {{stat.count}}</:content>
                      </Tooltip>
                    {{/each}}
                  </div>
                </div>
              </div>
            {{else}}
              <RealmURLTooltip @realmURL={{@realmIdentifier}}>
                <div class='realm-icon-wrapper'>
                  <RealmIcon
                    class='workspace-realm-icon'
                    @realmInfo={{this.workspace.realmInfo}}
                    @canAnimate={{true}}
                  />
                </div>
              </RealmURLTooltip>
            {{/if}}
          </div>
        </ItemContainer>
        <div
          class='tile-favorite-btn
            {{if this.workspace.isFavorited "is-favorited"}}'
        >
          <Tooltip @placement='top'>
            <:trigger>
              <ContextButton
                @label='Favorite'
                @icon={{if this.workspace.isFavorited StarFilled Star}}
                @variant='ghost'
                @width='16'
                @height='16'
                aria-pressed={{if this.workspace.isFavorited 'true' 'false'}}
                {{on 'click' this.workspace.toggleFavorite}}
                data-test-workspace-favorite-btn={{@realmIdentifier}}
              />
            </:trigger>
            <:content>{{this.favoriteLabel}}</:content>
          </Tooltip>
        </div>
        {{#if @isFavoritesSection}}
          <div
            class='tile-status-bar'
            data-test-workspace-status-bar={{@realmIdentifier}}
          >
            {{#if this.workspace.hasPublishedRealms}}
              <Tooltip @placement='top'>
                <:trigger>
                  <span class='tile-status-icon'>
                    <Home width='12' height='12' />
                  </span>
                </:trigger>
                <:content>Hosted on the web</:content>
              </Tooltip>
            {{/if}}
            <Tooltip @placement='top'>
              <:trigger>
                <span class='tile-status-visibility'>
                  <this.visibilityIcon width='12' height='12' />
                  <span
                    class='tile-status-label'
                  >{{this.workspace.visibility}}</span>
                </span>
              </:trigger>
              <:content>{{this.workspace.visibilityLabel}}</:content>
            </Tooltip>
          </div>
        {{/if}}
        <div class='tile-menu-btn'>
          <BoxelDropdown @contentClass='workspace-menu-dropdown'>
            <:trigger as |bindings|>
              <ContextButton
                @label='Options'
                @variant='ghost'
                @width='16'
                @height='16'
                {{bindings}}
                {{this.workspace.captureMenuTrigger}}
                data-test-workspace-menu-trigger={{@realmIdentifier}}
              />
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
                  class='workspace-menu-footer'
                  data-test-workspace-menu-footer={{@realmIdentifier}}
                >
                  {{#if this.workspace.updatedAtLabel}}
                    <span
                      class='workspace-menu-footer__value'
                    >{{this.workspace.updatedAtLabel}}</span>
                  {{/if}}
                  {{#if this.workspace.createdAtLabel}}
                    <span class='workspace-menu-footer__row'>
                      <span class='workspace-menu-footer__label'>Created</span>
                      <span
                        class='workspace-menu-footer__value'
                      >{{this.workspace.createdAtLabel}}</span>
                    </span>
                  {{/if}}
                </div>
              {{/if}}
            </:content>
          </BoxelDropdown>
        </div>
        {{#if this.workspace.hasPublishedRealms}}
          <button
            class='host-trigger'
            type='button'
            data-test-host-trigger={{@realmIdentifier}}
            {{on 'click' this.toggleHostDropdown}}
          >
            <span class='trigger-house'><Home width='13' height='13' /></span>
            <span
              class='trigger-url'
            >{{this.workspace.displayPublishedURL}}</span>
            {{#if (gt this.workspace.publishedRealmURLs.length 1)}}
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
                {{#each this.workspace.publishedRealmURLs as |url|}}
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

        {{#unless @isFavoritesSection}}
          <div class='info {{if this.isHostDropdownOpen "info--hidden"}}'>
            <span
              class='name'
              data-test-workspace-name
            >{{this.workspace.name}}</span>
            <span class='visibility' data-test-workspace-visibility>
              {{#if this.workspace.hasPublishedRealms}}
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
                  {{this.workspace.visibilityLabel}}
                </:content>
              </Tooltip>
              <span
                class='visibility-label'
              >{{this.workspace.visibility}}</span>
            </span>
          </div>
        {{/unless}}
      </div>
      {{! Sent out of the tile so a size container around the tiles can't
        trap these fixed-position modals. }}
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
      .workspace-card {
        display: flex;
        flex-direction: column;
        width: var(--workspace-chooser-card-width);
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
        width: var(--workspace-chooser-tile-width);
        height: 10.375rem;
        box-sizing: border-box;
        border-radius: var(--boxel-border-radius-xl);
        border: 1px solid rgba(255 255 255 / 25%);
        pointer-events: none;
        z-index: 20;
      }
      .workspace-card.is-enlarged :deep(.workspace) {
        width: var(
          --favorite-tile-width,
          var(--workspace-chooser-enlarged-tile-width)
        );
        min-width: var(
          --favorite-tile-width,
          var(--workspace-chooser-enlarged-tile-width)
        );
      }
      .workspace-card.is-enlarged::after {
        width: var(
          --favorite-tile-width,
          var(--workspace-chooser-enlarged-tile-width)
        );
      }
      .workspace-card:hover::after {
        border-color: rgba(255 255 255 / 50%);
      }
      /* The keyboard-navigation selection ring. Declared after the :hover
         rule so a selected tile keeps its ring while the pointer is over
         it. */
      .workspace-card.is-selected::after {
        border-color: var(--boxel-highlight);
        box-shadow: 0 0 0 1px var(--boxel-highlight);
      }
      .tile-favorite-btn {
        position: absolute;
        top: 0.5rem;
        left: 0.5rem;
        z-index: 3;
        width: var(--boxel-button-xs);
        height: var(--boxel-button-xs);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        color: var(--boxel-light);
        --icon-color: var(--boxel-light);
        opacity: 0;
        border-radius: var(--boxel-border-radius-sm);
        transition:
          opacity 0.15s ease,
          background 0.15s ease;
      }
      /* Reveal the tile's controls when the card is hovered or has keyboard
         focus anywhere within it, so a keyboard user tabbing onto the card
         sees the star the same way a pointer user does on hover — not only
         when the star itself is the focused tab stop. */
      .workspace-card:hover .tile-favorite-btn,
      .workspace-card:has(:focus-visible) .tile-favorite-btn {
        opacity: 1;
        background: var(--boxel-dark-40);
        backdrop-filter: blur(6px);
      }
      .workspace-card:hover .tile-favorite-btn:hover {
        background: var(--boxel-highlight);
        color: var(--boxel-dark);
        --icon-color: var(--boxel-dark);
      }
      .tile-favorite-btn.is-favorited {
        color: var(--boxel-highlight);
        --icon-color: var(--boxel-highlight);
        opacity: 1;
        background: var(--boxel-dark-40);
        backdrop-filter: blur(6px);
      }
      /* Draw the focus ring on the wrapper, whose overflow hidden would
         otherwise clip the inner button's own outline. */
      .tile-favorite-btn:has(:focus-visible) {
        outline: var(--boxel-outline);
        outline-offset: -1px;
      }
      /* Tooltip wraps its trigger in a `width: fit-content` div. Stretch that
         wrapper (and the button inside it) to fill the star's box so the whole
         box stays the hover target, rather than only the glyph. */
      .tile-favorite-btn > :deep(.trigger),
      .tile-favorite-btn :deep(button) {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
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
        opacity: 0;
        transition:
          opacity 0.15s ease,
          background 0.15s ease;
        --boxel-icon-button-width: var(--boxel-button-xs);
        --boxel-icon-button-height: var(--boxel-button-xs);
      }
      .workspace-card:hover .tile-menu-btn,
      .workspace-card:has(:focus-visible) .tile-menu-btn {
        opacity: 1;
        background: var(--boxel-dark-40);
        backdrop-filter: blur(6px);
      }
      .workspace-card:hover .tile-menu-btn:hover {
        background: var(--boxel-highlight);
        color: var(--boxel-dark);
        --icon-color: var(--boxel-dark);
      }
      /* Keyboard focus also needs the standard focus ring every other control
         gets. The inner trigger button's own outline is clipped by this
         wrapper's overflow hidden, so draw the ring on the wrapper instead:
         an element's own outline is not clipped by its own overflow. */
      .tile-menu-btn:has(:focus-visible) {
        outline: var(--boxel-outline);
        outline-offset: -1px;
      }
      .tile-menu-btn:has([aria-expanded='true']) {
        opacity: 1;
        background: var(--boxel-highlight);
        color: var(--boxel-highlight-foreground);
      }
      /* Outranks the hover and keyboard-focus reveal rules above. */
      .workspace-card:hover .tile-menu-btn:has([aria-expanded='true']),
      .workspace-card:has(:focus-visible)
        .tile-menu-btn:has([aria-expanded='true']) {
        background: var(--boxel-highlight);
        color: var(--boxel-highlight-foreground);
      }
      /* Hosted + visibility indicators for the enlarged favorite tile,
         combined into a single pill to the right of the favorite star,
         matching its height. Persistently visible (not hover-gated) since
         it's informational, same as the favorited star. */
      .tile-status-bar {
        position: absolute;
        top: 0.5rem;
        left: calc(0.5rem + var(--boxel-button-xs) + var(--boxel-sp-3xs));
        z-index: 3;
        /* The bar overlays the tile's own open-workspace button. Let clicks on
           its inert areas fall through to that button (rather than dying on
           this strip); the tooltip triggers below re-enable pointer events for
           themselves so hovering the icons still surfaces their tooltips. */
        pointer-events: none;
        box-sizing: border-box;
        height: var(--boxel-button-xs);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-3xs);
        padding: 0 var(--boxel-sp-2xs);
        border-radius: var(--boxel-border-radius-sm);
        background: var(--boxel-dark-40);
        backdrop-filter: blur(6px);
        color: var(--boxel-light);
      }
      .tile-status-icon {
        display: flex;
        align-items: center;
        color: var(--boxel-highlight);
        /* Re-enable pointer events so this icon's tooltip still opens on hover
           (see `.tile-status-bar { pointer-events: none }`). */
        pointer-events: auto;
      }
      .tile-status-visibility {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-6xs);
        --icon-color: var(--boxel-light);
        /* Re-enable pointer events for this tooltip trigger (see above). */
        pointer-events: auto;
      }
      .tile-status-label {
        font-size: var(--boxel-font-size-2xs);
        text-transform: capitalize;
        letter-spacing: var(--boxel-lsp);
        margin-left: 3px;
      }
      .tile-icon {
        position: relative;
        height: 100%;
        width: 100%;
        overflow: hidden;

        display: flex;
        justify-content: center;
        align-items: center;
      }
      /* The background image lives on its own layer (rather than directly
         on .tile-icon) so it can be scaled on hover without also zooming
         the icon/name/metadata content stacked on top of it. */
      .tile-icon::before {
        content: '';
        position: absolute;
        inset: 0;
        background-color: var(--boxel-500);
        background-image: var(--workspace-background-image-url);
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        transition: transform 0.4s ease-out;
        z-index: 0;
      }
      .workspace-card.is-enlarged:hover .tile-icon::before {
        transform: scale(1.15);
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
        max-width: var(--workspace-chooser-tile-width);
      }
      .reindex-error {
        position: absolute;
        top: 0;
        left: 0;
        width: var(--workspace-chooser-tile-width);
        box-sizing: border-box;
        z-index: 21;
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-xl)
          var(--boxel-border-radius-xl) 0 0;
        background-color: var(--boxel-danger);
        color: var(--boxel-light);
        font: 600 var(--boxel-font-xs);
      }
      .reindex-error__message {
        flex: 1;
        overflow-wrap: anywhere;
        /* Cap a long server error at a few lines so the banner never grows to
        cover the whole tile; the full text stays available via the title. */
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        overflow: hidden;
      }
      .reindex-error__dismiss {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0;
        padding: 2px;
        border: none;
        background: transparent;
        color: inherit;
        --icon-color: currentColor;
        cursor: pointer;
        border-radius: var(--boxel-border-radius-xs);
      }
      .reindex-error__dismiss:hover {
        background: rgba(255 255 255 / 25%);
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
        color: var(--boxel-highlight);
        display: flex;
        align-items: center;
        margin-right: var(--boxel-sp-6xs);
      }
      /* Sits between the tile's background image and its text/icon
         content, darkening the image so the name and metadata stay
         readable regardless of the underlying artwork. */
      .tile-scrim {
        position: absolute;
        inset: 0;
        background: rgba(0 0 0 / 50%);
        z-index: 1;
        pointer-events: none;
      }
      /* The icon + name + metadata group, vertically centered as a unit
         within the tile. padding-top reserves the zone occupied by the
         favorite star and status bar (see .tile-favorite-btn/.tile-status-bar
         above) so the centered group never sits under them; padding-bottom
         stays 0 so centering is computed against the space below that zone,
         not the full tile height. Nudged up 10px from that centered
         position per design feedback. Stays visible even when the
         host-trigger bar is hovered/open (see .host-trigger below) — only
         the .info block used to need to fade for that, and this group
         replaced it. */
      .tile-content {
        position: absolute;
        inset: 0;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: calc(0.5rem + var(--boxel-button-xs) + var(--boxel-sp-3xs))
          var(--boxel-sp) 0;
        transform: translateY(-10px);
        z-index: 2;
      }
      .tile-text {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        min-width: 0;
        flex: 1;
      }
      .tile-name {
        font: 400 var(--boxel-font-md);
        color: var(--boxel-light);
        text-align: left;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        overflow-wrap: anywhere;
      }
      /* Height is fixed rather than derived from content: the counts are
         fetched after the tile renders (favorites only), so a row that grew
         when they landed would shift the tile's centered name. 1lh at the
         stats' own font-size matches a populated row exactly. On a tile too
         narrow for every stat, the ones that don't fit wrap onto a second
         line that's clipped, so a stat is dropped whole, never cut off. */
      .tile-metadata-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        column-gap: var(--boxel-sp-sm);
        height: 1lh;
        overflow: hidden;
        font-size: 0.75rem;
      }
      .tile-stat {
        display: flex;
        white-space: nowrap;
        align-items: baseline;
        gap: 0.25rem;
        font-size: 0.75rem;
        color: var(--boxel-light);
        letter-spacing: var(--boxel-lsp);
        --icon-color: var(--boxel-450);
      }
      .tile-stat-label {
        font-weight: 400;
      }
      .tile-stat-number {
        font-weight: 600;
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
        width: var(--workspace-chooser-tile-width);
        height: 2.25rem;
        background: var(--boxel-dark-40);
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
      .workspace-card.is-enlarged .host-trigger {
        width: var(
          --favorite-tile-width,
          var(--workspace-chooser-enlarged-tile-width)
        );
      }
      .trigger-house {
        color: var(--boxel-highlight);
        display: flex;
        align-items: center;
        flex-shrink: 0;
      }
      .trigger-url {
        font-size: var(--boxel-font-size-2xs);
        color: var(--boxel-light);
        font-weight: 400;
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
        right: 0;
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
      :global(.workspace-menu-dropdown) {
        --boxel-dropdown-border-color: rgba(0 0 0 / 50%);
      }
      .workspace-menu-footer {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
      .workspace-menu-footer::before {
        content: '';
        position: absolute;
        top: 0;
        left: 10px;
        right: 10px;
        height: 1px;
        background: var(--boxel-light-25);
        opacity: 0.75;
      }
      /* The last menu item normally rounds its bottom corners to match the
         panel when hovered, since it's usually flush with the panel's
         bottom edge. This dropdown has the Updated/Created footer below
         it instead, so that rounding now reads as a mismatched cutout —
         square it off here. */
      :deep(.boxel-menu__item:last-child:hover) {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
      }
      :deep([data-menu-item-id='realm-settings'] svg) {
        width: 17px;
        height: 17px;
      }
      .workspace-menu-footer__row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-6xs);
      }
      .workspace-menu-footer__label,
      .workspace-menu-footer__value {
        font-size: var(--boxel-font-size-2xs);
        color: var(--boxel-450);
      }
    </style>
  </template>

  @service declare private realm: RealmService;

  @tracked private isHostDropdownOpen = false;

  private workspace = new WorkspaceActions(
    this,
    () => this.args.realmIdentifier,
  );

  // Serves as both the button's accessible label and its tooltip text, so the
  // two can't drift apart.
  private get favoriteLabel() {
    return this.workspace.isFavorited
      ? 'Remove from Favorites'
      : 'Add to Favorites';
  }

  private get realmURLDescriptionId() {
    return `${guidFor(this)}-realm-url`;
  }

  // The selection ring is shown only once the user has actively engaged the
  // keyboard selection. On open the tile is selected (holds focus for keyboard
  // nav) but unringed, so the chooser doesn't present a pre-picked tile.
  private get showSelectionRing() {
    return Boolean(this.args.isSelected && this.args.selectionActive);
  }

  @action toggleHostDropdown(event: Event) {
    event.stopPropagation();
    if (!this.workspace.hasPublishedRealms) return;
    this.isHostDropdownOpen = !this.isHostDropdownOpen;
  }

  @action openPublishedRealm(url: string, event: MouseEvent) {
    event.stopPropagation();
    this.workspace.openPublishedRealm(url);
    this.isHostDropdownOpen = false;
  }

  @action closeHostDropdown() {
    this.isHostDropdownOpen = false;
  }

  private get visibilityIcon() {
    switch (this.workspace.visibility) {
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

  // Compact metadata for the enlarged favorite tile's in-tile content (see
  // .tile-metadata-row below). Label and count stay separate fields so the
  // template can emphasize the count with larger type than its unit label.
  // A stat with no count is dropped rather than rendered as "0" — that's
  // what gives each favorite tile its own mix of metadata instead of always
  // showing all three.
  //
  // Counts arrive on their own schedule: the chooser requests them for
  // favorited realms only, after first render (see `trackFavoriteCounts` in
  // ../workspace-chooser/index.gts). Empty until then, which is why the row
  // reserves its height rather than being conditionally rendered.
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
}
