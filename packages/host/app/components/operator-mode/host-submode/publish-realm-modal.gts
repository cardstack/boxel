import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import ExternalLink from '@cardstack/boxel-icons/external-link';
import Settings from '@cardstack/boxel-icons/settings';
import Undo2 from '@cardstack/boxel-icons/undo-2';

import { formatDistanceToNow } from 'date-fns';

import {
  BoxelButton,
  BoxelInputGroup,
  RealmIcon,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { IconX } from '@cardstack/boxel-ui/icons';

import config from '@cardstack/host/config/environment';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type { SubdomainAvailabilityResult } from '@cardstack/host/services/realm-server';

import ModalContainer from '@cardstack/host/components/modal-container';
import WithLoadedRealm from '@cardstack/host/components/with-loaded-realm';

type CustomSubdomainSelection = {
  url: string;
  subdomain: string;
};

interface Signature {
  Element: HTMLElement;
  Args: {
    isOpen: boolean;
    onClose: () => void;
    handlePublish: (publishedRealmURLs: string[]) => void;
    handleUnpublish: (publishedRealmURL: string) => void;
  };
}

export default class PublishRealmModal extends Component<Signature> {
  @service private declare realm: RealmService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;
  @service private declare realmServer: RealmServerService;

  @tracked selectedPublishedRealmURLs: string[] = [];
  @tracked private customSubdomainSelection: CustomSubdomainSelection | null =
    null;
  @tracked private isCustomSubdomainSetupVisible = false;
  @tracked private CustomSubdomain = '';
  @tracked
  private CustomSubdomainAvailability: SubdomainAvailabilityResult | null =
    null;
  @tracked private customSubdomainError: string | null = null;
  @tracked private isCheckingCustomSubdomain = false;

  get isRealmPublished() {
    return !!this.lastPublishedTime;
  }

  get isPublishDisabled() {
    return (
      !this.hasSelectedPublishedRealmURLs ||
      this.isUnpublishingAnyRealms ||
      this.isPublishing
    );
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
    const publishedAt = realmInfo.lastPublishedAt[publishedUrl]
      ? Number(realmInfo.lastPublishedAt[publishedUrl])
      : null;

    if (!publishedAt) {
      return null;
    }

    try {
      return formatDistanceToNow(publishedAt, { addSuffix: true });
    } catch (error) {
      console.warn(
        'Failed to parse published date:',
        new Date(publishedAt),
        error,
      );
      return null;
    }
  }

  get isDefaultPublishedRealmURLSelected() {
    return this.selectedPublishedRealmURLs.includes(this.generatedUrl);
  }

  get hasSelectedPublishedRealmURLs() {
    return this.selectedPublishedRealmURLs.length > 0;
  }

  get customDomainBase() {
    return config.publishedRealmBoxelSiteDomain;
  }

  get CustomSubdomainDisplay() {
    if (this.customSubdomainSelection?.subdomain) {
      return this.customSubdomainSelection.subdomain;
    }

    if (this.CustomSubdomain) {
      return this.CustomSubdomain;
    }

    return 'custom-name';
  }

  get isCustomDomainSelected() {
    return !!this.customSubdomainSelection;
  }

  get isCustomDomainCheckboxDisabled() {
    return !this.customSubdomainSelection?.url || this.isUnpublishingAnyRealms;
  }

  get CustomSubdomainSuccessMessage() {
    return this.CustomSubdomainAvailability?.available
      ? 'This name is available'
      : null;
  }

  get customSubdomainState() {
    return this.CustomSubdomainAvailability?.available
      ? 'valid'
      : this.customSubdomainError
      ? 'invalid'
      : null;
  }

  get isClaimSiteNameDisabled() {
    return !this.CustomSubdomain || this.isCheckingCustomSubdomain;
  }

  get currentRealmURL() {
    return this.operatorModeStateService.realmURL.href;
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
    // publishedRealmBoxelSpaceDomain is the domain that is used to form urls like "mike.boxel.space/game-mechanics"
    // which are used to create Boxel Spaces (we will also have Boxel Sites, which is a different published realm)
    // TODO: since we currently only have Boxel Spaces, we can default to that domain. When we add Boxel Sites,
    // adjust this component to know which published realm domain to use.
    return config.publishedRealmBoxelSpaceDomain;
  }

  private addPublishedRealmUrl(url: string) {
    if (this.selectedPublishedRealmURLs.includes(url)) {
      return;
    }

    this.selectedPublishedRealmURLs = [...this.selectedPublishedRealmURLs, url];
  }

  private removePublishedRealmUrl(url: string) {
    if (!this.selectedPublishedRealmURLs.includes(url)) {
      return;
    }

    this.selectedPublishedRealmURLs = this.selectedPublishedRealmURLs.filter(
      (existingUrl) => existingUrl !== url,
    );
  }

  private buildPublishedRealmUrl(hostname: string): string {
    const protocol = this.getProtocol();
    const realmName = this.getRealmName();
    return `${protocol}://${hostname}/${realmName}/`;
  }

  private clearCustomSubdomainFeedback() {
    this.CustomSubdomainAvailability = null;
    this.customSubdomainError = null;
  }

  private validateCustomSubdomain(subdomain: string): string | null {
    if (!subdomain) {
      return 'Subdomain is required';
    }
    if (!/^[a-z0-9-]+$/.test(subdomain)) {
      return 'Subdomain can only contain lowercase letters, numbers, and hyphens';
    }
    if (subdomain.startsWith('-') || subdomain.endsWith('-')) {
      return 'Subdomain cannot start or end with a hyphen';
    }
    if (subdomain.length < 2) {
      return 'Subdomain must be at least 2 characters long';
    }
    if (subdomain.length > 63) {
      return 'Subdomain cannot be longer than 63 characters';
    }
    return null;
  }

  private setCustomSubdomainSelection(
    selection: CustomSubdomainSelection | null,
  ) {
    const previousUrl = this.customSubdomainSelection?.url;
    if (previousUrl) {
      this.removePublishedRealmUrl(previousUrl);
    }

    this.customSubdomainSelection = selection;

    if (selection) {
      this.addPublishedRealmUrl(selection.url);
      this.CustomSubdomain = selection.subdomain;
    }
  }

  private getRealmName(): string {
    const realmUrl = this.currentRealmURL;
    if (!realmUrl) {
      throw new Error('Current realm URL is not available');
    }

    try {
      const pathSegments = new URL(realmUrl).pathname
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
  toggleDefaultDomain(event: Event) {
    const checkbox = event.target as HTMLInputElement;
    const defaultUrl = this.generatedUrl;
    if (checkbox.checked) {
      this.addPublishedRealmUrl(defaultUrl);
    } else {
      this.removePublishedRealmUrl(defaultUrl);
    }
  }

  @action
  openCustomSubdomainSetup() {
    this.isCustomSubdomainSetupVisible = true;
    this.CustomSubdomain =
      this.customSubdomainSelection?.subdomain ?? this.CustomSubdomain;
  }

  @action
  cancelCustomSubdomainSetup() {
    this.isCustomSubdomainSetupVisible = false;
    this.CustomSubdomain = this.customSubdomainSelection?.subdomain ?? '';
    this.clearCustomSubdomainFeedback();
  }

  @action
  handleCustomSubdomainInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.value.trim().toLowerCase();
    this.CustomSubdomain = value;

    if (
      !value ||
      (this.customSubdomainSelection &&
        value !== this.customSubdomainSelection.subdomain)
    ) {
      this.setCustomSubdomainSelection(null);
    }

    this.clearCustomSubdomainFeedback();
  }

  @action
  async handleClaimSiteName(event: Event) {
    event.preventDefault();

    const subdomain = this.CustomSubdomain.trim();
    const validationError = this.validateCustomSubdomain(subdomain);
    if (validationError) {
      this.customSubdomainError = validationError;
      this.CustomSubdomainAvailability = null;
      this.setCustomSubdomainSelection(null);
      return;
    }

    this.isCheckingCustomSubdomain = true;
    this.clearCustomSubdomainFeedback();

    try {
      const result =
        await this.realmServer.checkSiteNameAvailability(subdomain);
      this.CustomSubdomainAvailability = result;

      if (result.available) {
        const publishedUrl = this.buildPublishedRealmUrl(result.hostname);
        this.setCustomSubdomainSelection({ url: publishedUrl, subdomain });
      } else {
        this.customSubdomainError =
          result.error ?? 'This name is already taken';
        this.setCustomSubdomainSelection(null);
      }
    } catch (error) {
      console.error('Failed to check site name availability', error);
      this.customSubdomainError =
        error instanceof Error
          ? error.message
          : 'Failed to check site name availability';
      this.CustomSubdomainAvailability = null;
      this.setCustomSubdomainSelection(null);
    } finally {
      this.isCheckingCustomSubdomain = false;
    }
  }

  @action
  toggleCustomDomain(event: Event) {
    const checkbox = event.target as HTMLInputElement;

    if (!this.customSubdomainSelection) {
      checkbox.checked = false;
      return;
    }

    if (!checkbox.checked) {
      this.setCustomSubdomainSelection(null);
    }
  }

  @action
  handleOpenSite() {
    window.open(this.generatedUrl, '_blank');
  }

  handleCancel() {
    this.args.onClose();
  }

  isUnpublishingRealm = (publishedRealmURL: string) => {
    return this.realm.isUnpublishingRealm(
      this.currentRealmURL,
      publishedRealmURL,
    );
  };

  get isUnpublishingAnyRealms() {
    return this.realm.isUnpublishingAnyRealms(this.currentRealmURL);
  }

  get isPublishing() {
    return this.realm.isPublishing(this.currentRealmURL);
  }

  <template>
    <ModalContainer
      class='publish-realm-modal'
      @cardContainerClass='publish-realm'
      @title='Where to?'
      @size='medium'
      @isOpen={{@isOpen}}
      @onClose={{this.handleCancel}}
      data-test-publish-realm-modal
    >
      <:header>
        <div class='modal-subtitle'>
          Choose which domains you'd like to publish to
        </div>
      </:header>
      <:content>

        <div class='domain-options'>
          <div class='domain-option'>
            <input
              type='checkbox'
              id='default-domain-checkbox'
              checked={{this.isDefaultPublishedRealmURLSelected}}
              {{on 'change' this.toggleDefaultDomain}}
              class='domain-checkbox'
              data-test-default-domain-checkbox
              disabled={{this.isUnpublishingAnyRealms}}
            />
            <label class='option-title' for='default-domain-checkbox'>Your Boxel
              Space</label>

            <div class='domain-details'>
              <WithLoadedRealm @realmURL={{this.currentRealmURL}} as |realm|>
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
                    <span
                      class='last-published-at'
                      data-test-last-published-at
                    >Published
                      {{this.lastPublishedTime}}</span>
                    <BoxelButton
                      @kind='text-only'
                      @size='extra-small'
                      @disabled={{this.isUnpublishingRealm this.generatedUrl}}
                      class='unpublish-button'
                      {{on 'click' (fn @handleUnpublish this.generatedUrl)}}
                      data-test-unpublish-button
                    >
                      {{#if (this.isUnpublishingRealm this.generatedUrl)}}
                        <LoadingIndicator />
                        Unpublishing…
                      {{else}}
                        <Undo2 width='11' height='11' class='unpublish-icon' />
                        Unpublish
                      {{/if}}

                    </BoxelButton>
                  </div>
                {{/if}}
              </div>
            </div>
            {{#if this.isRealmPublished}}
              <BoxelButton
                @kind='secondary-light'
                @size='small'
                @disabled={{this.isUnpublishingAnyRealms}}
                {{on 'click' this.handleOpenSite}}
                class='action'
                data-test-open-site-button
              >
                <ExternalLink width='16' height='16' class='button-icon' />
                Open Site
              </BoxelButton>
            {{/if}}
          </div>

          <div
            class='domain-option
              {{if this.isCustomSubdomainSetupVisible "claiming"}}
              '
          >
            <input
              type='checkbox'
              id='custom-subdomain-checkbox'
              checked={{this.isCustomDomainSelected}}
              {{on 'change' this.toggleCustomDomain}}
              class='domain-checkbox'
              data-test-custom-domain-checkbox
              disabled={{this.isCustomDomainCheckboxDisabled}}
            />
            <label class='option-title' for='custom-subdomain-checkbox'>Custom
              Site Name</label>
            {{#if this.isCustomSubdomainSetupVisible}}
              <BoxelButton
                @size='extra-small'
                @kind='text-only'
                class='custom-subdomain-cancel cancel'
                {{on 'click' this.cancelCustomSubdomainSetup}}
                data-test-custom-subdomain-cancel
              >
                Cancel
                <IconX width='12' height='12' class='cancel-icon' />
              </BoxelButton>
            {{else}}
            {{/if}}
            <div class='domain-details'>
              {{#if this.isCustomSubdomainSetupVisible}}
                <div class='custom-subdomain-setup'>
                  <label
                    class='custom-subdomain-label'
                    for='custom-subdomain-input'
                  >
                    Choose a site name
                  </label>
                  <div class='custom-subdomain-row'>
                    <BoxelInputGroup
                      @id='custom-subdomain-input'
                      @placeholder='custom-name'
                      @value={{this.CustomSubdomain}}
                      @state={{this.customSubdomainState}}
                      @errorMessage={{this.customSubdomainError}}
                      {{on 'input' this.handleCustomSubdomainInput}}
                      class='custom-subdomain-input'
                      spellcheck='false'
                      data-test-custom-subdomain-input
                    >
                      <:after as |Accessories|>
                        <Accessories.Text
                          class='custom-domain-suffix'
                        >.{{this.customDomainBase}}</Accessories.Text>
                      </:after>
                    </BoxelInputGroup>
                  </div>
                </div>
              {{else}}
                <div class='custom-subdomain-placeholder'>
                  {{this.CustomSubdomainDisplay}}<span
                    class='placeholder-top-level'
                  >.{{this.customDomainBase}}</span>
                </div>
              {{/if}}
            </div>

            {{#if this.isCustomSubdomainSetupVisible}}
              <BoxelButton
                @kind='primary'
                @size='small'
                class='claim-site-name-button action'
                @disabled={{this.isClaimSiteNameDisabled}}
                {{on 'click' this.handleClaimSiteName}}
                data-test-claim-site-name-button
              >
                {{#if this.isCheckingCustomSubdomain}}
                  <LoadingIndicator />
                  Checking…
                {{else}}
                  Claim Site Name
                {{/if}}
              </BoxelButton>

            {{else}}
              <BoxelButton
                @kind='secondary-light'
                @size='small'
                class='action'
                {{on 'click' this.openCustomSubdomainSetup}}
                data-test-custom-subdomain-setup-button
              >
                <Settings width='16' height='16' class='button-icon' />
                Set Up
              </BoxelButton>
            {{/if}}
          </div>
        </div>
      </:content>

      <:footer>
        {{#if @isOpen}}
          <div class='footer-buttons'>
            <BoxelButton
              @kind='primary'
              @size='tall'
              {{on 'click' (fn @handlePublish this.selectedPublishedRealmURLs)}}
              @disabled={{this.isPublishDisabled}}
              class='publish-button'
              data-test-publish-button
            >
              {{#if this.isPublishing}}
                <LoadingIndicator />
                Publishing…
              {{else}}
                Publish to selected domains
              {{/if}}
            </BoxelButton>
          </div>
        {{/if}}
      </:footer>
    </ModalContainer>

    <style scoped>
      .publish-realm-modal {
        --horizontal-gap: var(--boxel-sp-xs);
        --stack-card-footer-height: auto;
      }

      .publish-realm-modal > :deep(.boxel-modal__inner) {
        display: flex;
      }

      .publish-realm-modal :deep(.dialog-box__content) {
        display: flex;
        flex-direction: column;
      }

      :deep(.publish-realm) {
        height: 32rem;
      }

      :deep(.dialog-box__header) {
        gap: var(--boxel-sp-xxxs);
      }

      .modal-subtitle {
        font-size: normal var(--boxel-font-sm);
        color: var(--boxel-dark);
      }

      .domain-options {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }

      .domain-option {
        display: grid;
        grid-template-areas:
          'checkbox . title   cancel'
          '.        . details action';

        grid-template-columns: auto var(--boxel-sp-sm) 1fr auto;

        align-items: center;

        background-color: var(--boxel-50);
        padding-top: var(--boxel-sp-lg);
        padding-bottom: var(--boxel-sp-xl);
      }

      .domain-option:not(:last-child) {
        border-bottom: 1px solid var(--boxel-200);
      }

      .domain-option-headxer {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .domain-header {
        display: flex;
        align-items: center;
        margin-bottom: var(--boxel-sp-md);
      }

      .cancel {
        grid-area: cancel;
      }

      .domain-checkbox {
        grid-area: checkbox;

        flex-shrink: 0;
      }

      .option-title {
        grid-area: title;

        font: 600 var(--boxel-font);
        color: var(--boxel-dark);
      }

      .domain-details {
        grid-area: details;

        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        margin-top: var(--boxel-sp-xxs);
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
        padding-left: calc(var(--boxel-sp-xxxs) + 3px);
      }

      .last-published-at::before {
        content: '•';
        position: absolute;
        left: 0;
      }

      .unpublish-button {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        background-color: transparent;
        border: none;
      }

      .unpublish-icon {
        flex-shrink: 0;
      }

      .unpublish-button:not(:disabled):hover {
        color: var(--boxel-dark);
      }

      .publish-button {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }

      .action {
        grid-area: action;

        margin: auto 0;
        flex-shrink: 0;
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        font-size: var(--boxel-font-size-xs);
      }

      .domain-option.claiming .action {
        margin-top: calc(var(--boxel-sp-xl) + var(--boxel-sp-xxxs));
      }

      .button-icon {
        flex-shrink: 0;
      }

      .footer-buttons {
        display: flex;
        margin-left: auto;
        gap: var(--horizontal-gap);
      }

      .custom-subdomain-placeholder {
        color: var(--boxel-450);
        font-size: var(--boxel-font-size-sm);
      }

      .placeholder-top-level {
        font-weight: var(--boxel-font-weight-semibold);
      }

      .custom-subdomain-setup {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxxs);
        width: 100%;
      }

      .custom-subdomain-label {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--boxel-dark);
      }

      .custom-subdomain-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding-right: var(--boxel-sp);
      }

      .custom-subdomain-row :deep(.container) {
        width: 100%;
      }

      .custom-subdomain-input:focus {
        outline: none;
        border-color: var(--boxel-600);
      }

      .custom-domain-suffix {
        color: var(--boxel-450);
        font-size: var(--boxel-font-size-sm);
        white-space: nowrap;
      }

      .custom-subdomain-feedback {
        font-size: var(--boxel-font-size-xs);
        padding-left: calc(var(--boxel-sp-xs) + var(--boxel-sp-sm));
      }

      .custom-subdomain-feedback--success {
        color: #00ac00;
      }

      .custom-subdomain-feedback--error {
        color: var(--boxel-danger);
      }

      .custom-subdomain-cancel {
        gap: var(--boxel-sp-xxxs);
        margin-left: auto;
      }
    </style>
  </template>
}
