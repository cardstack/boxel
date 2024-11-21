import Service from '@ember/service';

import ENV from '@cardstack/host/config/environment';
const { stripePaymentLink } = ENV;

export default class BillingService extends Service {
  encodeToAlphanumeric(matrixUserId: string) {
    return Buffer.from(matrixUserId)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  getStripePaymentLink(matrixUserId: string): string {
    // We use the matrix user id (@username:example.com) as the client reference id for stripe
    // so we can identify the user payment in our system when we get the webhook
    // the client reference id must be alphanumeric, so we encode the matrix user id
    // https://docs.stripe.com/payment-links/url-parameters#streamline-reconciliation-with-a-url-parameter
    const clientReferenceId = this.encodeToAlphanumeric(matrixUserId);
    return `${stripePaymentLink}?client_reference_id=${clientReferenceId}`;
  }
}
