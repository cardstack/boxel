import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Globe from '@cardstack/boxel-icons/globe';
import Refresh from '@cardstack/boxel-icons/refresh';
import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';

import { restartableTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import window from 'ember-window-mock';

import { BoxelButton, Tooltip } from '@cardstack/boxel-ui/components';
import { PublishSiteIcon } from '@cardstack/boxel-ui/icons';

import OpenSitePopover from '@cardstack/host/components/operator-mode/host-submode/open-site-popover';
import PublishingRealmPopover from '@cardstack/host/components/operator-mode/host-submode/publishing-realm-popover';
import PublishRealmModal from '@cardstack/host/components/operator-mode/publish-realm-modal';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type StoreService from '@cardstack/host/services/store';

import HostModeContent from '../host-mode/content';

import SubmodeLayout from './submode-layout';

interface HostSubmodeSignature {
  Element: HTMLElement;
  Args: {};
}

export default class HostSubmode extends Component<HostSubmodeSignature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare store: StoreService;
  @service private declare realm: RealmService;

  @tracked isPublishRealmModalOpen = false;
  @tracked isPublishingRealmPopoverOpen = false;
  @tracked isOpenSitePopoverOpen = false;

  get currentCardId() {
    return this.operatorModeStateService.currentTrailItem?.replace('.json', '');
  }

  get cardIds() {
    return this.operatorModeStateService.state.trail.map((card) =>
      card.replace('.json', ''),
    );
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
    return this.operatorModeStateService.realmURL.href;
  }

  get isPublishing() {
    return this.realm.isPublishing(this.realmURL);
  }

  get hasPublishedSites() {
    return this.publishedRealmURLs.length > 0;
  }

  get publishedRealmEntries() {
    const realmInfo = this.operatorModeStateService.currentRealmInfo;
    if (
      !realmInfo?.lastPublishedAt ||
      typeof realmInfo.lastPublishedAt !== 'object'
    ) {
      return [];
    }

    return Object.entries(realmInfo.lastPublishedAt).sort(
      ([, a], [, b]) => this.parsePublishedAt(b) - this.parsePublishedAt(a),
    );
  }

  get publishedRealmURLs() {
    return this.publishedRealmEntries.map(([url]) => url);
  }

  get defaultPublishedRealmURL(): string | undefined {
    return this.publishedRealmURLs[0];
  }

  getFullURL(baseURL: string) {
    if (this.currentCardId) {
      return baseURL + this.currentCardId.replace(this.realmURL, '');
    }
    return baseURL;
  }

  handlePublish = restartableTask(async (publishedRealmURLs: string[]) => {
    await this.realm.publish(this.realmURL, publishedRealmURLs);
    this.isPublishingRealmPopoverOpen = false;
  });

  handleUnpublish = restartableTask(async (publishedRealmURL: string) => {
    await this.realm.unpublish(this.realmURL, publishedRealmURL);
  });

  removeCardFromTrail = (cardId: string) => {
    let cardIndex = this.cardIds.indexOf(cardId);
    if (cardIndex !== -1) {
      let newTrail = [...this.cardIds];
      newTrail.splice(cardIndex, 1);
      this.operatorModeStateService.updateTrail(newTrail);
    }
  };

  @action
  handleOpenSiteButtonClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (event.shiftKey) {
      this.isOpenSitePopoverOpen = !this.isOpenSitePopoverOpen;
      return;
    }

    this.isOpenSitePopoverOpen = false;
    let defaultURL = this.defaultPublishedRealmURL;
    if (defaultURL) {
      window.open(this.getFullURL(defaultURL), '_blank');
    } else {
      this.isOpenSitePopoverOpen = true;
    }
  }

  private parsePublishedAt(value: unknown) {
    let publishedAt = Number(value ?? 0);
    return Number.isFinite(publishedAt) ? publishedAt : 0;
  }

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
                  @kind='secondary'
                  @size='tall'
                  class='open-site-button'
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
        <HostModeContent
          @cardIds={{this.cardIds}}
          @removeCard={{this.removeCardFromTrail}}
          @openInteractSubmode={{fn layout.updateSubmode 'interact'}}
        />
      </:default>
    </SubmodeLayout>

    <PublishRealmModal
      @isOpen={{this.isPublishRealmModalOpen}}
      @onClose={{this.closePublishRealmModal}}
      @handlePublish={{perform this.handlePublish}}
      @handleUnpublish={{perform this.handleUnpublish}}
    />

    <style scoped>
      .host-submode-layout {
        --submode-bar-item-border-radius: var(--boxel-border-radius);
        --submode-bar-item-box-shadow: var(--boxel-deep-box-shadow);
        --submode-bar-item-outline: var(--boxel-border-flexible);
        --operator-mode-left-column: calc(
          21.5rem - var(--submode-new-file-button-width)
        );
      }

      .host-submode {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background-position: center;
        background-size: cover;
      }

      .host-submode-layout :deep(.top-bar) {
        position: relative;
        background-color: var(--boxel-700);
        width: 100%;
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
