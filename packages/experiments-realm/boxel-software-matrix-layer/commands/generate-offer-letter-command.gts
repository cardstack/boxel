import {
  CardDef,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import { Command, codeRef } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { SearchCardsByQueryCommand } from '@cardstack/boxel-host/commands/search-cards';

import { Offer } from '../offer';
import { OfferLetterTemplate } from '../offer-letter-template';

const here: string = import.meta.url;
const templateRef = codeRef(
  here,
  '../offer-letter-template',
  'OfferLetterTemplate',
);

function formatDateLong(date?: Date | string | null): string | undefined {
  if (!date) {
    return undefined;
  }
  let d = new Date(date);
  if (isNaN(d.getTime())) {
    return undefined;
  }
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

class GenerateOfferLetterInput extends CardDef {
  @field offer = linksTo(() => Offer, { searchable: true });
  @field template = linksTo(() => OfferLetterTemplate, {
    description:
      'Template to merge; when omitted the first template in the realm is used',
  });
  @field companyName = contains(StringField, {
    description: 'Replaces {{companyName}}; defaults to "the Company"',
  });
}

class GenerateOfferLetterResult extends CardDef {
  @field message = contains(StringField);
  @field offer = linksTo(() => Offer);
}

// Deterministic merge-field interpolation — deliberately NOT an LLM call.
// An offer letter is a quasi-legal document: the salary, dates, and title in
// it must be exactly the offer's stored values, never a paraphrase. The
// "export" path is the Offer isolated view's print stylesheet
// (browser print-to-PDF), not a generated PDF file.
export class GenerateOfferLetterCommand extends Command<
  typeof GenerateOfferLetterInput,
  typeof GenerateOfferLetterResult
> {
  static actionVerb = 'Generate';
  static displayName = 'Generate Offer Letter';

  async getInputType() {
    return GenerateOfferLetterInput;
  }

  protected async run(
    input: GenerateOfferLetterInput,
  ): Promise<GenerateOfferLetterResult> {
    let { offer } = input;
    if (!offer) {
      throw new Error('offer is required');
    }
    if (!offer.candidate) {
      throw new Error(
        'This offer has no linked candidate — link a Candidate before generating a letter, so the letter can be addressed to them',
      );
    }

    // Find-or-fail the template: use the linked one, else the first
    // OfferLetterTemplate in the realm (mirrors ScreenApplicationCommand's
    // SearchCardsByQueryCommand idiom for realm-wide type queries).
    let template = input.template;
    if (!template) {
      let search = new SearchCardsByQueryCommand(this.commandContext);
      let searchResult = await search.execute({
        query: { filter: { type: templateRef } },
      });
      let templates = (searchResult.instances ?? []) as OfferLetterTemplate[];
      template = templates[0];
      if (!template) {
        throw new Error(
          'No OfferLetterTemplate found in the realm — create one (e.g. "Standard Offer") or link a template explicitly',
        );
      }
    }
    if (!template.body?.trim()) {
      throw new Error(
        `Template "${template.title}" has an empty body — nothing to merge`,
      );
    }

    let values: Record<string, string | undefined> = {
      candidateName: offer.candidate.name ?? undefined,
      jobTitle:
        offer.offeredTitle || offer.position?.jobTitle || offer.positionTitle,
      salary:
        offer.salary != null ? `$${offer.salary.toLocaleString()}` : undefined,
      startDate: formatDateLong(offer.startDate),
      expiresDate: formatDateLong(offer.expirationDate),
      companyName: input.companyName?.trim() || 'the Company',
    };

    // Unknown tokens are left in place (visible, greppable) rather than
    // silently blanked; known-but-missing values render an explicit gap the
    // reviewer cannot miss.
    let letter = template.body.replace(
      /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g,
      (whole, token: string) => {
        if (!(token in values)) {
          return whole;
        }
        return values[token] ?? `[${token} not set]`;
      },
    );

    offer.letter = letter;
    await new SaveCardCommand(this.commandContext).execute({ card: offer });

    return new GenerateOfferLetterResult({
      message: `Offer letter generated from "${template.title}" for ${
        offer.candidate.name ?? 'the candidate'
      }.`,
      offer,
    });
  }
}
