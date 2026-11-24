import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Globe from '@cardstack/boxel-icons/globe';
import Refresh from '@cardstack/boxel-icons/refresh';
import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';

import { restartableTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import focusTrap from 'ember-focus-trap/modifiers/focus-trap';
import { modifier } from 'ember-modifier';

import { BoxelButton, Tooltip } from '@cardstack/boxel-ui/components';
import { PublishSiteIcon } from '@cardstack/boxel-ui/icons';

import { ensureTrailingSlash } from '@cardstack/runtime-common';

import OpenSitePopover from '@cardstack/host/components/operator-mode/host-submode/open-site-popover';
import PublishingRealmPopover from '@cardstack/host/components/operator-mode/host-submode/publishing-realm-popover';
import HostURLManager from '@cardstack/host/components/operator-mode/host-url-manager';
import PublishRealmModal from '@cardstack/host/components/operator-mode/publish-realm-modal';
import ENV from '@cardstack/host/config/environment';
import {
  ifConnected,
  modalFocusTrapOptions,
} from '@cardstack/host/lib/modal-focus-trap';
import { loadHostURLs } from '@cardstack/host/resources/host-urls';

import type HostModeService from '@cardstack/host/services/host-mode-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type StoreService from '@cardstack/host/services/store';
import type ToolService from '@cardstack/host/services/tool-service';
import PublishRealmTool from '@cardstack/host/tools/publish-realm';
import UnpublishRealmTool from '@cardstack/host/tools/unpublish-realm';

import { idFromCardOrURL } from '@cardstack/host/utils/id-from-card-or-url';
import type { SearchResultKind } from '@cardstack/host/utils/search/types';

import HostModeContent from '../host-mode/content';

import SubmodeLayout from './submode-layout';

import type { PublishError } from './publish-realm-modal';
import type { ViewCardFn } from '@cardstack/base/card-api';

interface HostSubmodeSignature {
  Element: HTMLElement;
  Args: {};
}

export default class HostSubmode extends Component<HostSubmodeSignature> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private store: StoreService;
  @service declare private realm: RealmService;
  @service declare private hostModeService: HostModeService;
  @service declare private toolService: ToolService;

  @tracked isPublishingRealmPopoverOpen = false;
  @tracked isOpenSitePopoverOpen = false;

  @action
  openPublishRealmModal() {
    // A popover left open during a publish started elsewhere doesn't come
    // back with this one.
    this.isPublishingRealmPopoverOpen = false;
    this.hostModeService.publishDialogRealm = ensureTrailingSlash(
      this.realmURL,
    );
  }

  @action
  closePublishRealmModal() {
    this.hostModeService.publishDialogRealm = undefined;
  }

  get isPublishRealmModalOpen() {
    return (
      this.hostModeService.publishDialogRealm ===
      ensureTrailingSlash(this.realmURL)
    );
  }

  // Leaving host mode closes the dialog, so it doesn't come back open later.
  willDestroy() {
    super.willDestroy();
    this.hostModeService.publishDialogRealm = undefined;
  }

  private publishDialogId = guidFor(this);

  private get publishDialogRealms() {
    return [this.realmURL];
  }

  // The visible title asks "Where to?"; the name says what is published.
  // With Host Mode v2 nothing is published: the dialog lists the realm's
  // host URLs.
  private get publishDialogLabel() {
    let name = this.realmName;
    return this.isHostModeV2 ? `Host URLs for ${name}` : `Publish ${name}`;
  }

  private get realmName() {
    return this.realm.info(this.realmURL).name;
  }

  // The publish button, which becomes a "Publishing…" button while a publish
  // runs, so focus goes back to whichever is on screen when the dialog closes.
  private publishButton: HTMLElement | undefined;
  private capturePublishButton = modifier((element: HTMLElement) => {
    this.publishButton = element;
  });

  private get publishFocusTrapOptions() {
    return modalFocusTrapOptions(this.publishDialogId, {
      onClose: this.closePublishRealmModal,
      returnFocusTarget: () => ifConnected(this.publishButton),
    });
  }

  @action
  togglePublishingRealmPopover() {
    this.isPublishingRealmPopoverOpen = !this.isPublishingRealmPopoverOpen;
  }

  @action
  closeOpenSitePopover() {
    this.isOpenSitePopoverOpen = false;
  }

  get realmURL() {
    return this.hostModeService.realmURL;
  }

  // Host Mode v2: the dialog manages the realm's host URLs. A host URL serves
  // the realm live, so there is no publish to wait for.
  get isHostModeV2() {
    return Boolean(ENV.featureFlags?.hostModeV2);
  }

  get isPublishing() {
    return !this.isHostModeV2 && this.realm.isPublishing(this.realmURL);
  }

  // The unpublish command reports a failure in its result rather than
  // throwing, so the failure is thrown here for the host URL manager to show.
  removeV1Site = async (publishedRealmURL: string) => {
    let result = await this.handleUnpublish.perform(publishedRealmURL);
    if (result?.status === 'error') {
      throw new Error(result.error || `Could not remove ${publishedRealmURL}`);
    }
  };

  // Shown on request while a publish runs, and gone with the publish,
  // whether it succeeds or fails.
  get showsPublishingRealmPopover() {
    return this.isPublishingRealmPopoverOpen && this.isPublishing;
  }

  get hasPublishedSites() {
    return this.hostModeService.publishedRealmURLs.length > 0;
  }

  get publishedRealmURLs() {
    return this.hostModeService.publishedRealmURLs;
  }

  // With Host Mode v2, the realm's host URLs, which the Open Site button
  // opens. With the flag off, nothing reads them.
  private hostURLs = loadHostURLs(this, getOwner(this)!, () =>
    this.isHostModeV2 ? this.realmURL : undefined,
  );

  // The button shows when there is a site to open: a host URL, or a site
  // published with v1.
  get showsOpenSiteButton() {
    return this.hostURLs.hostURLs.length > 0 || this.hasPublishedSites;
  }

  // With no card open, Host mode falls back to a default realm, such as the
  // user's personal workspace. The host URL manager would then act on a
  // realm the user isn't looking at, so it waits for a card.
  get needsCardForHostURLs() {
    return (
      this.isHostModeV2 && !this.operatorModeStateService.hostModePrimaryCard
    );
  }

  get publishButtonLabel() {
    // With Host Mode v2 the realm is mounted at host URLs, not published, so
    // the button names the dialog it opens.
    if (this.isHostModeV2) {
      return 'Host URLs';
    }
    return this.hasPublishedSites ? 'Republish Site' : 'Publish Site';
  }

  handlePublishTask = restartableTask(async (publishedRealmURLs: string[]) => {
    try {
      // Publish through the same command exposed to boxel-cli so the UI and
      // headless callers share one path. The modal already enforces the
      // publishability gate, so force past the command's redundant re-check.
      let command = new PublishRealmTool(this.toolService.toolContext);
      let result = await command.execute({
        realmURL: this.realmURL,
        publishedRealmURLs,
        force: true,
      });

      const errors = new Map<string, string>();
      for (let target of result.results) {
        if (
          target.status === 'error' ||
          target.status === 'published-pending'
        ) {
          errors.set(
            target.publishedRealmURL,
            target.error || 'Failed to publish to this domain',
          );
        }
      }

      if (errors.size > 0) {
        const error = new Error(
          'Failed to publish to some domains',
        ) as PublishError;
        error.urlErrors = errors;
        throw error;
      }
    } finally {
      // The popover goes with the publish it was opened for, whether it
      // succeeds or fails.
      this.isPublishingRealmPopoverOpen = false;
    }
  });

  @action
  handlePublish(publishedRealmURLs: string[]) {
    let promise = this.handlePublishTask.perform(publishedRealmURLs);
    // Catch the error so it doesn't bubble
    // to the browser (so error reporters like Bugsnag will see it).
    // TODO: remove this after this issue (https://github.com/machty/ember-concurrency/issues/40)
    // is resolved.
    promise.catch((_error) => {});
  }

  get handlePublishError(): PublishError | null {
    return this.handlePublishTask.last?.error as PublishError | null;
  }

  handleUnpublish = restartableTask(async (publishedRealmURL: string) => {
    // Unpublish through the same command exposed to boxel-cli so the UI and
    // headless callers share one path.
    let command = new UnpublishRealmTool(this.toolService.toolContext);
    return await command.execute({
      realmURL: this.realmURL,
      publishedRealmURL,
    });
  });

  // The canonical host URL with Host Mode v2, else the last site published
  // with v1, at the card on screen.
  get defaultSiteURL(): string | undefined {
    return this.hostModeService.defaultSiteURL;
  }

  @action
  handleOpenSiteButtonClick(event: Event) {
    let mouseEvent = event as MouseEvent;
    if (mouseEvent.shiftKey) {
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      this.isOpenSitePopoverOpen = !this.isOpenSitePopoverOpen;
      return;
    }

    // If there's no default URL, prevent navigation and show popover
    if (!this.defaultSiteURL) {
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      this.isOpenSitePopoverOpen = true;
      return;
    }

    // Otherwise, let the anchor navigate naturally
    this.isOpenSitePopoverOpen = false;
  }

  private viewCard: ViewCardFn = (cardOrURL) => {
    let cardId = idFromCardOrURL(cardOrURL);
    if (!cardId) {
      return;
    }

    this.operatorModeStateService.addToHostModeStack(
      cardId.replace(/\.json$/, ''),
    );
  };

  private removeCardFromStack = (cardId: string) => {
    this.operatorModeStateService.removeFromHostModeStack(cardId);
  };

  // Host submode has no search of its own; the dashboard opened over it does.
  // A result opens in interact submode, as the dashboard's other cards do.
  private get onCardSelectFromSearch() {
    return this.operatorModeStateService.workspaceChooserOpened
      ? this.openSearchResultInInteract
      : undefined;
  }

  private openSearchResultInInteract = (
    cardId: string,
    kind?: SearchResultKind,
  ) => {
    this.operatorModeStateService.openCardInInteractMode(
      cardId,
      'isolated',
      kind,
    );
    this.operatorModeStateService.closeWorkspaceChooser();
  };

  <template>
    <SubmodeLayout
      class='host-submode-layout'
      @onCardSelectFromSearch={{this.onCardSelectFromSearch}}
      data-test-host-submode
    >
      <:topBar>
        <div class='publish-realm-button-container'>
          {{#if this.isPublishing}}
            <BoxelButton
              @kind='primary'
              @size='tall'
              class='publish-realm-button publishing'
              {{on 'click' this.togglePublishingRealmPopover}}
              {{this.capturePublishButton}}
              data-test-publish-realm-button
            >
              <Refresh width='22' height='22' class='publish-icon' />
              <span class='top-bar-button-label'>Publishing…</span>
            </BoxelButton>
          {{else if this.needsCardForHostURLs}}
            <Tooltip class='host-urls-tooltip'>
              <:trigger>
                <BoxelButton
                  @kind='primary'
                  @size='tall'
                  @disabled={{true}}
                  class='publish-realm-button'
                  data-test-publish-realm-button
                >
                  <PublishSiteIcon
                    width='22'
                    height='22'
                    class='publish-icon'
                  />
                  <span
                    class='top-bar-button-label'
                  >{{this.publishButtonLabel}}</span>
                </BoxelButton>
              </:trigger>
              <:content>
                <span data-test-host-urls-needs-card>
                  Open a card to manage the host URLs of its realm.
                </span>
              </:content>
            </Tooltip>
          {{else}}
            <BoxelButton
              @kind='primary'
              @size='tall'
              class='publish-realm-button'
              {{on 'click' this.openPublishRealmModal}}
              {{this.capturePublishButton}}
              data-test-publish-realm-button
            >
              <PublishSiteIcon width='22' height='22' class='publish-icon' />
              <span
                class='top-bar-button-label'
              >{{this.publishButtonLabel}}</span>
            </BoxelButton>
          {{/if}}
          {{#unless this.isHostModeV2}}
            <PublishingRealmPopover
              @isOpen={{this.showsPublishingRealmPopover}}
            />
          {{/unless}}
        </div>
        {{#if this.showsOpenSiteButton}}
          <div
            class='open-site-button-container'
            {{onClickOutside
              this.closeOpenSitePopover
              exceptSelector='.open-site-button'
            }}
          >
            <Tooltip class='open-site-tooltip'>
              <:trigger>
                <BoxelButton
                  @as='anchor'
                  @kind='secondary'
                  @size='tall'
                  @href={{this.defaultSiteURL}}
                  class='open-site-button'
                  target='_blank'
                  rel='noopener noreferrer'
                  {{on 'click' this.handleOpenSiteButtonClick}}
                  data-test-open-site-button
                >
                  <Globe width='22' height='22' class='globe-icon' />
                  <span class='top-bar-button-label'>Open Site</span>
                </BoxelButton>
              </:trigger>
              <:content>
                Open Site in a New Tab (Shift+Click for options)
              </:content>
            </Tooltip>
            <OpenSitePopover
              @isOpen={{this.isOpenSitePopoverOpen}}
              @hostURLs={{this.hostModeService.openSiteHostURLs}}
            />
          </div>
        {{/if}}

      </:topBar>
      <:default as |layout|>
        <HostModeContent
          @primaryCardId={{this.operatorModeStateService.hostModePrimaryCard}}
          @stackItemCardIds={{this.operatorModeStateService.hostModeStack}}
          @removeCardFromStack={{this.removeCardFromStack}}
          @openInteractSubmode={{fn layout.updateSubmode 'interact'}}
          @viewCard={{this.viewCard}}
          class='host-submode-content'
        />
      </:default>
    </SubmodeLayout>

    {{! Keyed by the realm, so another workspace gets a new dialog: it loads
        a workspace's unlisted link and domains when it's made. }}
    {{#each this.publishDialogRealms key='@identity' as |realmURL|}}
      {{#if this.isHostModeV2}}
        <HostURLManager
          @isOpen={{this.isPublishRealmModalOpen}}
          @onClose={{this.closePublishRealmModal}}
          @realmURL={{realmURL}}
          @realmName={{this.realmName}}
          @v1SiteURLs={{this.publishedRealmURLs}}
          @removeV1Site={{this.removeV1Site}}
          aria-label={{this.publishDialogLabel}}
          id={{this.publishDialogId}}
          tabindex='-1'
          {{focusTrap focusTrapOptions=this.publishFocusTrapOptions}}
        />
      {{else}}
        <PublishRealmModal
          @isOpen={{this.isPublishRealmModalOpen}}
          @onClose={{this.closePublishRealmModal}}
          @handlePublish={{this.handlePublish}}
          @publishError={{this.handlePublishError}}
          @handleUnpublish={{perform this.handleUnpublish}}
          aria-label={{this.publishDialogLabel}}
          id={{this.publishDialogId}}
          tabindex='-1'
          {{focusTrap focusTrapOptions=this.publishFocusTrapOptions}}
        />
      {{/if}}
    {{/each}}

    <style scoped>
      .host-submode-layout {
        --host-submode-background: var(--boxel-700);
        --submode-bar-item-border-radius: var(--boxel-border-radius);
        --submode-bar-item-box-shadow: var(--boxel-deep-box-shadow);
        --submode-bar-item-outline: var(--boxel-border-flexible);
        --operator-mode-left-column: calc(
          21.5rem - var(--new-file-button-width)
        );
        background-color: var(--host-submode-background);
      }

      .host-submode {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background-position: center;
        background-size: cover;
      }

      .host-submode-layout
        .open-site-button-container
        + :deep(.profile-icon-badge) {
        margin-left: 0;
      }

      .host-mode-top-bar-content {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        padding-left: calc(
          var(--operator-mode-left-column) + var(--submode-switcher-width) +
            var(--operator-mode-spacing)
        );
      }

      .host-submode-content {
        flex: 1;
      }

      .publish-realm-button-container {
        position: relative;
      }

      .publish-realm-button {
        --boxel-button-padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
        border: none;
        border-radius: var(--submode-bar-item-border-radius);
        box-shadow: var(--submode-bar-item-box-shadow);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }

      .publish-realm-button:focus:not(:disabled) {
        outline-offset: 1px;
      }

      .publish-icon {
        flex-shrink: 0;
      }

      .open-site-button-container {
        position: relative;
        margin-left: auto;
      }

      .open-site-button {
        --boxel-button-padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
        --boxel-button-color: transparent;
        --boxel-button-border: 1px solid var(--boxel-700);
        --boxel-button-text-color: var(--boxel-light);
        border-radius: var(--submode-bar-item-border-radius);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }

      .open-site-button:hover:not(:disabled) {
        --boxel-button-border: 1px solid var(--boxel-light);
      }

      .globe-icon {
        flex-shrink: 0;
        color: var(--boxel-teal);
      }

      .top-bar-button-label {
        white-space: nowrap;
      }

      /* Too narrow for labeled buttons: show icons only, keeping the label
         as the accessible name. */
      @container (width < 40rem) {
        .publish-realm-button,
        .open-site-button {
          --boxel-button-padding: 0;
          --boxel-button-min-width: var(--container-button-size);
          justify-content: center;
        }
        .top-bar-button-label {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
        }
      }

      .publish-realm-button.publishing {
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
        100% {
          opacity: 1;
        }
      }
    </style>
  </template>
}
