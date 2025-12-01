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
import { restartableTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

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

import HostModeService from '@cardstack/host/services/host-mode-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type {
  ClaimedDomain,
  SubdomainAvailabilityResult,
} from '@cardstack/host/services/realm-server';

type CustomSubdomainSelection = {
  url: string;
  subdomain: string;
};

export type PublishError = Error & {
  urlErrors: Map<string, string>;
};

interface Signature {
  Element: HTMLElement;
  Args: {
    isOpen: boolean;
    onClose: () => void;
    handlePublish: (publishedRealmURLs: string[]) => void;
    publishError?: PublishError | null;
    handleUnpublish: (publishedRealmURL: string) => void;
  };
}

export default class PublishRealmModal extends Component<Signature> {
  @service private declare hostModeService: HostModeService;
  @service private declare matrixService: MatrixService;
  @service private declare realm: RealmService;
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
  @tracked private claimedDomain: ClaimedDomain | null = null;
  private initialSelectionsSet = false;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.ensureInitialSelectionsTask.perform();
    this.fetchBoxelClaimedDomain.perform();
  }

  get isSubdirectoryRealmPublished() {
    return this.hostModeService.isPublished(this.subdirectoryRealmUrl);
  }

  get isPublishDisabled() {
    return (
      !this.hasSelectedPublishedRealmURLs ||
      this.isUnpublishingAnyRealms ||
      this.isPublishing
    );
  }

  get lastPublishedTime() {
    return this.getFormattedLastPublishedTime(this.subdirectoryRealmUrl);
  }

  get claimedDomainPublishedUrl() {
    if (!this.claimedDomain) {
      return null;
    }

    return this.buildPublishedRealmUrl(this.claimedDomain.hostname);
  }

  get claimedDomainLastPublishedTime() {
    if (!this.claimedDomainPublishedUrl) {
      return null;
    }

    return this.getFormattedLastPublishedTime(this.claimedDomainPublishedUrl);
  }

  get isClaimedDomainPublished() {
    if (!this.claimedDomainPublishedUrl) {
      return false;
    }

    return this.hostModeService.isPublished(this.claimedDomainPublishedUrl);
  }

  get shouldShowUnclaimDomainButton() {
    return !!this.claimedDomain && !this.isClaimedDomainPublished;
  }

  get isUnclaimDomainButtonDisabled() {
    return (
      this.handleUnclaimCustomSubdomainTask.isRunning ||
      this.isUnpublishingAnyRealms ||
      this.isPublishing
    );
  }

  private getFormattedLastPublishedTime(publishedRealmURL: string) {
    const publishedAt =
      this.hostModeService.lastPublishedTimestamp(publishedRealmURL);
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

  get isSubdirectoryRealmSelected() {
    return this.selectedPublishedRealmURLs.includes(this.subdirectoryRealmUrl);
  }

  get isCustomSubdomainSelected() {
    if (!this.claimedDomainPublishedUrl) {
      return false;
    }
    return this.selectedPublishedRealmURLs.includes(
      this.claimedDomainPublishedUrl,
    );
  }

  get hasSelectedPublishedRealmURLs() {
    return this.selectedPublishedRealmURLs.length > 0;
  }

  get customSubdomainBase() {
    return config.publishedRealmBoxelSiteDomain;
  }

  get customSubdomainDisplay() {
    if (this.claimedDomain) {
      return this.claimedDomain.subdomain;
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
    return this.hostModeService.realmURL;
  }

  get subdirectoryRealmUrl() {
    const protocol = this.getProtocol();
    const matrixUsername = this.getMatrixUsername();
    const domain = this.getDefaultPublishedRealmDomain();
    const realmName = this.getRealmName();

    return `${protocol}://${matrixUsername}.${domain}/${realmName}/`;
  }

  get subdirectoryRealmParts() {
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

  private applyClaimedDomain(
    claim: ClaimedDomain | null,
    options: { select?: boolean } = {},
  ) {
    const { select = false } = options;
    const previousSelectionUrl = this.customSubdomainSelection?.url;
    this.claimedDomain = claim;

    if (claim) {
      const publishedUrl = this.buildPublishedRealmUrl(claim.hostname);
      if (previousSelectionUrl && previousSelectionUrl !== publishedUrl) {
        this.removePublishedRealmUrl(previousSelectionUrl);
      }
      this.setCustomSubdomainSelection({
        url: publishedUrl,
        subdomain: claim.subdomain,
      });
      if (select) {
        this.addPublishedRealmUrl(publishedUrl);
      }
      this.customSubdomain = '';
      this.isCustomSubdomainSetupVisible = false;
    } else {
      if (previousSelectionUrl) {
        this.removePublishedRealmUrl(previousSelectionUrl);
      }
      if (!this.isCustomSubdomainSetupVisible) {
        this.setCustomSubdomainSelection(null);
      }
    }
    this.applyInitialSelections(claim);
  }

  private fetchBoxelClaimedDomain = restartableTask(async () => {
    try {
      let claimedDomain = await this.realmServer.fetchBoxelClaimedDomain(
        this.currentRealmURL,
      );
      this.applyClaimedDomain(claimedDomain);
    } catch (error) {
      console.error('Failed to load claimed domain', error);
    }
  });

  private handleUnclaimCustomSubdomainTask = restartableTask(async () => {
    if (!this.claimedDomain) {
      return;
    }

    this.customSubdomainError = null;

    try {
      await this.realmServer.deleteBoxelClaimedDomain(this.claimedDomain.id);
      this.applyClaimedDomain(null);
      this.clearCustomSubdomainFeedback();
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
  toggleDefaultDomain(event: Event) {
    const defaultUrl = this.subdirectoryRealmUrl;
    const input = event.target as HTMLInputElement;
    if (input.checked) {
      this.addPublishedRealmUrl(defaultUrl);
    } else {
      this.removePublishedRealmUrl(defaultUrl);
    }
  }

  @action
  toggleCustomSubdomain(event: Event) {
    if (this.claimedDomain) {
      const customUrl = this.buildPublishedRealmUrl(
        this.claimedDomain.hostname,
      );
      const input = event.target as HTMLInputElement;
      if (input.checked) {
        this.addPublishedRealmUrl(customUrl);
      } else {
        this.removePublishedRealmUrl(customUrl);
      }
    }
  }

  private addPublishedRealmUrl(url: string) {
    if (!this.selectedPublishedRealmURLs.includes(url)) {
      this.selectedPublishedRealmURLs = [
        ...this.selectedPublishedRealmURLs,
        url,
      ];
    }
  }

  private removePublishedRealmUrl(url: string | undefined) {
    if (!url) {
      return;
    }
    if (this.selectedPublishedRealmURLs.includes(url)) {
      this.selectedPublishedRealmURLs = this.selectedPublishedRealmURLs.filter(
        (selectedUrl) => selectedUrl !== url,
      );
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
        let result = await this.realmServer.checkDomainAvailability(subdomain);
        this.customSubdomainAvailability = result;

        if (result.available) {
          // Keep the full domain including port if present (e.g., "localhost:4201")
          let baseDomain = this.customSubdomainBase;
          let hostname = `${subdomain}.${baseDomain}`;
          let publishedUrl = this.buildPublishedRealmUrl(hostname);
          this.setCustomSubdomainSelection({ url: publishedUrl, subdomain });

          try {
            let claimResult = (await this.realmServer.claimBoxelDomain(
              this.currentRealmURL,
              hostname,
            )) as {
              data: {
                id: string;
                attributes: {
                  subdomain: string;
                  hostname: string;
                  sourceRealmURL: string;
                };
              };
            };
            this.applyClaimedDomain(
              {
                id: claimResult.data.id,
                subdomain: claimResult.data.attributes.subdomain,
                hostname: claimResult.data.attributes.hostname,
                sourceRealmURL: claimResult.data.attributes.sourceRealmURL,
              },
              { select: true },
            );
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

  get customSubdomainIndexUrl() {
    if (this.claimedDomainPublishedUrl) {
      return this.claimedDomainPublishedUrl;
    }
    return null;
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

  getPublishErrorForUrl = (url: string): string | null => {
    const error = this.args.publishError;
    if (error?.urlErrors) {
      return error.urlErrors.get(url) || null;
    }
    return null;
  };

  get publishErrorForCustomSubdomain() {
    if (!this.claimedDomainPublishedUrl) {
      return null;
    }
    return this.getPublishErrorForUrl(this.claimedDomainPublishedUrl);
  }

  ensureInitialSelectionsTask = restartableTask(
    async (claim: ClaimedDomain | null = null) => {
      await this.realm.ensureRealmMeta(this.currentRealmURL);
      this.applyInitialSelections(claim);
    },
  );

  private applyInitialSelections(claim: ClaimedDomain | null = null) {
    let selections = this.initialSelectionsSet
      ? this.selectedPublishedRealmURLs
      : [...this.hostModeService.publishedRealmURLs];

    if (claim) {
      let claimedUrl = this.buildPublishedRealmUrl(claim.hostname);
      if (!selections.includes(claimedUrl)) {
        selections = [...selections, claimedUrl];
      }
    }

    if (
      !this.initialSelectionsSet ||
      selections !== this.selectedPublishedRealmURLs
    ) {
      this.selectedPublishedRealmURLs = [...selections];
    }

    this.initialSelectionsSet = true;
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
              checked={{this.isSubdirectoryRealmSelected}}
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
                  <span
                    class='url-part'
                  >{{this.subdirectoryRealmParts.baseUrl}}</span><span
                    class='url-part-bold'
                  >{{this.subdirectoryRealmParts.realmName}}/</span>
                </span>
                {{#if this.isSubdirectoryRealmPublished}}
                  <div class='domain-info'>
                    <span
                      class='last-published-at'
                      data-test-last-published-at
                    >Published
                      {{this.lastPublishedTime}}</span>
                    <BoxelButton
                      @kind='text-only'
                      @size='extra-small'
                      @disabled={{this.isUnpublishingRealm
                        this.subdirectoryRealmUrl
                      }}
                      class='unpublish-button'
                      {{on
                        'click'
                        (fn @handleUnpublish this.subdirectoryRealmUrl)
                      }}
                      data-test-unpublish-button
                    >
                      {{#if
                        (this.isUnpublishingRealm this.subdirectoryRealmUrl)
                      }}
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
            {{#if this.isSubdirectoryRealmPublished}}
              <BoxelButton
                @as='anchor'
                @kind='secondary-light'
                @size='small'
                @href={{this.subdirectoryRealmUrl}}
                @disabled={{this.isUnpublishingAnyRealms}}
                class='action'
                target='_blank'
                rel='noopener noreferrer'
                data-test-open-boxel-space-button
              >
                <ExternalLink width='16' height='16' class='button-icon' />
                Open Site
              </BoxelButton>
            {{/if}}
            {{#if (this.getPublishErrorForUrl this.subdirectoryRealmUrl)}}
              <div
                class='domain-publish-error'
                data-test-domain-publish-error={{this.subdirectoryRealmUrl}}
              >
                <span class='error-text'>{{this.getPublishErrorForUrl
                    this.subdirectoryRealmUrl
                  }}</span>
              </div>
            {{/if}}
          </div>

          <div class='domain-option'>
            <input
              type='checkbox'
              id='custom-subdomain-checkbox'
              class='domain-checkbox'
              checked={{this.isCustomSubdomainSelected}}
              data-test-custom-subdomain-checkbox
              disabled={{not this.claimedDomain}}
              {{on 'change' this.toggleCustomSubdomain}}
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
            <div
              class='domain-details
                {{if this.isCustomSubdomainSetupVisible "full-width"}}'
              data-test-custom-subdomain-details
            >
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
                    <BoxelButton
                      @kind='primary'
                      @size='small'
                      class='claim-custom-subdomain-button'
                      @disabled={{this.isClaimCustomSubdomainDisabled}}
                      {{on
                        'click'
                        (perform this.handleClaimCustomSubdomainTask)
                      }}
                      data-test-claim-custom-subdomain-button
                    >
                      {{#if this.isCheckingCustomSubdomain}}
                        <LoadingIndicator />
                        Checking…
                      {{else}}
                        Claim Site Name
                      {{/if}}
                    </BoxelButton>
                  </div>
                </div>
              {{else if this.claimedDomain}}
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
                  {{#if this.claimedDomain}}
                    <div class='domain-info'>
                      {{#if this.claimedDomainLastPublishedTime}}
                        <span class='last-published-at'>Published
                          {{this.claimedDomainLastPublishedTime}}</span>
                        {{#if this.claimedDomainPublishedUrl}}
                          <BoxelButton
                            @kind='text-only'
                            @size='extra-small'
                            @disabled={{this.isUnpublishingRealm
                              this.claimedDomainPublishedUrl
                            }}
                            class='unpublish-button'
                            {{on
                              'click'
                              (fn
                                @handleUnpublish this.claimedDomainPublishedUrl
                              )
                            }}
                            data-test-unpublish-custom-subdomain-button
                          >
                            {{#if
                              (this.isUnpublishingRealm
                                this.claimedDomainPublishedUrl
                              )
                            }}
                              <LoadingIndicator />
                              Unpublishing…
                            {{else}}
                              <Undo2
                                width='11'
                                height='11'
                                class='unpublish-icon'
                              />
                              Unpublish
                            {{/if}}
                          </BoxelButton>
                        {{/if}}
                      {{else}}
                        <span class='not-published-yet'>Not published yet</span>
                      {{/if}}
                      {{#if this.shouldShowUnclaimDomainButton}}
                        <BoxelButton
                          @kind='text-only'
                          @size='extra-small'
                          class='unpublish-button unclaim-button'
                          @disabled={{this.isUnclaimDomainButtonDisabled}}
                          {{on
                            'click'
                            (perform this.handleUnclaimCustomSubdomainTask)
                          }}
                          data-test-unclaim-custom-subdomain-button
                        >
                          {{#if
                            this.handleUnclaimCustomSubdomainTask.isRunning
                          }}
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

            {{#if (not this.isCustomSubdomainSetupVisible)}}
              {{#if this.isClaimedDomainPublished}}
                <BoxelButton
                  @as='anchor'
                  @kind='secondary-light'
                  @size='small'
                  @href={{this.customSubdomainIndexUrl}}
                  @disabled={{this.isUnpublishingAnyRealms}}
                  class='action'
                  target='_blank'
                  rel='noopener noreferrer'
                  data-test-open-custom-subdomain-button
                >
                  <ExternalLink width='16' height='16' class='button-icon' />
                  Open Site
                </BoxelButton>
              {{else if (not this.claimedDomain)}}
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
            {{/if}}
            {{#if this.publishErrorForCustomSubdomain}}
              <div
                class='domain-publish-error'
                data-test-domain-publish-error={{this.claimedDomainPublishedUrl}}
              >
                <span
                  class='error-text'
                >{{this.publishErrorForCustomSubdomain}}</span>
              </div>
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
          '.        . details action'
          '.        . error   error';

        grid-template-columns: auto var(--boxel-sp-sm) 1fr auto;

        align-items: center;
        padding-top: var(--boxel-sp-lg);
        padding-bottom: var(--boxel-sp-xl);
        border: 1px solid transparent;
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
        margin-top: var(--boxel-sp);
      }

      .domain-details.full-width {
        grid-column: 3 / -1;
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
        --boxel-button-min-height: 0;
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
        text-decoration: none;
      }

      .action.disabled {
        pointer-events: none;
        opacity: 0.5;
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
      }

      .custom-subdomain-row :deep(.container) {
        flex: 1;
      }

      .custom-subdomain-row .claim-custom-subdomain-button {
        flex-shrink: 0;
      }

      .custom-domain-suffix {
        color: var(--boxel-450);
      }

      .custom-subdomain-cancel {
        gap: var(--boxel-sp-xxxs);
        margin-left: auto;
      }

      .domain-publish-error {
        grid-area: error;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        margin-top: var(--boxel-sp-xs);
      }

      .domain-publish-error .error-text {
        flex: 1;
        color: var(--boxel-error-200);
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
      }
    </style>
  </template>
}
