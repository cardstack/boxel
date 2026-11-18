import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Alert } from '@cardstack/pretui/components/alert';
import { Button } from '@cardstack/pretui/components/button';
import { Chip } from '@cardstack/pretui/components/chip';
import { Input } from '@cardstack/pretui/components/input';
import { RadioGroup } from '@cardstack/pretui/components/radio-group';
import { restartableTask, task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import {
  deriveRealmName,
  ensureTrailingSlash,
  resolvePublishedRealmUrl,
} from '@cardstack/runtime-common';
import { getPublishedRealmDomainOverrides } from '@cardstack/runtime-common/constants';

import ModalContainer from '@cardstack/host/components/modal-container';
import config from '@cardstack/host/config/environment';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type {
  ClaimedDomain,
  HomePageCheck,
  HostURL,
  HostURLKind,
} from '@cardstack/host/services/realm-server';

// Host Mode v2's publish dialog. It lists the addresses a realm is mounted at
// (its host URLs), mounts it at more, marks one canonical and unmounts them
// (ADR 033). A host URL serves the realm live, so there is nothing to publish
// and no progress to show. Sites published with v1 are frozen copies: the
// dialog lists them with one action, Remove.

interface Signature {
  Element: HTMLElement;
  Args: {
    isOpen: boolean;
    onClose: () => void;
    realmURL: string;
    // The realm's sites published with v1.
    v1SiteURLs: string[];
    removeV1Site: (url: string) => Promise<void>;
  };
}

interface MountTarget {
  kind: HostURLKind;
  label: string;
  url: string;
}

export default class HostURLManager extends Component<Signature> {
  @service declare private matrixService: MatrixService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @tracked private hostURLs: HostURL[] = [];
  @tracked private homePage: HomePageCheck | undefined;
  @tracked private claimedDomain: ClaimedDomain | null = null;
  @tracked private siteName = '';
  @tracked private loadError: string | undefined;
  // The reason the last change was refused, keyed by the URL it was for.
  @tracked private errors = new Map<string, string>();
  // The canonical host URL being removed, while the user picks the new one.
  @tracked private replacingCanonical: HostURL | undefined;
  @tracked private newCanonicalId: string | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.loadTask.perform();
  }

  private loadTask = restartableTask(async () => {
    this.loadError = undefined;
    try {
      let [hostURLs, homePage, claimedDomain] = await Promise.all([
        this.realmServer.listHostURLs(this.args.realmURL),
        this.realmServer.checkHomePage(this.args.realmURL),
        this.realmServer.fetchBoxelClaimedDomain(this.args.realmURL),
      ]);
      this.hostURLs = hostURLs;
      this.homePage = homePage;
      this.claimedDomain = claimedDomain;
    } catch (error) {
      this.loadError = messageOf(error);
    }
  });

  private get isLoading() {
    return this.loadTask.isRunning && !this.homePage;
  }

  private get canMount() {
    return this.homePage?.anonymousCanView ?? false;
  }

  private get canGrantPublicRead() {
    return this.realm.canWrite(this.args.realmURL);
  }

  private get spaceURL(): string {
    let matrixUsername = this.matrixService.userName;
    if (!matrixUsername) {
      throw new Error('Matrix username is not available');
    }
    return resolvePublishedRealmUrl(
      { type: 'subdirectory', name: this.realmName },
      {
        protocol: 'https',
        matrixUsername,
        spaceDomain: config.publishedRealmBoxelSpaceDomain,
      },
    );
  }

  // The server requires this name in a Boxel Space host URL.
  private get realmName(): string {
    return deriveRealmName(this.args.realmURL);
  }

  private get siteDomain() {
    return config.publishedRealmBoxelSiteDomain;
  }

  private get customDomainURL(): string | undefined {
    let domain = getPublishedRealmDomainOverrides(
      config.publishedRealmDomainOverrides,
    )[ensureTrailingSlash(this.args.realmURL)];
    return domain ? `https://${domain}/` : undefined;
  }

  // The addresses the realm can be mounted at, and isn't yet.
  private get mountTargets(): MountTarget[] {
    let targets: MountTarget[] = [
      { kind: 'boxel-space', label: 'Boxel Space', url: this.spaceURL },
    ];
    if (this.claimedDomain) {
      targets.push({
        kind: 'site-name',
        label: 'Site name',
        url: `https://${this.claimedDomain.hostname}/`,
      });
    }
    if (this.customDomainURL) {
      targets.push({
        kind: 'custom-domain',
        label: 'Custom domain',
        url: this.customDomainURL,
      });
    }
    return targets.filter(({ url }) => !this.isMounted(url));
  }

  private get showsSiteNameClaim() {
    return !this.claimedDomain;
  }

  private get siteNameURL() {
    return `https://${this.siteName.trim()}.${this.siteDomain}/`;
  }

  private isMounted(url: string) {
    return this.hostURLs.some(
      (hostURL) => ensureTrailingSlash(hostURL.url) === url,
    );
  }

  private get newCanonicalOptions() {
    return this.hostURLs
      .filter(({ id }) => id !== this.replacingCanonical?.id)
      .map(({ id, url }) => ({ value: id, label: url }));
  }

  private errorFor = (url: string) => this.errors.get(url);

  private setError(url: string, error: unknown) {
    let errors = new Map(this.errors);
    if (error === undefined) {
      errors.delete(url);
    } else {
      errors.set(url, messageOf(error));
    }
    this.errors = errors;
  }

  private refreshHostURLs = async () => {
    this.hostURLs = await this.realmServer.listHostURLs(this.args.realmURL);
  };

  private mountTask = task(async (url: string) => {
    this.setError(url, undefined);
    try {
      await this.realmServer.mountHostURL(this.args.realmURL, url);
      await this.refreshHostURLs();
    } catch (error) {
      this.setError(url, error);
    }
  });

  // Claims the site name, then mounts the realm there.
  private claimSiteNameTask = task(async () => {
    let url = this.siteNameURL;
    this.setError(url, undefined);
    try {
      await this.realmServer.claimBoxelDomain(
        this.args.realmURL,
        new URL(url).hostname,
      );
      this.claimedDomain = await this.realmServer.fetchBoxelClaimedDomain(
        this.args.realmURL,
      );
      this.siteName = '';
    } catch (error) {
      this.setError(url, error);
      return;
    }
    await this.mountTask.perform(url);
  });

  private setCanonicalTask = task(async (hostURL: HostURL) => {
    this.setError(hostURL.url, undefined);
    try {
      await this.realmServer.setCanonicalHostURL(hostURL.id);
      await this.refreshHostURLs();
    } catch (error) {
      this.setError(hostURL.url, error);
    }
  });

  @action
  private removeHostURL(hostURL: HostURL) {
    // The canonical host URL goes last (ADR 033 §1.4): the user picks the new
    // canonical one first.
    if (hostURL.isCanonical && this.hostURLs.length > 1) {
      this.replacingCanonical = hostURL;
      this.newCanonicalId = undefined;
      return;
    }
    this.unmountTask.perform(hostURL);
  }

  @action
  private chooseNewCanonical(id: string) {
    this.newCanonicalId = id;
  }

  @action
  private cancelReplacingCanonical() {
    this.replacingCanonical = undefined;
    this.newCanonicalId = undefined;
  }

  private replaceCanonicalTask = task(async () => {
    let removed = this.replacingCanonical;
    let next = this.hostURLs.find(({ id }) => id === this.newCanonicalId);
    if (!removed || !next) {
      return;
    }
    try {
      await this.realmServer.setCanonicalHostURL(next.id);
      await this.realmServer.unmountHostURL(removed.id);
      this.replacingCanonical = undefined;
      this.newCanonicalId = undefined;
    } catch (error) {
      this.setError(removed.url, error);
    }
    await this.refreshHostURLs();
  });

  private unmountTask = task(async (hostURL: HostURL) => {
    this.setError(hostURL.url, undefined);
    try {
      await this.realmServer.unmountHostURL(hostURL.id);
      await this.refreshHostURLs();
      if (hostURL.kind === 'site-name') {
        // Unmounting a site name frees it.
        this.claimedDomain = await this.realmServer.fetchBoxelClaimedDomain(
          this.args.realmURL,
        );
      }
    } catch (error) {
      this.setError(hostURL.url, error);
    }
  });

  private grantPublicReadTask = task(async () => {
    try {
      await this.realm.grantPublicRead(this.args.realmURL);
      this.homePage = await this.realmServer.checkHomePage(this.args.realmURL);
    } catch (error) {
      this.loadError = messageOf(error);
    }
  });

  private removeV1SiteTask = task(async (url: string) => {
    this.setError(url, undefined);
    try {
      await this.args.removeV1Site(url);
    } catch (error) {
      this.setError(url, error);
    }
  });

  @action
  private mount(url: string) {
    this.mountTask.perform(url);
  }

  @action
  private setCanonical(hostURL: HostURL) {
    this.setCanonicalTask.perform(hostURL);
  }

  @action
  private grantPublicRead() {
    this.grantPublicReadTask.perform();
  }

  @action
  private removeV1Site(url: string) {
    this.removeV1SiteTask.perform(url);
  }

  @action
  private updateSiteName(value: string) {
    this.siteName = value;
  }

  <template>
    <ModalContainer
      class='host-url-manager'
      @title='Host URLs'
      @size='medium'
      @isOpen={{@isOpen}}
      @onClose={{@onClose}}
      data-test-host-url-manager
      ...attributes
    >
      <:header>
        <p class='subtitle'>
          The addresses this realm is served at. Each one shows the realm live:
          a change in the realm shows on its pages at once.
        </p>
      </:header>
      <:content>
        {{#if this.isLoading}}
          <p class='muted' data-test-host-urls-loading>Loading…</p>
        {{else}}
          {{#if this.loadError}}
            <Alert @tone='danger' data-test-host-urls-load-error>
              {{this.loadError}}
            </Alert>
          {{/if}}

          <section class='section' aria-labelledby='host-urls-mounted'>
            <h3 id='host-urls-mounted' class='section-title'>Mounted at</h3>
            {{#if this.hostURLs.length}}
              <ul class='rows'>
                {{#each this.hostURLs as |hostURL|}}
                  <li class='row' data-test-host-url={{hostURL.url}}>
                    <div class='row-main'>
                      <a
                        class='url'
                        href={{hostURL.url}}
                        target='_blank'
                        rel='noopener noreferrer'
                      >{{hostURL.url}}</a>
                      {{#if hostURL.isCanonical}}
                        <Chip
                          @label='Canonical'
                          @tone='success'
                          data-test-host-url-canonical
                        />
                      {{/if}}
                    </div>
                    <div class='row-actions'>
                      {{#unless hostURL.isCanonical}}
                        <Button
                          @variant='ghost'
                          @size='sm'
                          @busy={{this.setCanonicalTask.isRunning}}
                          {{on 'click' (fn this.setCanonical hostURL)}}
                          data-test-make-canonical={{hostURL.url}}
                        >Make canonical</Button>
                      {{/unless}}
                      <Button
                        @variant='outline'
                        @size='sm'
                        @busy={{this.unmountTask.isRunning}}
                        {{on 'click' (fn this.removeHostURL hostURL)}}
                        data-test-remove-host-url={{hostURL.url}}
                      >Remove</Button>
                    </div>
                    {{#let (this.errorFor hostURL.url) as |error|}}
                      {{#if error}}
                        <p
                          class='row-error'
                          role='alert'
                          data-test-host-url-error={{hostURL.url}}
                        >{{error}}</p>
                      {{/if}}
                    {{/let}}
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class='muted' data-test-no-host-urls>
                This realm is not mounted at a host URL yet.
              </p>
            {{/if}}

            {{#if this.replacingCanonical}}
              <div class='replace-canonical' data-test-replace-canonical>
                <p id='host-urls-new-canonical' class='replace-prompt'>
                  {{this.replacingCanonical.url}}
                  is canonical. Choose the new canonical host URL before you
                  remove it.
                </p>
                <RadioGroup
                  @options={{this.newCanonicalOptions}}
                  @value={{this.newCanonicalId}}
                  @onValueChange={{this.chooseNewCanonical}}
                  aria-labelledby='host-urls-new-canonical'
                  data-test-new-canonical
                />
                <div class='row-actions'>
                  <Button
                    @variant='ghost'
                    @size='sm'
                    {{on 'click' this.cancelReplacingCanonical}}
                    data-test-cancel-replace-canonical
                  >Cancel</Button>
                  <Button
                    @variant='destructive'
                    @size='sm'
                    @disabled={{this.isReplaceDisabled}}
                    @busy={{this.replaceCanonicalTask.isRunning}}
                    {{on 'click' (perform this.replaceCanonicalTask)}}
                    data-test-confirm-replace-canonical
                  >Remove</Button>
                </div>
              </div>
            {{/if}}
          </section>

          <section class='section' aria-labelledby='host-urls-home-page'>
            <h3 id='host-urls-home-page' class='section-title'>Who can see it</h3>
            {{#if this.homePage}}
              {{#if this.homePage.anonymousCanView}}
                <p data-test-home-page-viewable>
                  Visitors who are not signed in can view the home page.
                </p>
              {{else}}
                <Alert
                  @tone='warning'
                  @title='The realm can’t be mounted yet'
                  data-test-home-page-not-viewable
                >
                  {{#if this.homePage.redirectTo}}
                    Its home page redirects to
                    {{this.homePage.redirectTo}}, so there is no home page to
                    show.
                  {{else}}
                    Visitors who are not signed in can’t view its home page.
                    {{#unless this.homePage.homeCardReadable}}
                      They can’t read the home card,
                      {{this.homePage.homeCardId}}.
                    {{/unless}}
                    {{#if this.homePage.unloadableModules.length}}
                      They can’t load this code, which needs a
                      <code>readSource</code>
                      grant:
                      <ul class='modules' data-test-unloadable-modules>
                        {{#each this.homePage.unloadableModules as |module|}}
                          <li><code>{{module.url}}</code></li>
                        {{/each}}
                      </ul>
                    {{/if}}
                  {{/if}}
                </Alert>
                {{#if this.canGrantPublicRead}}
                  <div class='grant'>
                    <Button
                      @variant='primary'
                      @size='sm'
                      @busy={{this.grantPublicReadTask.isRunning}}
                      {{on 'click' this.grantPublicRead}}
                      data-test-grant-public-read
                    >Let everyone read this realm</Button>
                  </div>
                {{/if}}
              {{/if}}
            {{/if}}
            <p class='muted' data-test-visibility-note>
              Visitors who are not signed in can read and run what the realm’s
              permissions and policy let them. The pages show what you can read,
              including cards from other realms.
            </p>
          </section>

          <section class='section' aria-labelledby='host-urls-add'>
            <h3 id='host-urls-add' class='section-title'>Mount at</h3>
            <ul class='rows'>
              {{#each this.mountTargets as |target|}}
                <li class='row' data-test-mount-target={{target.kind}}>
                  <div class='row-main'>
                    <span class='target-label'>{{target.label}}</span>
                    <span class='url'>{{target.url}}</span>
                  </div>
                  <div class='row-actions'>
                    <Button
                      @variant='primary'
                      @size='sm'
                      @disabled={{this.isMountDisabled}}
                      @busy={{this.mountTask.isRunning}}
                      {{on 'click' (fn this.mount target.url)}}
                      data-test-mount={{target.kind}}
                    >Mount</Button>
                  </div>
                  {{#let (this.errorFor target.url) as |error|}}
                    {{#if error}}
                      <p
                        class='row-error'
                        role='alert'
                        data-test-mount-error={{target.kind}}
                      >{{error}}</p>
                    {{/if}}
                  {{/let}}
                </li>
              {{/each}}
              {{#if this.showsSiteNameClaim}}
                <li class='row' data-test-mount-target='site-name-claim'>
                  <div class='row-main'>
                    <label class='target-label' for='host-url-site-name'>Site
                      name</label>
                    <div class='site-name'>
                      <Input
                        @controlId='host-url-site-name'
                        @value={{this.siteName}}
                        placeholder='your-site'
                        @onInput={{this.updateSiteName}}
                        data-test-site-name-input
                      />
                      <span class='muted'>.{{this.siteDomain}}</span>
                    </div>
                  </div>
                  <div class='row-actions'>
                    <Button
                      @variant='primary'
                      @size='sm'
                      @disabled={{this.isClaimDisabled}}
                      @busy={{this.claimSiteNameTask.isRunning}}
                      {{on 'click' (perform this.claimSiteNameTask)}}
                      data-test-claim-site-name
                    >Claim and mount</Button>
                  </div>
                  {{#let (this.errorFor this.siteNameURL) as |error|}}
                    {{#if error}}
                      <p
                        class='row-error'
                        role='alert'
                        data-test-mount-error='site-name-claim'
                      >{{error}}</p>
                    {{/if}}
                  {{/let}}
                </li>
              {{/if}}
            </ul>
          </section>

          {{#if @v1SiteURLs.length}}
            <section class='section' aria-labelledby='host-urls-v1'>
              <h3 id='host-urls-v1' class='section-title'>Published with the old
                publishing</h3>
              <p class='muted'>
                These sites are frozen copies. They don’t show changes to the
                realm.
              </p>
              <ul class='rows'>
                {{#each @v1SiteURLs as |url|}}
                  <li class='row' data-test-v1-site={{url}}>
                    <div class='row-main'>
                      <a
                        class='url'
                        href={{url}}
                        target='_blank'
                        rel='noopener noreferrer'
                      >{{url}}</a>
                    </div>
                    <div class='row-actions'>
                      <Button
                        @variant='outline'
                        @size='sm'
                        @busy={{this.removeV1SiteTask.isRunning}}
                        {{on 'click' (fn this.removeV1Site url)}}
                        data-test-remove-v1-site={{url}}
                      >Remove</Button>
                    </div>
                    {{#let (this.errorFor url) as |error|}}
                      {{#if error}}
                        <p class='row-error' role='alert'>{{error}}</p>
                      {{/if}}
                    {{/let}}
                  </li>
                {{/each}}
              </ul>
            </section>
          {{/if}}
        {{/if}}
      </:content>
    </ModalContainer>

    <style scoped>
      .subtitle,
      .muted {
        margin: 0;
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-lg);
      }
      .section-title {
        margin: 0;
        font-size: var(--boxel-font-size);
        font-weight: 600;
        line-height: var(--boxel-line-height);
      }
      .rows {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--boxel-sp-xs) var(--boxel-sp);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
      }
      .row-main {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .row-actions {
        display: flex;
        gap: var(--boxel-sp-xs);
        justify-content: flex-end;
      }
      .row-error {
        grid-column: 1 / -1;
        margin: 0;
        color: var(--destructive-ink);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .url {
        overflow-wrap: anywhere;
      }
      .target-label {
        font-weight: 600;
      }
      .site-name {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }
      .modules {
        margin: var(--boxel-sp-xxs) 0 0;
        padding-inline-start: var(--boxel-sp);
      }
      .modules code {
        overflow-wrap: anywhere;
      }
      .replace-canonical {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
      }
      .grant {
        display: flex;
        justify-content: flex-end;
      }
      .replace-prompt {
        margin: 0;
        overflow-wrap: anywhere;
      }
    </style>
  </template>

  private get isMountDisabled() {
    return !this.canMount || this.mountTask.isRunning;
  }

  private get isClaimDisabled() {
    return (
      !this.canMount ||
      !this.siteName.trim() ||
      this.claimSiteNameTask.isRunning
    );
  }

  private get isReplaceDisabled() {
    return !this.newCanonicalId;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
