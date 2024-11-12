import Service from '@ember/service';

import ENV from '@cardstack/host/config/environment';
const { stripePaymentLink } = ENV;

export default class BillingService extends Service {
  getStripePaymentLink(matrixUserId: string): string {
    const username = matrixUserId.split(':')[0].slice(1);
    const clientReferenceId = encodeURIComponent(username);
    return `${stripePaymentLink}?client_reference_id=${clientReferenceId}`;
  }
}
