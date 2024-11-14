import Service from '@ember/service';

import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';

import ENV from '@cardstack/host/config/environment';
const { stripePaymentLink } = ENV;

export default class BillingService extends Service {
  getStripePaymentLink(matrixUserId: string): string {
    const username = getMatrixUsername(matrixUserId);
    const clientReferenceId = encodeURIComponent(username);
    return `${stripePaymentLink}?client_reference_id=${clientReferenceId}`;
  }
}
