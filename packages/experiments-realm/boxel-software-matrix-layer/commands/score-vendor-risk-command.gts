import {
  CardDef,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import TextAreaField from '@cardstack/base/text-area';
import { Command, identifyCard } from '@cardstack/runtime-common';
import { GetCardCommand } from '@cardstack/boxel-host/commands/get-card';
import { SearchCardsByQueryCommand } from '@cardstack/boxel-host/commands/search-cards';

import { Vendor } from '../vendor';
import { VendorProfile } from '../vendor-profile';
import { PurchaseOrder } from '../purchase-order';

// Score Vendor Risk — a read-only analytic command: gathers the vendor's
// live evidence from the realm (compliance state on their Vendor Profile,
// delivery behavior on their Purchase Orders, the stored performance
// rating) and returns a 0–100 risk score with the contributing factors
// spelled out. Deliberately mutates nothing: risk is a derived reading of
// current evidence, not a stored fact that could drift — re-run it whenever
// the answer matters.

export class ScoreVendorRiskInput extends CardDef {
  @field vendor = linksTo(() => Vendor, { searchable: true });
}

export class ScoreVendorRiskResult extends CardDef {
  @field vendor = linksTo(() => Vendor);
  @field riskScore = contains(NumberField);
  @field riskBand = contains(StringField);
  @field factors = contains(TextAreaField);
  @field message = contains(StringField);
}

function bandOf(score: number): string {
  if (score >= 60) {
    return 'high';
  }
  if (score >= 30) {
    return 'moderate';
  }
  return 'low';
}

export default class ScoreVendorRiskCommand extends Command<
  typeof ScoreVendorRiskInput,
  typeof ScoreVendorRiskResult
> {
  static actionVerb = 'Score Risk';
  static displayName = 'Score Vendor Risk';

  async getInputType() {
    return ScoreVendorRiskInput;
  }

  protected async run(
    input: ScoreVendorRiskInput,
  ): Promise<ScoreVendorRiskResult> {
    let { vendor } = input;
    if (!vendor) {
      throw new Error('A vendor is required');
    }
    if (vendor.id) {
      vendor = (await new GetCardCommand(this.commandContext).execute({
        cardId: vendor.id,
      })) as Vendor;
    }

    let score = 0;
    let factors: string[] = [];

    // --- Compliance evidence (Vendor Profile) ---
    let profileRef = identifyCard(VendorProfile);
    let profile: VendorProfile | undefined;
    if (profileRef) {
      let search = new SearchCardsByQueryCommand(this.commandContext);
      let result = await search.execute({
        query: { filter: { type: profileRef } },
      });
      profile = ((result.instances ?? []) as VendorProfile[]).find((p) => {
        try {
          return p.linkedVendor?.id === vendor!.id;
        } catch {
          return false;
        }
      });
    }
    if (!profile) {
      score += 15;
      factors.push('+15 — no Vendor Profile on file: compliance state unknown');
    } else {
      let expired = (profile.certifications ?? []).filter(
        (c) => c?.isExpired,
      ).length;
      if (expired > 0) {
        let pts = Math.min(40, expired * 30);
        score += pts;
        factors.push(
          `+${pts} — ${expired} expired certification${expired === 1 ? '' : 's'}`,
        );
      }
      if (!profile.complianceOk && expired === 0) {
        score += 25;
        factors.push('+25 — insurance lapsed');
      }
    }

    // --- Delivery evidence (Purchase Orders) ---
    let poRef = identifyCard(PurchaseOrder);
    let pos: PurchaseOrder[] = [];
    if (poRef) {
      let search = new SearchCardsByQueryCommand(this.commandContext);
      let result = await search.execute({
        query: { filter: { type: poRef } },
      });
      pos = ((result.instances ?? []) as PurchaseOrder[]).filter((po) => {
        try {
          return po.vendor?.id === vendor!.id;
        } catch {
          return false;
        }
      });
    }
    let deliveredPos = pos.filter((po) =>
      ['partially-received', 'received', 'closed'].includes(po.status ?? ''),
    );
    let shortPos = deliveredPos.filter((po) => {
      let lines = po.lineItems ?? [];
      return lines.some(
        (l, i) => (po.receivedQuantities?.[i] ?? 0) < (l?.quantity ?? 0),
      );
    });
    if (deliveredPos.length > 0 && shortPos.length > 0) {
      let ratio = shortPos.length / deliveredPos.length;
      let pts = Math.round(ratio * 20);
      score += pts;
      factors.push(
        `+${pts} — ${shortPos.length}/${deliveredPos.length} delivered POs still short-shipped`,
      );
    }
    if (!pos.length) {
      score += 10;
      factors.push('+10 — no order history with us yet');
    }

    // --- Stored performance rating ---
    let rating = vendor.performanceRating;
    if (rating != null && rating < 3) {
      score += 15;
      factors.push(`+15 — performance rating ${rating}/5`);
    }

    score = Math.min(100, score);
    let band = bandOf(score);
    if (!factors.length) {
      factors.push(
        'No risk factors found — compliance current, deliveries clean.',
      );
    }

    return new ScoreVendorRiskResult({
      vendor,
      riskScore: score,
      riskBand: band,
      factors: factors.join('\n'),
      message: `${vendor.name ?? 'Vendor'} risk: ${score}/100 (${band}).`,
    });
  }
}
