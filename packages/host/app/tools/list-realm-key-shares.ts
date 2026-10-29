import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';
import { listRealmKeyShares } from '../lib/key-shares';

import type MatrixService from '../services/matrix-service';
import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

// A realm's shares: the keys its direct writers have shared with it for other
// people there to use. Each names its label, its owner, whether it is in use
// and the operations it is approved for, and never the key it holds. Someone
// who isn't one of the realm's direct writers sees none, and the result says
// so rather than listing nothing.
export default class ListRealmKeySharesTool extends HostBaseTool<
  typeof BaseToolModule.RealmKeySharesInput,
  typeof BaseToolModule.RealmKeySharesResult
> {
  @service declare private matrixService: MatrixService;
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'List';

  description =
    "List a workspace's (realm) shared API keys: each share's label, owner and state, why a suspended one is suspended, and the card operations it is approved for there. Only the workspace's direct writers see them; for anyone else the result is not visible.";

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { RealmKeySharesInput } = commandModule;
    return RealmKeySharesInput;
  }

  requireInputFields = ['realm'];

  protected async run(
    input: BaseToolModule.RealmKeySharesInput,
  ): Promise<BaseToolModule.RealmKeySharesResult> {
    let commandModule = await this.loadToolModule();
    const {
      RealmKeySharesResult,
      RealmKeyShareField,
      RealmKeyShareOperationField,
    } = commandModule;
    let shares = await listRealmKeyShares(this.realmServer, input.realm);
    let user = this.matrixService.userId;
    return new RealmKeySharesResult({
      visible: Boolean(shares),
      shares: (shares ?? []).map(
        (share) =>
          new RealmKeyShareField({
            shareId: share.id,
            label: share.label,
            owner: share.owner ?? undefined,
            own: Boolean(user) && share.owner === user,
            suspendedByYou: Boolean(user) && share.suspendedBy === user,
            state: share.state,
            suspensionReason: share.suspensionReason ?? undefined,
            suspendedBy: share.suspendedBy ?? undefined,
            suspendedAt: share.suspendedAt ?? undefined,
            operations: share.operations.map(
              (operation) =>
                new RealmKeyShareOperationField({
                  bindingId: operation.bindingId,
                  module: operation.type.module,
                  name: operation.type.name,
                  operation: operation.operation,
                  instance: operation.instance ?? undefined,
                  slot: operation.slot,
                  state: operation.state,
                }),
            ),
          }),
      ),
    });
  }
}
