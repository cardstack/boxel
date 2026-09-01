import { Command } from '@cardstack/runtime-common';
import {
  CardDef,
  StringField,
  contains,
  field,
  realmURL,
} from '@cardstack/base/card-api';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { Order, canOrderTransition } from './sole-vault-order';
import { Payment } from './sole-vault-payment';

export class RefundOrderInput extends CardDef {
  @field orderId = contains(StringField);
  @field reason = contains(StringField);
}

export class RefundOrderResult extends CardDef {
  @field paymentId = contains(StringField);
  @field orderStatus = contains(StringField);
}

// Refund Order (RO) — unwinds a held order, most often an authentication
// failure. `AuthenticateItem`'s own comment says a failed verdict "refunds
// the buyer" — this is the command that actually moves the money.
//
// A REFUND IS A NEW PAYMENT RECORD, NEVER AN EDIT TO THE ORIGINAL CHARGE.
// `PaymentStateField`'s own transition graph says the same thing: `captured`
// only ever leads to `refunded`, one-way, and `payment.gts`'s `signedAmount`
// renders a refund's `direction: 'refund'` with a minus sign rather than
// mutating the charge's own amount. Two ledger rows, not one row that
// changed its mind.
export default class RefundOrderCommand extends Command<
  typeof RefundOrderInput,
  typeof RefundOrderResult
> {
  static actionVerb = 'Refund order';
  description =
    'Record a refund payment for the order total and move the order to refunded.';

  async getInputType() {
    return RefundOrderInput;
  }

  protected async run(input: RefundOrderInput): Promise<RefundOrderResult> {
    let orderId = input.orderId?.trim();
    if (!orderId) {
      throw new Error('orderId is required');
    }

    let order = (await new GetCardCommand(this.toolContext).execute({
      cardId: orderId,
    })) as Order;
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }
    if (!canOrderTransition(order.orderStatus, 'refunded')) {
      throw new Error(
        `Order ${orderId} cannot move from ${order.orderStatus} to refunded`,
      );
    }
    if (!order.total?.amount) {
      throw new Error(`Order ${orderId} has no total to refund`);
    }

    let now = new Date();

    let payment = new Payment();
    payment.order = order;
    payment.amount = order.total;
    payment.paymentState = 'refunded';
    payment.direction = 'refund';
    payment.processor = 'Simulated Processor';
    payment.processorReference = `sim-re-${Math.random().toString(36).slice(2, 10)}`;
    payment.initiatedAt = now;
    payment.settledAt = now;
    payment.reason = input.reason?.trim() || '';

    // Save into the SOURCE card's own realm. Without `realm`, SaveCard
    // defaults to the base realm and the write 401s — verified live when a
    // ProcessPayment run tried to save its Payment to cardstack.com/base/.
    let realm = (order as any)?.[realmURL]?.href;
    let saved = (await new SaveCardCommand(this.toolContext).execute({
      card: payment,
      realm,
    })) as Payment;

    await new PatchCardInstanceCommand(this.toolContext, {
      cardType: Order,
    }).execute({
      cardId: orderId,
      patch: { attributes: { orderStatus: 'refunded' } },
    });

    let result = new RefundOrderResult();
    result.paymentId = saved.id;
    result.orderStatus = 'refunded';
    return result;
  }
}
