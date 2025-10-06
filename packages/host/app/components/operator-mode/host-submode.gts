import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Refresh from '@cardstack/boxel-icons/refresh';

import { restartableTask } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import { BoxelButton } from '@cardstack/boxel-ui/components';
import { PublishSiteIcon } from '@cardstack/boxel-ui/icons';

import PublishingRealmPopover from '@cardstack/host/components/operator-mode/publishing-realm-popover';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type RealmService from '@cardstack/host/services/realm';
import type StoreService from '@cardstack/host/services/store';

import HostModeContent from '../host-mode/host-mode-content';
import PublishRealmModal from './publish-realm-modal';
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

  get realmURL() {
    return this.operatorModeStateService.realmURL.href;
  }

  get isPublishing() {
    return this.realm.isPublishing(this.realmURL);
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

  <template>
    <SubmodeLayout class='host-submode-layout' data-test-host-submode>
      <:topBar>
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
        <PublishingRealmPopover @isOpen={{this.isPublishingRealmPopoverOpen}} />
      </:topBar>
      <:default>
        <HostModeContent
          @cardIds={{this.cardIds}}
          @close={{this.removeCardFromTrail}}
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
        background-color: var(--boxel-700);
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
