import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import ExternalLink from '@cardstack/boxel-icons/external-link';

import { formatDistanceToNow } from 'date-fns';

import { BoxelButton, RealmIcon } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import { UndoArrow } from '@cardstack/boxel-ui/icons';

import config from '@cardstack/host/config/environment';

import ModalContainer from '../modal-container';
import WithLoadedRealm from '../with-loaded-realm';

import type MatrixService from '../../services/matrix-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type RealmService from '../../services/realm';

interface Signature {
  Element: HTMLElement;
  Args: {
    isOpen: boolean;
    onClose: () => void;
    onPublish: (selectedDomains: string[]) => void;
  };
}

export default class PublishSiteModal extends Component<Signature> {
  @service private declare realm: RealmService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;

  @tracked selectedDomains: string[] = [];
  @tracked isUnpublishing = false;

  get isRealmPublished() {
    return !!this.lastPublishedTime;
  }

  get isPublishDisabled() {
    return !this.hasSelectedDomains || this.isUnpublishing;
  }

  get lastPublishedTime() {
    const realmInfo = this.operatorModeStateService.currentRealmInfo;
    if (
      !realmInfo?.lastPublishedAt ||
      typeof realmInfo.lastPublishedAt !== 'object'
    ) {
      return null;
    }

    const publishedUrl = this.generatedUrl;
    const publishedAtValue = realmInfo.lastPublishedAt[publishedUrl];

    if (!publishedAtValue) {
      return null;
    }

    try {
      let publishedAt = new Date(publishedAtValue);
      return formatDistanceToNow(publishedAt, { addSuffix: true });
    } catch (error) {
      console.warn('Failed to parse published date:', publishedAtValue, error);
      return null;
    }
  }

  get isDefaultDomainSelected() {
    return this.selectedDomains.includes(this.generatedUrl);
  }

  get hasSelectedDomains() {
    return this.selectedDomains.length > 0;
  }

  get currentRealmUrl() {
    return this.operatorModeStateService.realmURL;
  }

  get generatedUrl() {
    const protocol = this.getProtocol();
    const matrixUsername = this.getMatrixUsername();
    const domain = this.getDefaultPublishedRealmDomain();
    const realmName = this.getRealmName();

    return `${protocol}://${matrixUsername}.${domain}/${realmName}/`;
  }

  get urlParts() {
    const protocol = this.getProtocol();
    const matrixUsername = this.getMatrixUsername();
    const domain = this.getDefaultPublishedRealmDomain();
    const realmName = this.getRealmName();

    return {
      baseUrl: `${protocol}://${matrixUsername}.${domain}/`,
      realmName: realmName,
    };
  }

  private getProtocol(): string {
    const environment = config.environment;
    return environment === 'development' || environment === 'test'
      ? 'http'
      : 'https';
  }

  private getMatrixUsername(): string {
    const userName = this.matrixService.userName;
    if (!userName) {
      throw new Error('Matrix username is not available');
    }
    return userName;
  }

  private getDefaultPublishedRealmDomain(): string {
    return config.defaultPublishedRealmDomain;
  }

