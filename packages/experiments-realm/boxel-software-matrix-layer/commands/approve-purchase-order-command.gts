import {
  CardDef,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import { Command } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';

import { PurchaseOrder, PO_ROUTE_STEP_ROLES } from '../purchase-order';
import { ProcurementBudget } from '../procurement-budget';
import { ApprovalDecisionField } from '../approval-step-field';
import { ApproveChainStepCommand } from './approve-chain-step-command';

// Approve Purchase Order — decides the current step of a PO's
// threshold-routed approval chain, reusing the shared
// ApproveChainStepCommand (Legal's block, second real consumer) for the
// step mutation itself. What this command adds is the procurement
// consequence: when the chain completes, the PO flips to `approved` and its
// total is COMMITTED against the linked budget (commitment accounting);
// a rejection flips the PO to `rejected` and commits nothing.

export class ApprovePurchaseOrderInput extends CardDef {
  @field purchaseOrder = linksTo(() => PurchaseOrder, { searchable: true });
  @field decision = contains(ApprovalDecisionField);
  @field comment = contains(StringField);
}

export class ApprovePurchaseOrderResult extends CardDef {
  @field message = contains(StringField);
}

export default class ApprovePurchaseOrderCommand extends Command<
  typeof ApprovePurchaseOrderInput,
  typeof ApprovePurchaseOrderResult
> {
  static actionVerb = 'Decide';
  static displayName = 'Approve Purchase Order';

  async getInputType() {
    return ApprovePurchaseOrderInput;
  }

  protected async run(
    input: ApprovePurchaseOrderInput,
  ): Promise<ApprovePurchaseOrderResult> {
    let { purchaseOrder: po, decision, comment } = input;
    if (!po) {
      throw new Error('A purchase order is required');
    }
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new Error('decision must be "approved" or "rejected"');
    }

    if (po.id) {
      po = (await new GetCardCommand(this.commandContext).execute({
        cardId: po.id,
      })) as PurchaseOrder;
    }
    if (po.status !== 'pending-approval') {
      throw new Error(
        `Only a pending-approval PO can be decided (this one is "${po.status ?? 'draft'}")`,
      );
    }
    let chain = po.approvalChain;
    if (!chain || !(chain.steps ?? []).length) {
      throw new Error('This PO has no approval chain to decide');
    }
    if (chain.status !== 'in-progress' && chain.status !== 'not-started') {
      throw new Error(`This approval chain is already ${chain.status}`);
    }

    let stepIndex = chain.currentStepIndex ?? 0;
    let roles =
      PO_ROUTE_STEP_ROLES[
        (po.approvalRoute as keyof typeof PO_ROUTE_STEP_ROLES) ?? 'manager'
      ] ?? [];
    let roleLabel = roles[stepIndex] ?? `Step ${stepIndex + 1}`;

    // The step mutation itself is the shared block's job.
    await new ApproveChainStepCommand(this.commandContext).execute({
      target: po,
      stepIndex,
      decision,
      comment,
    } as any);

    // Re-read the PO to see the chain's post-decision state.
    let updated = (await new GetCardCommand(this.commandContext).execute({
      cardId: po.id,
    })) as PurchaseOrder;
    let chainStatus = updated.approvalChain?.status;

    if (decision === 'rejected') {
      await new PatchCardInstanceCommand(this.commandContext, {
        cardType: PurchaseOrder,
      }).execute({
        cardId: po.id,
        patch: { attributes: { status: 'rejected' } },
      });
      return new ApprovePurchaseOrderResult({
        message: `${po.poNumber ?? 'PO'} rejected at the ${roleLabel} step — nothing committed to budget.`,
      });
    }

    if (chainStatus === 'approved') {
      await new PatchCardInstanceCommand(this.commandContext, {
        cardType: PurchaseOrder,
      }).execute({
        cardId: po.id,
        patch: { attributes: { status: 'approved' } },
      });

      let total = updated.totalAmount ?? 0;
      let budget = updated.budget as ProcurementBudget | undefined;
      if (budget?.id) {
        await new PatchCardInstanceCommand(this.commandContext, {
          cardType: ProcurementBudget,
        }).execute({
          cardId: budget.id,
          patch: {
            attributes: {
              committed: (budget.committed ?? 0) + total,
            },
          },
        });
        return new ApprovePurchaseOrderResult({
          message: `${po.poNumber ?? 'PO'} fully approved — $${total.toLocaleString('en-US')} committed against ${budget.title ?? 'budget'}.`,
        });
      }
      return new ApprovePurchaseOrderResult({
        message: `${po.poNumber ?? 'PO'} fully approved (no budget linked — nothing committed).`,
      });
    }

    return new ApprovePurchaseOrderResult({
      message: `${roleLabel} step approved — awaiting the next approver.`,
    });
  }
}
