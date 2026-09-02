import {
  CardDef,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import { Command } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';

import { Candidate } from '../candidate';
import { Employee } from '../employee';

// Hire Candidate — the single writer for the candidate → employee
// transition: the moment the pipeline resolves into the permanent record.
// Requires an ACCEPTED offer on the candidate, creates the Employee from
// the candidate's identity plus the offer's terms (role, salary, start
// date), and stamps the candidate `hired`. The pipeline stage and the
// employee record can never disagree, because one command writes both.

export class HireCandidateInput extends CardDef {
  @field candidate = linksTo(() => Candidate, { searchable: true });
  @field realm = contains(StringField);
}

export class HireCandidateResult extends CardDef {
  @field employee = linksTo(() => Employee);
  @field message = contains(StringField);
}

export default class HireCandidateCommand extends Command<
  typeof HireCandidateInput,
  typeof HireCandidateResult
> {
  static actionVerb = 'Hire';
  static displayName = 'Hire Candidate';

  async getInputType() {
    return HireCandidateInput;
  }

  protected async run(input: HireCandidateInput): Promise<HireCandidateResult> {
    let { candidate, realm } = input;
    if (!candidate) {
      throw new Error('A candidate is required');
    }
    if (!realm) {
      throw new Error('A realm is required');
    }
    if (candidate.id) {
      candidate = (await new GetCardCommand(this.commandContext).execute({
        cardId: candidate.id,
      })) as Candidate;
    }
    if (candidate.status === 'hired') {
      throw new Error(`${candidate.name ?? 'This candidate'} is already hired`);
    }
    if (candidate.status === 'rejected') {
      throw new Error('A rejected candidate cannot be hired');
    }
    let offer = candidate.offer;
    if (!offer) {
      throw new Error(
        'No offer on this candidate — extend and accept an offer before hiring',
      );
    }
    if (offer.status !== 'accepted') {
      throw new Error(
        `Only an accepted offer can be hired against (this one is "${offer.status ?? 'draft'}")`,
      );
    }

    let role =
      offer.offeredTitle ||
      candidate.position?.jobTitle ||
      candidate.appliedRole;

    let employee = (await new SaveCardCommand(this.commandContext).execute({
      card: new Employee({
        name: candidate.name,
        email: candidate.email,
        phone: candidate.phone,
        role,
        startDate: offer.startDate ?? new Date(),
        status: 'onboarding',
        employmentType: 'full-time',
        salary: offer.salary,
        onboardingStatus: 'not-started',
      }),
      realm,
    } as any)) as Employee;

    // Calendar day built from local parts — toISOString would shift the
    // day anywhere east of UTC.
    let now = new Date();
    let today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: Candidate,
    }).execute({
      cardId: candidate.id,
      patch: {
        attributes: {
          status: 'hired',
          decisionDate: today,
        },
      },
    });

    return new HireCandidateResult({
      employee,
      message: `${candidate.name ?? 'Candidate'} hired as ${role ?? 'employee'} — onboarding record created.`,
    });
  }
}
