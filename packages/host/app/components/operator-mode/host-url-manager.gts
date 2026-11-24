import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Alert } from '@cardstack/pretui/components/alert';
import { Button } from '@cardstack/pretui/components/button';
import { Chip } from '@cardstack/pretui/components/chip';
import { Input as PretInput } from '@cardstack/pretui/components/input';
import { RadioGroup } from '@cardstack/pretui/components/radio-group';
import { ToastStore, Toaster } from '@cardstack/pretui/components/toaster';
import { Tooltip } from '@cardstack/pretui/components/tooltip';
import { Link } from '@cardstack/pretui/components/typography';
import { restartableTask, task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import { modifier } from 'ember-modifier';

import { ensureTrailingSlash } from '@cardstack/runtime-common';
import { getPublishedRealmDomainOverrides } from '@cardstack/runtime-common/constants';

import ModalContainer from '@cardstack/host/components/modal-container';
import config from '@cardstack/host/config/environment';

import type HostURLService from '@cardstack/host/services/host-url-service';
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

interface ContentArgs {
  realmURL: string;
  // The realm's sites published with v1.
  v1SiteURLs: string[];
  removeV1Site: (url: string) => Promise<void>;
}

interface Signature {
  Element: HTMLElement;
  Args: ContentArgs & {
    isOpen: boolean;
    onClose: () => void;
    // Shown in the dialog, so the user can see which realm it changes.
    realmName: string;
  };
}

// A host URL as the manager shows it: without its scheme. Its link still goes
// to the full URL.
function displayURL(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

// A URL's host and path, which name an address whatever its scheme. The
// manager builds `https://` URLs, and the realm server gives a host URL the
// scheme it is served with.
function hostAndPath(url: string): string {
  let parsed = new URL(url);
  return `${parsed.host}${ensureTrailingSlash(parsed.pathname)}`;
}

const CANONICAL_EXPLANATION =
  'The main address of this realm. Search engines, link previews and the sitemap use it, whichever address a visitor opens.';
const MAKE_CANONICAL_EXPLANATION =
  'Make this the main address of this realm. Search engines, link previews and the sitemap will use it.';

// Moves focus to a confirmation when it opens, so a keyboard or screen
// reader user is taken to the choice that waits there.
const focusOnInsert = modifier((element: HTMLElement) => {
  element.focus();
});

interface MountTarget {
  kind: HostURLKind;
  label: string;
  url: string;
}

// The dialog's content. The modal renders it only while the dialog is open,
// so each opening loads the host URLs and the home page check again. The
// host URLs are kept in the host URL service, which the Open Site button
// also reads, and each change goes through it.
class HostURLs extends Component<{ Args: ContentArgs }> {
  @service declare private hostUrlService: HostURLService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @tracked private homePage: HomePageCheck | undefined;
  @tracked private claimedDomain: ClaimedDomain | null = null;
  @tracked private siteName = '';
  @tracked private loadError: string | undefined;
  @tracked private grantError: string | undefined;
  // The reason the last change was refused, keyed by the URL it was for.
  @tracked private errors = new Map<string, string>();
  // The URL a change is being made to. Its row shows the change as busy, and
  // the other rows' actions wait.
  @tracked private pendingURL: string | undefined;
  // The host URL whose unmount waits for the user to confirm it.
  @tracked private unmounting: HostURL | undefined;
  // The new canonical host URL the user picked, when the canonical one is
  // unmounted and more than one other remains.
  @tracked private newCanonicalId: string | undefined;
  // The v1 site whose removal waits for the user to confirm it.
  @tracked private removingV1Site: string | undefined;
  private toasts = new ToastStore();

  constructor(owner: Owner, args: ContentArgs) {
    super(owner, args);
    this.loadTask.perform();
  }

  private loadTask = restartableTask(async () => {
    this.loadError = undefined;
    try {
      let [, homePage, claimedDomain] = await Promise.all([
        this.hostUrlService.refresh(this.args.realmURL),
        this.realmServer.checkHomePage(this.args.realmURL),
        this.realmServer.fetchBoxelClaimedDomain(this.args.realmURL),
      ]);
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

  // A public-read grant fixes a home page that visitors can't read. A root
  // that redirects serves no home page, and a grant leaves it redirecting.
  private get canGrantPublicRead() {
    return (
      !this.homePage?.redirectTo && this.realm.canWrite(this.args.realmURL)
    );
  }

  private get hostURLs(): HostURL[] {
    return this.hostUrlService.hostURLsFor(this.args.realmURL);
  }

  // The Boxel Space URL the realm can be mounted at, in its owner's Space.
  private get boxelSpaceURL(): string | undefined {
    return this.hostUrlService.stateFor(this.args.realmURL)?.boxelSpaceURL;
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
    let targets: MountTarget[] = [];
    if (this.boxelSpaceURL) {
      targets.push({
        kind: 'boxel-space',
        label: 'Boxel Space',
        url: this.boxelSpaceURL,
      });
    }
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

  private get hasMountTargets() {
    return this.mountTargets.length > 0 || this.showsSiteNameClaim;
  }

  private get showsSiteNameClaim() {
    return !this.claimedDomain;
  }

  private get siteNameURL() {
    return `https://${this.siteName.trim()}.${this.siteDomain}/`;
  }

  private isMounted(url: string) {
    let address = hostAndPath(url);
    return this.hostURLs.some(
      (hostURL) => hostAndPath(hostURL.url) === address,
    );
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

  private isPending = (url: string) => this.pendingURL === url;

  // Whether a change to another URL is running, so this row's actions wait.
  private waitsForOther = (url: string) =>
    this.pendingURL !== undefined && this.pendingURL !== url;

  // Runs a change to `url`, and marks that URL busy while it runs.
  private async changing(url: string, change: () => Promise<void>) {
    this.pendingURL = url;
    try {
      await change();
    } finally {
      this.pendingURL = undefined;
    }
  }

  private refreshHostURLs = async () => {
    await this.hostUrlService.refresh(this.args.realmURL);
  };

  private mountTask = task(async (url: string) => {
    this.setError(url, undefined);
    await this.changing(url, async () => {
      try {
        await this.hostUrlService.mount(this.args.realmURL, url);
      } catch (error) {
        this.setError(url, error);
      }
    });
  });

  // Claims the site name, then mounts the realm there.
  private claimSiteNameTask = task(async () => {
    let url = this.siteNameURL;
    this.setError(url, undefined);
    let claimed = false;
    await this.changing(url, async () => {
      try {
        await this.realmServer.claimBoxelDomain(
          this.args.realmURL,
          new URL(url).hostname,
        );
        this.claimedDomain = await this.realmServer.fetchBoxelClaimedDomain(
          this.args.realmURL,
        );
        this.siteName = '';
        claimed = true;
      } catch (error) {
        this.setError(url, error);
      }
    });
    if (claimed) {
      await this.mountTask.perform(url);
    }
  });

  private setCanonicalTask = task(async (hostURL: HostURL) => {
    this.setError(hostURL.url, undefined);
    await this.changing(hostURL.url, async () => {
      try {
        await this.hostUrlService.setCanonical(this.args.realmURL, hostURL.id);
      } catch (error) {
        this.setError(hostURL.url, error);
      }
    });
  });

  // ── Unmount, after the user confirms it ──

  private isConfirmingUnmount = (hostURL: HostURL) =>
    this.unmounting?.id === hostURL.id;

  private isSiteName = (hostURL: HostURL) => hostURL.kind === 'site-name';

  private get otherHostURLs(): HostURL[] {
    let unmounting = this.unmounting;
    return unmounting
      ? this.hostURLs.filter(({ id }) => id !== unmounting.id)
      : [];
  }

  // The canonical host URL goes last (ADR 033 §1.4): another one is made
  // canonical first. With one other, it is that one; with more, the user
  // picks.
  private get choosesNewCanonical(): boolean {
    return (
      Boolean(this.unmounting?.isCanonical) && this.otherHostURLs.length > 1
    );
  }

  // The host URL that becomes canonical when the canonical one is unmounted.
  // Undefined while the user has yet to pick it, and when the URL being
  // unmounted isn't canonical or is the only one.
  private get newCanonical(): HostURL | undefined {
    if (!this.unmounting?.isCanonical) {
      return undefined;
    }
    let others = this.otherHostURLs;
    if (others.length === 1) {
      return others[0];
    }
    return others.find(({ id }) => id === this.newCanonicalId);
  }

  private get newCanonicalOptions() {
    return this.otherHostURLs.map(({ id, url }) => ({
      value: id,
      label: displayURL(url),
    }));
  }

  private get isConfirmUnmountDisabled() {
    return this.choosesNewCanonical && !this.newCanonical;
  }

  @action
  private askToUnmount(hostURL: HostURL) {
    this.removingV1Site = undefined;
    this.unmounting = hostURL;
    this.newCanonicalId = undefined;
  }

  @action
  private chooseNewCanonical(id: string) {
    this.newCanonicalId = id;
  }

  @action
  private cancelUnmount() {
    this.unmounting = undefined;
    this.newCanonicalId = undefined;
  }

  @action
  private confirmUnmount() {
    let hostURL = this.unmounting;
    if (hostURL && !this.isConfirmUnmountDisabled) {
      this.unmountTask.perform(hostURL, this.newCanonical);
    }
  }

  // Makes `newCanonical` canonical when it is given, then unmounts `hostURL`.
  // A toast says when the canonical host URL moved, including when the
  // unmount is then refused.
  private unmountTask = task(
    async (hostURL: HostURL, newCanonical: HostURL | undefined) => {
      this.setError(hostURL.url, undefined);
      let movedCanonical = false;
      let unmounted = false;
      await this.changing(hostURL.url, async () => {
        try {
          if (newCanonical) {
            await this.hostUrlService.setCanonical(
              this.args.realmURL,
              newCanonical.id,
            );
            movedCanonical = true;
          }
          await this.hostUrlService.unmount(this.args.realmURL, hostURL.id);
          unmounted = true;
          this.cancelUnmount();
          await this.afterUnmount(hostURL);
        } catch (error) {
          this.cancelUnmount();
          this.setError(hostURL.url, error);
          if (movedCanonical) {
            await this.refreshAfterRefusal();
          }
        }
      });
      if (newCanonical && movedCanonical) {
        this.toasts.show({
          title: `${displayURL(newCanonical.url)} is now the canonical host URL`,
          message: unmounted
            ? `It took over from ${displayURL(hostURL.url)}, which was unmounted.`
            : `It took over from ${displayURL(hostURL.url)}, which was not unmounted.`,
          tone: unmounted ? 'success' : 'warning',
        });
      }
    },
  );

  // After a refused unmount moved the canonical host URL, rereads the host
  // URLs so the canonical mark is right. The row already shows why the
  // unmount failed, so a failed reread adds nothing more to show.
  private async refreshAfterRefusal() {
    try {
      await this.refreshHostURLs();
    } catch {
      // The row's error is the message the user needs.
    }
  }

  // Rereads the site name claim, which unmounting a site name frees. The
  // host URL service has already reread the host URLs.
  private async afterUnmount(hostURL: HostURL) {
    if (hostURL.kind === 'site-name') {
      this.claimedDomain = await this.realmServer.fetchBoxelClaimedDomain(
        this.args.realmURL,
      );
    }
  }

  // ── Removing a v1 site, after the user confirms it ──

  private isConfirmingRemoval = (url: string) => this.removingV1Site === url;

  @action
  private askToRemoveV1Site(url: string) {
    this.cancelUnmount();
    this.removingV1Site = url;
  }

  @action
  private cancelRemoveV1Site() {
    this.removingV1Site = undefined;
  }

  @action
  private confirmRemoveV1Site() {
    let url = this.removingV1Site;
    if (url) {
      this.removeV1SiteTask.perform(url);
    }
  }

  private removeV1SiteTask = task(async (url: string) => {
    this.setError(url, undefined);
    await this.changing(url, async () => {
      try {
        await this.args.removeV1Site(url);
      } catch (error) {
        this.setError(url, error);
      } finally {
        this.removingV1Site = undefined;
      }
    });
  });

  private grantPublicReadTask = task(async () => {
    this.grantError = undefined;
    try {
      await this.realm.grantPublicRead(this.args.realmURL);
      this.homePage = await this.realmServer.checkHomePage(this.args.realmURL);
    } catch (error) {
      this.grantError = messageOf(error);
    }
  });

  @action
  private load() {
    this.loadTask.perform();
  }

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
  private updateSiteName(value: string) {
    this.siteName = value;
  }

  private get isMountDisabled() {
    return !this.canMount || this.pendingURL !== undefined;
  }

  private get isClaimDisabled() {
    return (
      !this.canMount || !this.siteName.trim() || this.pendingURL !== undefined
    );
  }

  <template>
    {{#if this.isLoading}}
      <p class='muted' data-test-host-urls-loading>Loading…</p>
    {{else if this.loadError}}
      <Alert
        @tone='danger'
        @title='The host URLs could not be loaded'
        data-test-host-urls-load-error
      >
        <:default>{{this.loadError}}</:default>
        <:action>
          <Button
            @tone='neutral'
            @appearance='outlined'
            @size='sm'
            {{on 'click' this.load}}
            data-test-host-urls-retry
          >Retry</Button>
        </:action>
      </Alert>
    {{else}}
      <section class='section' aria-labelledby='host-urls-mounted'>
        <h3 id='host-urls-mounted' class='section-title'>Mounted at</h3>
        {{#if this.hostURLs.length}}
          <p class='muted' data-test-canonical-note>
            The canonical host URL is the realm’s main address. Search engines,
            link previews and the sitemap use it, whichever address a visitor
            opens.
          </p>
          <ul class='rows'>
            {{#each this.hostURLs as |hostURL|}}
              <li class='row' data-test-host-url={{hostURL.url}}>
                <div class='row-main'>
                  <Link
                    class='url'
                    @href={{hostURL.url}}
                    @external={{true}}
                    @variant='quiet'
                  >{{displayURL hostURL.url}}</Link>
                  {{#if hostURL.isCanonical}}
                    <Tooltip class='explain' @content={{CANONICAL_EXPLANATION}}>
                      <Chip
                        @label='Canonical'
                        @tone='success'
                        @dot={{false}}
                        data-test-host-url-canonical
                      />
                    </Tooltip>
                  {{/if}}
                </div>
                <div class='row-actions'>
                  {{#unless hostURL.isCanonical}}
                    <Tooltip
                      class='explain'
                      @content={{MAKE_CANONICAL_EXPLANATION}}
                    >
                      <Button
                        @tone='neutral'
                        @appearance='plain'
                        @size='sm'
                        @busy={{this.isPending hostURL.url}}
                        @disabled={{this.waitsForOther hostURL.url}}
                        {{on 'click' (fn this.setCanonical hostURL)}}
                        data-test-make-canonical={{hostURL.url}}
                      >Make canonical</Button>
                    </Tooltip>
                  {{/unless}}
                  <Button
                    @tone='neutral'
                    @appearance='outlined'
                    @size='sm'
                    @busy={{this.isPending hostURL.url}}
                    @disabled={{this.waitsForOther hostURL.url}}
                    {{on 'click' (fn this.askToUnmount hostURL)}}
                    data-test-unmount-host-url={{hostURL.url}}
                  >Unmount</Button>
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
                {{#if (this.isConfirmingUnmount hostURL)}}
                  <Alert
                    class='confirm'
                    @tone='warning'
                    @title='Unmount this host URL?'
                    role='group'
                    aria-label={{concat 'Unmount ' (displayURL hostURL.url)}}
                    tabindex='-1'
                    {{focusOnInsert}}
                    data-test-confirm-unmount={{hostURL.url}}
                  >
                    <:default>
                      <p class='confirm-text'>
                        {{displayURL hostURL.url}}
                        stops serving this realm at once, and visitors who open
                        it get a not-found page.
                        {{#if (this.isSiteName hostURL)}}
                          Its site name is freed, and anyone can claim it.
                        {{/if}}
                      </p>
                      {{#if this.choosesNewCanonical}}
                        <p id='host-urls-new-canonical' class='confirm-text'>
                          It is canonical. Choose which host URL takes over.
                        </p>
                        <RadioGroup
                          @options={{this.newCanonicalOptions}}
                          @value={{this.newCanonicalId}}
                          @onValueChange={{this.chooseNewCanonical}}
                          aria-labelledby='host-urls-new-canonical'
                          data-test-new-canonical
                        />
                      {{else if this.newCanonical}}
                        <p class='confirm-text' data-test-new-canonical-note>
                          It is canonical, so
                          {{displayURL this.newCanonical.url}}
                          becomes the canonical host URL.
                        </p>
                      {{/if}}
                    </:default>
                    <:action>
                      <Button
                        @tone='neutral'
                        @appearance='plain'
                        @size='sm'
                        {{on 'click' this.cancelUnmount}}
                        data-test-cancel-unmount
                      >Cancel</Button>
                      <Button
                        @tone='danger'
                        @appearance='accent'
                        @size='sm'
                        @disabled={{this.isConfirmUnmountDisabled}}
                        @busy={{this.isPending hostURL.url}}
                        {{on 'click' this.confirmUnmount}}
                        data-test-confirm-unmount-button
                      >Unmount</Button>
                    </:action>
                  </Alert>
                {{/if}}
              </li>
            {{/each}}
          </ul>
        {{else}}
          <p class='muted' data-test-no-host-urls>
            This realm is not mounted at a host URL yet.
          </p>
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
                {{this.homePage.redirectTo}}, so there is no home page to show.
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
                  @tone='primary'
                  @appearance='accent'
                  @size='sm'
                  @busy={{this.grantPublicReadTask.isRunning}}
                  {{on 'click' this.grantPublicRead}}
                  data-test-grant-public-read
                >Let everyone read this realm</Button>
              </div>
              {{#if this.grantError}}
                <p
                  class='row-error'
                  role='alert'
                  data-test-grant-public-read-error
                >{{this.grantError}}</p>
              {{/if}}
            {{/if}}
          {{/if}}
        {{/if}}
        <p class='muted' data-test-visibility-note>
          Visitors who are not signed in can read the cards and run the actions
          that this realm’s permissions and policy open to everyone. A page they
          may read is served as the realm’s owner rendered it, so it can include
          content from other realms that the owner can read and visitors can’t.
        </p>
      </section>

      {{#if this.hasMountTargets}}
        <section
          class='section'
          aria-labelledby='host-urls-add'
          data-test-mount-targets
        >
          <h3 id='host-urls-add' class='section-title'>Mount at</h3>
          <ul class='rows'>
            {{#each this.mountTargets as |target|}}
              <li class='row' data-test-mount-target={{target.kind}}>
                <div class='row-main'>
                  <span class='target-label'>{{target.label}}</span>
                  <span class='url'>{{displayURL target.url}}</span>
                </div>
                <div class='row-actions'>
                  <Button
                    @tone='primary'
                    @appearance='accent'
                    @size='sm'
                    @disabled={{this.isMountDisabled}}
                    @busy={{this.isPending target.url}}
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
                  <label class='target-label' for='host-url-site-name'>Site name</label>
                  <div class='site-name'>
                    <PretInput
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
                    @tone='primary'
                    @appearance='accent'
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
      {{/if}}

      {{#if @v1SiteURLs.length}}
        <section class='section' aria-labelledby='host-urls-v1'>
          <h3 id='host-urls-v1' class='section-title'>Published with the old
            publishing</h3>
          <p class='muted'>
            These sites are frozen copies. They don’t show changes to the realm.
          </p>
          <ul class='rows'>
            {{#each @v1SiteURLs as |url|}}
              <li class='row' data-test-v1-site={{url}}>
                <div class='row-main'>
                  <Link
                    class='url'
                    @href={{url}}
                    @external={{true}}
                    @variant='quiet'
                  >{{displayURL url}}</Link>
                </div>
                <div class='row-actions'>
                  <Button
                    @tone='neutral'
                    @appearance='outlined'
                    @size='sm'
                    @busy={{this.isPending url}}
                    @disabled={{this.waitsForOther url}}
                    {{on 'click' (fn this.askToRemoveV1Site url)}}
                    data-test-remove-v1-site={{url}}
                  >Remove</Button>
                </div>
                {{#let (this.errorFor url) as |error|}}
                  {{#if error}}
                    <p
                      class='row-error'
                      role='alert'
                      data-test-v1-site-error={{url}}
                    >{{error}}</p>
                  {{/if}}
                {{/let}}
                {{#if (this.isConfirmingRemoval url)}}
                  <Alert
                    class='confirm'
                    @tone='warning'
                    @title='Remove this site?'
                    role='group'
                    aria-label={{concat 'Remove ' (displayURL url)}}
                    tabindex='-1'
                    {{focusOnInsert}}
                    data-test-confirm-remove-v1-site={{url}}
                  >
                    <:default>
                      <p class='confirm-text'>
                        The copy published at
                        {{displayURL url}}
                        is deleted, and the address stops serving it.
                      </p>
                    </:default>
                    <:action>
                      <Button
                        @tone='neutral'
                        @appearance='plain'
                        @size='sm'
                        {{on 'click' this.cancelRemoveV1Site}}
                        data-test-cancel-remove-v1-site
                      >Cancel</Button>
                      <Button
                        @tone='danger'
                        @appearance='accent'
                        @size='sm'
                        @busy={{this.isPending url}}
                        {{on 'click' this.confirmRemoveV1Site}}
                        data-test-confirm-remove-v1-site-button
                      >Remove</Button>
                    </:action>
                  </Alert>
                {{/if}}
              </li>
            {{/each}}
          </ul>
        </section>
      {{/if}}
    {{/if}}
    <Toaster @store={{this.toasts}} data-test-host-url-toaster />

    <style scoped>
      .muted {
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
        color: var(--destructive-ink);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .url {
        --pretui-link-ink: var(--foreground);
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
        overflow-wrap: break-word;
      }
      .explain {
        --pretui-tooltip-measure: 20rem;
      }
      .confirm {
        grid-column: 1 / -1;
      }
      .confirm-text {
        margin: 0 0 var(--boxel-sp-xs);
        overflow-wrap: break-word;
      }
    </style>
  </template>
}

const HostURLManager: TemplateOnlyComponent<Signature> = <template>
  <ModalContainer
    class='host-url-manager'
    @cardContainerClass='host-url-manager-box'
    @title='Host URLs'
    @size='medium'
    @isOpen={{@isOpen}}
    @onClose={{@onClose}}
    data-test-host-url-manager
    ...attributes
  >
    <:header>
      <p class='subtitle' data-test-host-url-manager-realm>
        The addresses
        <strong class='realm-name'>{{@realmName}}</strong>
        is served at. Each one shows the realm live: a change in the realm shows
        on its pages at once.
      </p>
    </:header>
    <:content>
      <HostURLs
        @realmURL={{@realmURL}}
        @v1SiteURLs={{@v1SiteURLs}}
        @removeV1Site={{@removeV1Site}}
      />
    </:content>
  </ModalContainer>

  <style scoped>
    /* The dialog is as tall as its content, and scrolls its content when
       that is taller than the window. Operator mode makes the modal's inner
       wrapper a block, so the wrapper is made a flex box again to centre the
       dialog, as the other dialogs sized to their content do. */
    .host-url-manager > :deep(.boxel-modal__inner) {
      display: flex;
    }
    :deep(.host-url-manager-box) {
      height: auto;
      max-height: 100%;
    }
    .realm-name {
      color: var(--foreground);
      font-weight: 600;
    }
    .subtitle {
      color: var(--muted-foreground);
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
    }
  </style>
</template>;

export default HostURLManager;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
