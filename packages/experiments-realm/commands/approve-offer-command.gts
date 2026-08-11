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
import { Employee } from '../employee';
import { OnboardingTemplate } from '../onboarding-template';
import { CreateOnboardingChecklistCommand } from './create-onboarding-checklist-command';

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

    // An approval chain with at least one step configured is a real sign-off
    // gate — hiring cannot proceed until it reads 'approved'. A chain with no
    // steps means no gate was ever configured for this offer, so existing
    // demo data (and any offer nobody bothered to gate) keeps working exactly
    // as it did before this field existed.
    let chain = candidate.offer?.approvalChain;
    if (chain?.steps?.length && chain.status !== 'approved') {
      throw new Error(
        `This offer's approval chain is not fully approved yet (status: ${chain.status}). Resolve all approval steps before hiring.`,
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

    candidate.offerState = 'accepted';
    if (candidate.offer) {
      candidate.offer.status = 'accepted';
      candidate.offer.decisionDate = new Date();
      await new SaveCardCommand(this.commandContext).execute({
        card: candidate.offer,
      });
    }

    // Automatically create an OnboardingChecklist for the new employee
    try {
      // Try to find a default template (e.g., based on role or department)
      // For now, just fetch templates and use the first one
      let templates = await this.commandContext.store.query(OnboardingTemplate);
      let template = templates?.[0];

      if (template) {
        let createChecklistCmd = new CreateOnboardingChecklistCommand(
          this.commandContext,
        );
        await createChecklistCmd.execute({
          employee: saved,
          template: template,
        } as any);
      }
    } catch (err) {
      // Silently fail if template creation doesn't work — don't block the hire
      console.error(
        'Failed to create onboarding checklist:',
        err instanceof Error ? err.message : String(err),
      );
    }

    return new ApproveOfferResult({
      message: `Offer approved — ${
        candidate.name ?? 'candidate'
      } is now an onboarding employee.`,
      employee: saved,
    });
  }
}
