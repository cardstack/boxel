import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Globe from '@cardstack/boxel-icons/globe';
import Refresh from '@cardstack/boxel-icons/refresh';
import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';

import { restartableTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import {
  BoxelButton,
  LoadingIndicator,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { PublishSiteIcon } from '@cardstack/boxel-ui/icons';

import OpenSitePopover from '@cardstack/host/components/operator-mode/host-submode/open-site-popover';
import PublishingRealmPopover from '@cardstack/host/components/operator-mode/host-submode/publishing-realm-popover';
import PublishRealmModal from '@cardstack/host/components/operator-mode/publish-realm-modal';

import type HomePageResolverService from '@cardstack/host/services/home-page-resolver';
import HostModeService from '@cardstack/host/services/host-mode-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type StoreService from '@cardstack/host/services/store';

import type { ViewCardFn } from 'https://cardstack.com/base/card-api';

import HostModeContent from '../host-mode/content';

import SubmodeLayout from './submode-layout';

import type { PublishError } from './publish-realm-modal';

interface HostSubmodeSignature {
  Element: HTMLElement;
  Args: {};
}

export default class HostSubmode extends Component<HostSubmodeSignature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare store: StoreService;
  @service private declare realm: RealmService;
  @service private declare hostModeService: HostModeService;
  @service private declare homePageResolver: HomePageResolverService;

  @tracked isPublishRealmModalOpen = false;
  @tracked isPublishingRealmPopoverOpen = false;
  @tracked isOpenSitePopoverOpen = false;

  constructor(owner: Owner, args: HostSubmodeSignature['Args']) {
    super(owner, args);
    this.ensureHomePageCardTask.perform();
  }

  @action
  openPublishRealmModal() {
    this.isPublishRealmModalOpen = true;
  }

  @action
  closePublishRealmModal() {
    this.isPublishRealmModalOpen = false;
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

  get isPublishing() {
    return this.realm.isPublishing(this.realmURL);
  }

  get hasPublishedSites() {
    return this.hostModeService.publishedRealmURLs.length > 0;
  }

  get publishedRealmURLs() {
    return this.hostModeService.publishedRealmURLs;
  }

  get defaultPublishedRealmURL(): string | undefined {
    return this.hostModeService.defaultPublishedRealmURL;
  }

  handlePublishTask = restartableTask(async (publishedRealmURLs: string[]) => {
    const results = await this.realm.publish(this.realmURL, publishedRealmURLs);

    const errors = new Map<string, string>();
    if (results) {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const url = publishedRealmURLs[index];
          const error = result as PromiseRejectedResult;
          const errorMessage =
            error.reason?.message || 'Failed to publish to this domain';
          errors.set(url, errorMessage);
        }
      });
    }

    if (errors.size > 0) {
      const error = new Error(
        'Failed to publish to some domains',
      ) as PublishError;
      error.urlErrors = errors;
      throw error;
    }

    this.isPublishingRealmPopoverOpen = false;
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
    await this.realm.unpublish(this.realmURL, publishedRealmURL);
  });

  // Ensure host mode shows the resolved home page card when the operator switches
  // realms so the primary card state always matches the realm's configured entry point.
  private ensureHomePageCardTask = restartableTask(async () => {
    let realmURL = this.operatorModeStateService.realmURL.href;
    let homePage = await this.homePageResolver.resolve(realmURL);
    let homePageCardId = homePage?.cardId;
    if (homePageCardId) {
      // Prefer the resolved home page card whenever host mode is empty or still
      // pointing at the realm index so operators always land on the realm's
      // configured entry card instead of a stale default.
      let currentPrimary =
        this.operatorModeStateService.hostModePrimaryCard ?? undefined;
      let normalizedRealm = realmURL.endsWith('/') ? realmURL : `${realmURL}/`;
      let isRealmIndex = homePageCardId === `${normalizedRealm}index`;
      let shouldUseHome =
        !currentPrimary ||
        (!isRealmIndex && currentPrimary === `${normalizedRealm}index`);
      if (shouldUseHome && currentPrimary !== homePageCardId) {
        this.operatorModeStateService.setHostModePrimaryCard(homePageCardId);
      }
    }
  });

  get defaultPublishedSiteURL(): string | undefined {
    return this.hostModeService.defaultPublishedSiteURL;
  }

  @action
  handleOpenSiteButtonClick(event: MouseEvent) {
    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.isOpenSitePopoverOpen = !this.isOpenSitePopoverOpen;
      return;
    }

    // If there's no default URL, prevent navigation and show popover
    if (!this.defaultPublishedRealmURL) {
      event.preventDefault();
      event.stopPropagation();
      this.isOpenSitePopoverOpen = true;
      return;
    }

    // Otherwise, let the anchor navigate naturally
    this.isOpenSitePopoverOpen = false;
  }

  private viewCard: ViewCardFn = (cardOrURL) => {
    let cardId = cardOrURL instanceof URL ? cardOrURL.href : cardOrURL.id;
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

  <template>
    <SubmodeLayout class='host-submode-layout' data-test-host-submode>
      <:topBar>
        <div class='publish-realm-button-container'>
          {{#if this.isPublishing}}
            <BoxelButton
              @kind='primary'
              @size='tall'
              class='publish-realm-button publishing'
              {{on 'click' this.togglePublishingRealmPopover}}
              data-test-publish-realm-button
            >
              <Refresh width='22' height='22' class='publish-icon' />
              Publishing…
            </BoxelButton>
          {{else}}
            <BoxelButton
              @kind='primary'
              @size='tall'
              class='publish-realm-button'
              {{on 'click' this.openPublishRealmModal}}
              data-test-publish-realm-button
            >
              <PublishSiteIcon width='22' height='22' class='publish-icon' />
              Publish Site
            </BoxelButton>
          {{/if}}
          <PublishingRealmPopover
            @isOpen={{this.isPublishingRealmPopoverOpen}}
          />
        </div>
        {{#if this.hasPublishedSites}}

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
                  @href={{this.defaultPublishedSiteURL}}
                  class='open-site-button'
                  target='_blank'
                  rel='noopener noreferrer'
                  {{on 'click' this.handleOpenSiteButtonClick}}
                  data-test-open-site-button
                >
                  <Globe width='22' height='22' class='globe-icon' />
                  Open Site
                </BoxelButton>
              </:trigger>
              <:content>
                Open Site in a New Tab (Shift+Click for options)
              </:content>
            </Tooltip>
            <OpenSitePopover @isOpen={{this.isOpenSitePopoverOpen}} />
          </div>
        {{/if}}

      </:topBar>
      <:default as |layout|>
        {{#if this.ensureHomePageCardTask.isRunning}}
          <div class='host-submode-loading' data-test-host-submode-loading>
            <LoadingIndicator @color='var(--boxel-teal)' />
            <div class='loading-text'>Loading…</div>
          </div>
        {{else}}
          <HostModeContent
            @primaryCardId={{this.operatorModeStateService.hostModePrimaryCard}}
            @stackItemCardIds={{this.operatorModeStateService.hostModeStack}}
            @removeCardFromStack={{this.removeCardFromStack}}
            @openInteractSubmode={{fn layout.updateSubmode 'interact'}}
            @viewCard={{this.viewCard}}
            class='host-submode-content'
          />
        {{/if}}
      </:default>
    </SubmodeLayout>

    <PublishRealmModal
      @isOpen={{this.isPublishRealmModalOpen}}
      @onClose={{this.closePublishRealmModal}}
      @handlePublish={{this.handlePublish}}
      @publishError={{this.handlePublishError}}
      @handleUnpublish={{perform this.handleUnpublish}}
    />

    <style scoped>
      .host-submode-loading {
        background-color: #686283;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100vh;
        gap: var(--boxel-sp-xs);
      }

      .loading-text {
        color: #fff;
        font-size: 12px;
        font-weight: 600;
      }

      .host-submode-layout {
        --host-submode-background: var(--boxel-700);
        --submode-bar-item-border-radius: var(--boxel-border-radius);
        --submode-bar-item-box-shadow: var(--boxel-deep-box-shadow);
        --submode-bar-item-outline: var(--boxel-border-flexible);
        --operator-mode-left-column: calc(
          21.5rem - var(--submode-new-file-button-width)
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
        + :deep(.profile-icon-button) {
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
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
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
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
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
