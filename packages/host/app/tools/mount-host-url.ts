import { service } from '@ember/service';

import { ensureTrailingSlash } from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

import HostBaseTool from '../lib/host-base-tool';
import { assertHostModeV2 } from '../utils/host-urls';

import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

// Mounts a realm at a host URL, so the realm is also served at that address.
// The tool builds the URL from the kind and the name:
// - 'boxel-space': the Boxel Space URL that the realm server gives for the
//   realm. The server accepts only this URL, so the name is not used.
// - 'site-name': `https://<name>.<site domain>/`. When no one has claimed the
//   name, the tool claims it first, as the host URL manager does.
// - 'custom-domain': `https://<name>/`.
// A refusal from the realm server throws with the reason that the server
// gives.
export default class MountHostURLTool extends HostBaseTool<
  typeof BaseToolModule.MountHostURLInput,
  typeof BaseToolModule.MountHostURLResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Mount';
  description =
    'Mount a realm at a host URL (a Boxel Space, a site name or a custom domain), so the realm is also served at that address. Visitors who are not signed in must be able to view the home page of the realm.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.MountHostURLInput;
  }

  requireInputFields = ['realmURL', 'kind'];

  protected async run(
    input: BaseToolModule.MountHostURLInput,
  ): Promise<BaseToolModule.MountHostURLResult> {
    assertHostModeV2();
    let commandModule = await this.loadToolModule();
    let { MountHostURLResult } = commandModule;

    let realmURL = ensureTrailingSlash(input.realmURL);
    let url = await this.hostURLFor(realmURL, input.kind, input.name);
    let hostURL = await this.realmServer.mountHostURL(realmURL, url);

    return new MountHostURLResult({
      hostURLId: hostURL.id,
      url: hostURL.url,
      kind: hostURL.kind,
      isCanonical: hostURL.isCanonical,
    });
  }

  private async hostURLFor(
    realmURL: string,
    kind: string,
    name: string | undefined,
  ): Promise<string> {
    switch (kind) {
      case 'boxel-space': {
        let { boxelSpaceURL } = await this.realmServer.listHostURLs(realmURL);
        if (!boxelSpaceURL) {
          throw new Error(
            `The realm ${realmURL} has no Boxel Space URL. The realm has no owner, or this deployment has no Boxel Space.`,
          );
        }
        return boxelSpaceURL;
      }
      case 'site-name': {
        let hostname = siteNameHostname(requireName(kind, name));
        await this.ensureSiteNameClaim(realmURL, hostname);
        return `https://${hostname}/`;
      }
      case 'custom-domain':
        return `https://${hostnameOf(requireName(kind, name))}/`;
      default:
        throw new Error(
          `Unknown host URL kind '${kind}'. Use 'boxel-space', 'site-name' or 'custom-domain'.`,
        );
    }
  }

  // Claims the site name for the realm before the mount, when no one has
  // claimed it.
  // - The home page check comes first. Only an administrator of the realm may
  //   ask it, so it refuses any other caller before a claim binds the name to
  //   the realm. The mount refuses a realm whose home page visitors who are
  //   not signed in can't view, and a claim made for such a realm would stay
  //   held, so the tool then claims nothing and the mount gives the reason.
  // - A name that can never be claimed stops here, with the server's reason.
  // - A name that is claimed already is left to the mount. The claim can be
  //   the caller's, or one that another administrator made for this realm,
  //   which the mount accepts. The mount refuses a name that another user
  //   claimed, and gives the reason.
  private async ensureSiteNameClaim(realmURL: string, hostname: string) {
    let homePage = await this.realmServer.checkHomePage(realmURL);
    if (!homePage.anonymousCanView) {
      return;
    }
    let availability = await this.realmServer.checkDomainAvailability(
      hostname.split('.')[0],
    );
    if (availability.error) {
      throw new Error(availability.error);
    }
    if (!availability.available) {
      return;
    }
    await this.realmServer.claimBoxelDomain(realmURL, hostname);
  }
}

function requireName(kind: string, name: string | undefined): string {
  let trimmed = name?.trim();
  if (!trimmed) {
    throw new Error(`A '${kind}' host URL needs a name.`);
  }
  return trimmed;
}

// The hostname of a site name. The name can be the subdomain ("my-site") or
// the full hostname ("my-site.<site domain>").
function siteNameHostname(name: string): string {
  let hostname = hostnameOf(name);
  let suffix = `.${config.publishedRealmBoxelSiteDomain}`;
  return hostname.endsWith(suffix) ? hostname : `${hostname}${suffix}`;
}

// The hostname in a name, which can also have a scheme or a path.
function hostnameOf(name: string): string {
  return new URL(name.includes('://') ? name : `https://${name}`).host;
}
