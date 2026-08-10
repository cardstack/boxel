import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

// A card's door to the realm server's Version proposals.
//
// It exists because the endpoint is on the realm SERVER rather than inside a
// realm, and a published realm lives at the same origin — so a URL prefix
// cannot tell the two apart and the per-realm token middleware has nothing to
// match on. `RealmServerService` is where that distinction is already
// resolved, which is why this tool wraps it rather than reaching for
// `network.authedFetch` like the file tools do.
//
// The narrow surface is the point. A general "authenticated POST to any
// server path" tool would hand realm content a key to every write endpoint on
// the server; this one can only talk about package proposals, and cannot name
// who is proposing or accepting — the server reads that off the token.
export default class PackageProposalTool extends HostBaseTool<
  typeof BaseToolModule.PackageProposalInput,
  typeof BaseToolModule.PackageProposalResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Propose';
  description =
    'Analyze, propose, accept or withdraw a version proposal for a package ' +
    'held by this realm server';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { PackageProposalInput } = commandModule;
    return PackageProposalInput;
  }

  requireInputFields = ['action', 'packageName'];

  protected async run(
    input: BaseToolModule.PackageProposalInput,
  ): Promise<BaseToolModule.PackageProposalResult> {
    let { PackageProposalResult } = await this.loadToolModule();
    let url = new URL(
      `/_package-proposals/${input.packageName}`,
      this.realmServer.url,
    ).href;

    let response =
      input.action === 'list'
        ? await this.realmServer.authedFetch(url, {
            headers: { Accept: 'application/json' },
          })
        : await this.realmServer.authedFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: input.action,
              version: input.version,
              body: input.body,
              source: input.source,
              id: input.proposalId,
              overrideReason: input.overrideReason,
            }),
          });

    // The body is parsed and handed back on failure as well as success. A
    // refusal here is REVIEW MATERIAL — "the structural pass says major and
    // you claimed minor" is the most useful thing this endpoint ever says —
    // so throwing away the body on a non-2xx would discard the answer the
    // caller asked the question for.
    let text = await response.text();
    let body: Record<string, any>;
    try {
      body = JSON.parse(text);
    } catch {
      body = { rawText: text };
    }
    return new PackageProposalResult({
      ok: response.ok,
      status: response.status,
      body,
    });
  }
}
