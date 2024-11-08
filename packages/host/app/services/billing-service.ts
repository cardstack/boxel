import Service from '@ember/service';

import ENV from '@cardstack/host/config/environment';
const { stripePaymentLink } = ENV;

export default class BillingService extends Service {
  getStripePaymentLink(matrixUserId: string): string {
    const clientReferenceId = encodeURIComponent(matrixUserId);
    return `${stripePaymentLink}?client_reference_id=${clientReferenceId}`;
  }
}
