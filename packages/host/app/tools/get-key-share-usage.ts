import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';
import { keyShareUsage } from '../lib/key-shares';

import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

// One of a realm's shares' usage: what it spent today and this month against
// its budgets, the last use and by whom, the callers who used it most,
// refusals by reason, how the service answered, where its key is sent and
// whether the service there rejected it, and its limits. Only the realm's
// direct writers see it; for anyone else the result is not visible. Nothing
// here is a key or a request.
export default class GetKeyShareUsageTool extends HostBaseTool<
  typeof BaseToolModule.KeyShareInput,
  typeof BaseToolModule.KeyShareUsageResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Get';

  description =
    "Get a workspace's (realm) shared API key's usage (shareId): calls today and this month against its budgets, the last use and by whom, top callers, refusals by reason, the service's answers by status, where the key is sent and whether the service rejected it, and its limits. Only the workspace's direct writers see it; for anyone else the result is not visible.";

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { KeyShareInput } = commandModule;
    return KeyShareInput;
  }

  requireInputFields = ['shareId'];

  protected async run(
    input: BaseToolModule.KeyShareInput,
  ): Promise<BaseToolModule.KeyShareUsageResult> {
    let commandModule = await this.loadToolModule();
    const {
      KeyShareUsageResult,
      KeyUsageBudgetField,
      KeyUsageCountField,
      KeyUsageGrantField,
    } = commandModule;
    let usage = await keyShareUsage(this.realmServer, input.shareId);
    if (!usage) {
      return new KeyShareUsageResult({ visible: false });
    }
    return new KeyShareUsageResult({
      visible: true,
      day: new KeyUsageBudgetField(usage.budgets.day),
      month: new KeyUsageBudgetField(usage.budgets.month),
      since: usage.since,
      calls: usage.calls,
      lastUseAt: usage.lastUse?.at,
      lastUseCaller: usage.lastUse?.caller ?? undefined,
      lastUseCallerWithheld: Boolean(usage.lastUse?.withheld),
      lastUseOperation: usage.lastUse?.operation,
      lastUseOutcome: usage.lastUse?.outcome,
      topCallers: usage.topCallers.map(
        ({ caller, calls, withheld }) =>
          new KeyUsageCountField({
            name: caller ?? '',
            count: calls,
            withheld: Boolean(withheld),
          }),
      ),
      refusals: usage.refusals.map(
        ({ code, count }) => new KeyUsageCountField({ name: code, count }),
      ),
      vendorOutcomes: usage.vendorOutcomes.map(
        ({ status, count, outcome }) =>
          new KeyUsageCountField({
            name: String(status),
            count,
            outcome,
          }),
      ),
      grants: usage.grants.map(
        (grant) =>
          new KeyUsageGrantField({
            destination: grant.destination,
            state: grant.state,
            rejectedAt: grant.rejectedAt ?? undefined,
            lastForbiddenAt: grant.lastForbiddenAt ?? undefined,
          }),
      ),
      canEditLimits: usage.canEditLimits,
      ...usage.limits,
    });
  }
}