  private getRealmName(): string {
    const realmUrl = this.currentRealmUrl;
    if (!realmUrl) {
      throw new Error('Current realm URL is not available');
    }

    try {
      const pathSegments = realmUrl.pathname
        .split('/')
        .filter((segment) => segment);
      const lastSegment = pathSegments[pathSegments.length - 1];

      if (!lastSegment) {
        throw new Error('Could not extract realm name from URL path');
      }

      return lastSegment.toLowerCase();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to parse realm URL: ${error.message}`);
      }
      throw new Error('Failed to parse realm URL');
    }
  }

  @action
  toggleDefaultDomain() {
    const defaultUrl = this.generatedUrl;
    if (this.isDefaultDomainSelected) {
      this.selectedDomains = this.selectedDomains.filter(
        (url) => url !== defaultUrl,
      );
    } else {
      this.selectedDomains = [...this.selectedDomains, defaultUrl];
    }
  }

  @action
  handlePublish() {
    if (this.selectedDomains.length === 0) {
      return;
    }

    this.args.onPublish(this.selectedDomains);
  }

  @action
  async handleUnpublish() {
    try {
      this.isUnpublishing = true;
      await this.realm.realmServer.unpublishRealm(this.generatedUrl);
      // The UI will be updated via the unpublish-realm-notification event
    } catch (error) {
      console.error('Error unpublishing realm:', error);
    } finally {
      this.isUnpublishing = false;
    }
  }

  @action
  handleOpenSite() {
    window.open(this.generatedUrl, '_blank');
  }

  @action
  handleCancel() {
    this.args.onClose();
  }

  <template>
    <ModalContainer
      class='publish-site-modal'
      @cardContainerClass='publish-site'
      @title='Where to?'
      @size='medium'
      @isOpen={{@isOpen}}
      @onClose={{this.handleCancel}}
      data-test-publish-site-modal
    >
      <:header>
        <div class='modal-subtitle'>
          Choose which domains you'd like to publish to
        </div>
      </:header>
      <:content>

        <div class='domain-options'>
          <div class='domain-option'>
            <label class='domain-header'>
              <input
                type='checkbox'
                checked={{this.isDefaultDomainSelected}}
                {{on 'change' this.toggleDefaultDomain}}
                class='domain-checkbox'
                data-test-default-domain-checkbox
                disabled={{this.isUnpublishing}}
              />
              <span class='domain-name'>Your Boxel Space</span>
            </label>

            <div class='domain-details'>
              <WithLoadedRealm
                @realmURL={{this.currentRealmUrl.href}}
                as |realm|
              >
                <RealmIcon @realmInfo={{realm.info}} class='realm-icon' />
              </WithLoadedRealm>
              <div class='domain-url-container'>
                <span class='domain-url'>
                  <span class='url-base'>{{this.urlParts.baseUrl}}</span><span
                    class='url-realm-name'
                  >{{this.urlParts.realmName}}/</span>
                </span>
                {{#if this.isRealmPublished}}
                  <div class='domain-info'>
                    <span class='last-published-at'>Published
                      {{this.lastPublishedTime}}</span>
                    <BoxelButton
                      @kind='text-only'
                      @size='extra-small'
                      class='unpublish-button'
                      {{on 'click' this.handleUnpublish}}
                    >
                      <UndoArrow
                        width='11'
                        height='11'
                        class='unpublish-icon'
                      />
                      Unpublish
                    </BoxelButton>
                  </div>
                {{/if}}
              </div>
              {{#if this.isRealmPublished}}
                <BoxelButton
                  @kind='secondary-light'
                  @size='small'
                  {{on 'click' this.handleOpenSite}}
                  class='open-site-button'
                  data-test-open-site-button
                >
                  <ExternalLink
                    width='16'
                    height='16'
                    class='external-link-icon'
                  />
                  Open Site
                </BoxelButton>
              {{/if}}
            </div>
          </div>
        </div>
      </:content>

      <:footer>
        {{#if @isOpen}}
          <div class='footer-buttons'>
            <BoxelButton
              @kind='secondary-light'
              @size='tall'
              {{on 'click' this.handleCancel}}
              class='cancel-button'
              data-test-cancel-button
            >
              Cancel
            </BoxelButton>
            <BoxelButton
              @kind='primary'
              @size='tall'
              {{on 'click' this.handlePublish}}
              @disabled={{this.isPublishDisabled}}
              class='publish-button'
              data-test-publish-button
            >
              Publish to selected domains
            </BoxelButton>
          </div>
        {{/if}}
      </:footer>
    </ModalContainer>

    <style scoped>
      .publish-site-modal {
        --horizontal-gap: var(--boxel-sp-xs);
        --stack-card-footer-height: auto;
      }

      .publish-site-modal > :deep(.boxel-modal__inner) {
        display: flex;
      }

      .publish-site-modal :deep(.dialog-box__content) {
        display: flex;
        flex-direction: column;
      }

      :deep(.publish-site) {
        height: 32rem;
      }

      :deep(.dialog-box__header) {
        gap: var(--boxel-sp-xxxs);
      }

      :deep(.dialog-box__close) {
        display: none;
      }

      .modal-subtitle {
        font-size: normal var(--boxel-font-sm);
        color: var(--boxel-dark);
      }

      .domain-options {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }

      .domain-option {
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-50);
      }

      .domain-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        margin-bottom: var(--boxel-sp-md);
      }

      .domain-checkbox {
        flex-shrink: 0;
      }

      .domain-name {
        font: 600 var(--boxel-font);
        color: var(--boxel-dark);
      }

      .domain-details {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding-left: calc(var(--boxel-sp-lg) + var(--boxel-sp-sm));
        margin-top: var(--boxel-sp);
      }

      .realm-icon {
        flex-shrink: 0;
        --boxel-realm-icon-size: 30px;
      }

      .domain-url-container {
        display: flex;
        flex-direction: column;
      }

      .domain-url {
        flex: 1;
        font-size: var(--boxel-font-size-sm);
      }

      .url-base {
        color: var(--boxel-450);
      }

      .url-realm-name {
        color: var(--boxel-dark);
        font-weight: 500;
      }

      .domain-info {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }

      .last-published-at {
        font: normal var(--boxel-font-xs);
        color: #00ac00;
        position: relative;
        padding-left: calc(var(--boxel-sp-xxxs) + 6px);
      }

      .last-published-at::before {
        content: '•';
        position: absolute;
        left: 0;
        margin-right: var(--boxel-sp-xxxs);
      }

      .unpublish-button {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }

      .unpublish-icon {
        flex-shrink: 0;
      }

      .unpublish-button:hover {
        color: var(--boxel-dark);
        background-color: transparent;
        border-color: transparent;
      }

      .open-site-button {
        flex-shrink: 0;
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        font-size: var(--boxel-font-size-xs);
      }

      .external-link-icon {
        flex-shrink: 0;
      }

      .footer-buttons {
        display: flex;
        margin-left: auto;
        gap: var(--horizontal-gap);
      }
    </style>
  </template>
}
