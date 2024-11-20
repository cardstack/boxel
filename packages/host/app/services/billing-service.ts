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
    const clientReferenceId = this.encodeToAlphanumeric(matrixUserId);
    return `${stripePaymentLink}?client_reference_id=${clientReferenceId}`;
  }
}
