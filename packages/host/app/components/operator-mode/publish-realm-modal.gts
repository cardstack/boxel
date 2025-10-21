import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';

import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import ExternalLink from '@cardstack/boxel-icons/external-link';
import Settings from '@cardstack/boxel-icons/settings';
import Undo2 from '@cardstack/boxel-icons/undo-2';

import { formatDistanceToNow } from 'date-fns';
import { restartableTask, task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import window from 'ember-window-mock';

import {
  BoxelButton,
  BoxelInputGroup,
  RealmIcon,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import ModalContainer from '@cardstack/host/components/modal-container';
import WithLoadedRealm from '@cardstack/host/components/with-loaded-realm';

import config from '@cardstack/host/config/environment';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type {
  ClaimedSiteHostname,
  SubdomainAvailabilityResult,
} from '@cardstack/host/services/realm-server';

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
  @tracked private customSubdomain = '';
  @tracked
  private customSubdomainAvailability: SubdomainAvailabilityResult | null =
    null;
  @tracked private customSubdomainError: string | null = null;
  @tracked private isCheckingCustomSubdomain = false;
  @tracked private claimedSiteHostname: ClaimedSiteHostname | null = null;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.fetchClaimedSite.perform();
  }

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
    return this.getFormattedLastPublishedTime(this.generatedUrl);
  }

  get claimedSitePublishedUrl() {
    if (!this.claimedSiteHostname) {
      return null;
    }

    return this.buildPublishedRealmUrl(this.claimedSiteHostname.hostname);
  }

  get claimedSiteLastPublishedTime() {
    if (!this.claimedSitePublishedUrl) {
      return null;
    }

    return this.getFormattedLastPublishedTime(this.claimedSitePublishedUrl);
  }

  get isClaimedSitePublished() {
    if (!this.claimedSitePublishedUrl) {
      return false;
    }

    return !!this.getLastPublishedTimestamp(this.claimedSitePublishedUrl);
  }

  get shouldShowUnclaimSiteButton() {
    return !!this.claimedSiteHostname && !this.isClaimedSitePublished;
  }

  get isUnclaimSiteButtonDisabled() {
    return (
      this.unclaimSiteName.isRunning ||
      this.isUnpublishingAnyRealms ||
      this.isPublishing
    );
  }

  private getFormattedLastPublishedTime(publishedRealmURL: string) {
    const publishedAt = this.getLastPublishedTimestamp(publishedRealmURL);
    if (!publishedAt) {
      return null;
    }

    try {
      return formatDistanceToNow(publishedAt, { addSuffix: true });
    } catch (error) {
      console.warn(
        `Failed to parse published date for ${publishedRealmURL}:`,
        new Date(publishedAt),
        error,
      );
      return null;
    }
  }

  private getLastPublishedTimestamp(publishedRealmURL: string) {
    const realmInfo = this.operatorModeStateService.currentRealmInfo;
    if (
      !realmInfo?.lastPublishedAt ||
      typeof realmInfo.lastPublishedAt !== 'object'
    ) {
      return null;
    }

    const rawPublishedAt = realmInfo.lastPublishedAt[publishedRealmURL];
    if (!rawPublishedAt) {
      return null;
    }

    const publishedAt = Number(rawPublishedAt);
    return Number.isFinite(publishedAt) ? publishedAt : null;
  }

  get isDefaultPublishedRealmURLSelected() {
    return this.selectedPublishedRealmURLs.includes(this.generatedUrl);
  }

  get hasSelectedPublishedRealmURLs() {
    return this.selectedPublishedRealmURLs.length > 0;
  }

  get customSubdomainBase() {
    return config.publishedRealmBoxelSiteDomain;
  }

  get customSubdomainDisplay() {
    if (this.claimedSiteHostname) {
      return this.claimedSiteHostname.subdomain;
    }

    if (this.customSubdomainSelection?.subdomain) {
      return this.customSubdomainSelection.subdomain;
    }

    if (this.customSubdomain) {
      return this.customSubdomain;
    }

    return 'custom-site-name';
  }

  get customSubdomainState() {
    // Check for errors first, as they should take priority
    if (this.customSubdomainError) {
      return 'invalid';
    }
    if (this.customSubdomainAvailability?.available) {
      return 'valid';
    }
    return null;
  }

  get isClaimCustomSubdomainDisabled() {
    return !this.customSubdomain || this.isCheckingCustomSubdomain;
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

  private buildPublishedRealmUrl(hostname: string): string {
    let protocol = this.getProtocol();
    return `${protocol}://${hostname}/`;
  }

  private clearCustomSubdomainFeedback() {
    this.customSubdomainAvailability = null;
    this.customSubdomainError = null;
  }

  private applyClaimedSiteHostname(claim: ClaimedSiteHostname | null) {
    this.claimedSiteHostname = claim;

    if (claim) {
      this.setCustomSubdomainSelection({
        url: this.buildPublishedRealmUrl(claim.hostname),
        subdomain: claim.subdomain,
      });
      this.customSubdomain = '';
      this.isCustomSubdomainSetupVisible = false;
    } else if (!this.isCustomSubdomainSetupVisible) {
      this.setCustomSubdomainSelection(null);
    }
  }

  private fetchClaimedSite = restartableTask(async () => {
    try {
      let claimedSite = await this.realmServer.fetchClaimedSiteHostname(
        this.currentRealmURL,
      );
      this.applyClaimedSiteHostname(claimedSite);
    } catch (error) {
      console.error('Failed to load claimed site hostname', error);
    }
  });

  private unclaimSiteName = task(async () => {
    if (!this.claimedSiteHostname) {
      return;
    }

    this.customSubdomainError = null;

    try {
      await this.realmServer.deleteClaimedSiteHostname(
        this.claimedSiteHostname.id,
      );
      this.applyClaimedSiteHostname(null);
    } catch (error) {
      console.error('Failed to unclaim site name', error);
      this.customSubdomainError =
        error instanceof Error ? error.message : 'Failed to unclaim site name';
    }
  });

  private setCustomSubdomainSelection(
    selection: CustomSubdomainSelection | null,
  ) {
    this.customSubdomainSelection = selection;
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
  toggleDefaultDomain() {
    const defaultUrl = this.generatedUrl;
    if (!this.isDefaultPublishedRealmURLSelected) {
      this.selectedPublishedRealmURLs = [
        ...this.selectedPublishedRealmURLs,
        defaultUrl,
      ];
    }
  }

  @action
  openCustomSubdomainSetup() {
    this.isCustomSubdomainSetupVisible = true;
    this.customSubdomain =
      this.customSubdomainSelection?.subdomain ?? this.customSubdomain;
  }

  @action
  cancelCustomSubdomainSetup() {
    this.isCustomSubdomainSetupVisible = false;
    this.customSubdomain = this.customSubdomainSelection?.subdomain ?? '';
    this.clearCustomSubdomainFeedback();
  }

  @action
  handleCustomSubdomainInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.value.trim().toLowerCase();
    this.customSubdomain = value;

    if (
      !value ||
      (this.customSubdomainSelection &&
        value !== this.customSubdomainSelection.subdomain)
    ) {
      this.setCustomSubdomainSelection(null);
    }

    this.clearCustomSubdomainFeedback();
  }

  private handleClaimCustomSubdomainTask = restartableTask(
    async (event: Event) => {
      event.preventDefault();

      let subdomain = this.customSubdomain;

      this.isCheckingCustomSubdomain = true;
      this.clearCustomSubdomainFeedback();

      try {
        let result =
          await this.realmServer.checkSiteNameAvailability(subdomain);
        this.customSubdomainAvailability = result;

        if (result.available) {
          // Strip port from base domain if present (e.g., "localhost:4201" -> "localhost")
          let baseDomain = this.customSubdomainBase.split(':')[0];
          let hostname = `${subdomain}.${baseDomain}`;
          let publishedUrl = this.buildPublishedRealmUrl(hostname);
          this.setCustomSubdomainSelection({ url: publishedUrl, subdomain });

          try {
            let {
              data: { attributes },
            } = await this.realmServer.claimBoxelDomain(
              this.currentRealmURL,
              hostname,
            );
            this.applyClaimedSiteHostname(attributes);
            this.isCustomSubdomainSetupVisible = false;
          } catch (claimError) {
            let errorMessage = (claimError as Error).message;

            this.customSubdomainError = errorMessage;
            this.setCustomSubdomainSelection(null);
          }
        } else {
          this.customSubdomainError =
            result.error ?? 'This name is already taken';
          this.setCustomSubdomainSelection(null);
        }
      } catch (error) {
        this.customSubdomainError =
          error instanceof Error
            ? error.message
            : 'Failed to check site name availability';
        this.customSubdomainAvailability = null;
        this.setCustomSubdomainSelection(null);
      } finally {
        this.isCheckingCustomSubdomain = false;
      }
    },
  );

  @action
  handleUnclaimSiteName() {
    this.unclaimSiteName.perform();
  }

  @action
  handleOpenSite() {
    window.open(this.generatedUrl, '_blank');
  }

  @action
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
                  <span class='url-part'>{{this.urlParts.baseUrl}}</span><span
                    class='url-part-bold'
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
                data-test-open-boxel-space-button
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
              class='domain-checkbox'
              data-test-custom-subdomain-checkbox
              disabled={{not this.claimedSiteHostname}}
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
            {{/if}}
            <div class='domain-details' data-test-custom-subdomain-details>
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
                      @value={{this.customSubdomain}}
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
                        >.{{this.customSubdomainBase}}</Accessories.Text>
                      </:after>
                    </BoxelInputGroup>
                  </div>
                </div>
              {{else if this.claimedSiteHostname}}
                <WithLoadedRealm @realmURL={{this.currentRealmURL}} as |realm|>
                  <RealmIcon @realmInfo={{realm.info}} class='realm-icon' />
                </WithLoadedRealm>
                <div class='domain-url-container'>
                  <span class='domain-url'>
                    <span class='url-part'>{{this.getProtocol}}://</span><span
                      class='url-part-bold'
                    >{{this.customSubdomainDisplay}}</span><span
                      class='url-part'
                    >.{{this.customSubdomainBase}}/</span>
                  </span>
                  {{#if this.claimedSiteHostname}}
                    <div class='domain-info'>
                      {{#if this.claimedSiteLastPublishedTime}}
                        <span class='last-published-at'>Published
                          {{this.claimedSiteLastPublishedTime}}</span>
                      {{else}}
                        <span class='not-published-yet'>Not published yet</span>
                      {{/if}}
                      {{#if this.shouldShowUnclaimSiteButton}}
                        <BoxelButton
                          @kind='text-only'
                          @size='extra-small'
                          class='unpublish-button unclaim-button'
                          @disabled={{this.isUnclaimSiteButtonDisabled}}
                          {{on 'click' this.handleUnclaimSiteName}}
                          data-test-unclaim-custom-subdomain-button
                        >
                          {{#if this.unclaimSiteName.isRunning}}
                            <LoadingIndicator />
                            Unclaiming…
                          {{else}}
                            Unclaim Site Name
                          {{/if}}
                        </BoxelButton>
                      {{/if}}
                    </div>
                  {{/if}}
                </div>
              {{else}}
                <span class='domain-url'>
                  <span class='url-part'>{{this.getProtocol}}://</span><span
                    class='url-part'
                  >{{this.customSubdomainDisplay}}</span><span
                    class='url-part-bold'
                  >.{{this.customSubdomainBase}}/</span>
                </span>
              {{/if}}
            </div>

            {{#if this.isCustomSubdomainSetupVisible}}
              <BoxelButton
                @kind='primary'
                @size='small'
                class='claim-custom-subdomain-button action'
                @disabled={{this.isClaimCustomSubdomainDisabled}}
                {{on 'click' (perform this.handleClaimCustomSubdomainTask)}}
                data-test-claim-custom-subdomain-button
              >
                {{#if this.isCheckingCustomSubdomain}}
                  <LoadingIndicator />
                  Checking…
                {{else}}
                  Claim Site Name
                {{/if}}
              </BoxelButton>
            {{else}}
              {{#unless this.claimedSiteHostname}}
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
              {{/unless}}
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

    {{! this is spuriously triggered because of multi-line grid-template-areas below }}
    {{! template-lint-disable no-whitespace-for-layout }}
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

      .url-part {
        color: var(--boxel-450);
      }

      .url-part-bold {
        color: var(--boxel-dark);
        font-weight: 500;
      }

      .domain-info {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }

      .last-published-at,
      .not-published-yet {
        font: normal var(--boxel-font-xs);
        position: relative;
        padding-left: calc(var(--boxel-sp-xxxs) + 3px);
      }

      .last-published-at {
        color: #00ac00;
      }

      .not-published-yet {
        color: var(--boxel-450);
      }

      .last-published-at::before,
      .not-published-yet::before {
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

      .custom-domain-suffix {
        color: var(--boxel-450);
      }

      .custom-subdomain-cancel {
        gap: var(--boxel-sp-xxxs);
        margin-left: auto;
      }
    </style>
  </template>
}
