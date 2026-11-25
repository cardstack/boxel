import { service } from '@ember/service';

import { ensureTrailingSlash } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';
import { assertHostModeV2, hostAndPath } from '../utils/host-urls';

import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

// Unmounts a host URL of a realm, so the realm is no longer served at that
// address. The tool finds the host URL by its host and path, so the scheme
// and a trailing slash do not have to match. A refusal from the realm server
// throws with the reason that the server gives. For example, the server
// refuses to unmount the canonical host URL while the realm has other host
// URLs.
export default class UnmountHostURLTool extends HostBaseTool<
  typeof BaseToolModule.UnmountHostURLInput,
  typeof BaseToolModule.UnmountHostURLResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Unmount';
  description =
    'Unmount a host URL of a realm, so the realm is no longer served at that address.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.UnmountHostURLInput;
  }

  requireInputFields = ['realmURL', 'url'];

  protected async run(
    input: BaseToolModule.UnmountHostURLInput,
  ): Promise<BaseToolModule.UnmountHostURLResult> {
    assertHostModeV2();
    let commandModule = await this.loadToolModule();
    let { UnmountHostURLResult } = commandModule;

    let realmURL = ensureTrailingSlash(input.realmURL);
    let address = hostAndPath(withScheme(input.url.trim()));
    let { hostURLs } = await this.realmServer.listHostURLs(realmURL);
    let hostURL = hostURLs.find((h) => hostAndPath(h.url) === address);
    if (!hostURL) {
      throw new Error(`The realm ${realmURL} is not mounted at ${input.url}`);
    }
    await this.realmServer.unmountHostURL(hostURL.id);

    return new UnmountHostURLResult({
      url: hostURL.url,
      status: 'unmounted',
    });
  }
}

function withScheme(url: string): string {
  return url.includes('://') ? url : `https://${url}`;
}
