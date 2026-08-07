import {
  CardDef,
  field,
  contains,
  linksTo,
  realmURL,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { Candidate } from '../candidate';
import { Employee } from '../trt-employee';

class ApproveOfferInput extends CardDef {
  @field candidate = linksTo(() => Candidate, { searchable: true });
  @field approver = linksTo(() => Employee, { searchable: true });
  @field salary = contains(NumberField);
  @field startDate = contains(DateField);
}

class ApproveOfferResult extends CardDef {
  @field message = contains(StringField);
  @field employee = linksTo(() => Employee);
}

export class ApproveOfferCommand extends Command<
  typeof ApproveOfferInput,
  typeof ApproveOfferResult
> {
  static actionVerb = 'Approve';
  static displayName = 'Approve Job Offer';

  async getInputType() {
    return ApproveOfferInput;
  }

  protected async run(input: ApproveOfferInput): Promise<ApproveOfferResult> {
    let { candidate, approver, salary, startDate } = input;
    if (!candidate) {
      throw new Error('candidate is required');
    }
    if (candidate.status !== 'offer') {
      throw new Error(
        `Only candidates at the "offer" stage can be approved (current stage: ${
          candidate.status ?? 'none'
        })`,
      );
    }

    let realm = candidate[realmURL]?.href;
    let employee = new Employee({
      name: candidate.name,
      email: candidate.email,
      phone: candidate.phone,
      role: candidate.appliedRole,
      startDate: startDate ?? new Date(),
      status: 'onboarding',
      salary: salary ?? candidate.offerSalary,
    });
    let saved = (await new SaveCardCommand(this.commandContext).execute({
      card: employee,
      realm,
    } as any)) as Employee;

    candidate.status = 'hired';
    candidate.decisionDate = new Date();
    if (salary != null) {
      candidate.offerSalary = salary;
    }
    if (approver) {
      candidate.offerApprovedBy = approver;
    }
    candidate.hiredAs = saved;
    await new SaveCardCommand(this.commandContext).execute({
      card: candidate,
    });

    return new ApproveOfferResult({
      message: `Offer approved — ${
        candidate.name ?? 'candidate'
      } is now an onboarding employee.`,
      employee: saved,
    });
  }
}
