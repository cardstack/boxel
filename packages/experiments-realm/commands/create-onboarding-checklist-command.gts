import {
  CardDef,
  field,
  contains,
  linksTo,
  StringField,
  realmURL,
} from '@cardstack/base/card-api';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { Employee } from '../employee';
import { Contractor } from '../contractor';
import { OnboardingTemplate } from '../onboarding-template';
import {
  OnboardingChecklist,
  OnboardingChecklistTaskField,
} from '../onboarding-checklist';

class CreateOnboardingChecklistInput extends CardDef {
  @field employee = linksTo(() => Employee);
  @field contractor = linksTo(() => Contractor);
  @field template = linksTo(() => OnboardingTemplate, { searchable: true });
}

class CreateOnboardingChecklistResult extends CardDef {
  @field message = contains(StringField);
  @field checklist = linksTo(() => OnboardingChecklist);
}

export class CreateOnboardingChecklistCommand extends Command<
  typeof CreateOnboardingChecklistInput,
  typeof CreateOnboardingChecklistResult
> {
  static actionVerb = 'Create';
  static displayName = 'Create Onboarding Checklist';

  async getInputType() {
    return CreateOnboardingChecklistInput;
  }

  protected async run(
    input: CreateOnboardingChecklistInput,
  ): Promise<CreateOnboardingChecklistResult> {
    let { employee, contractor, template } = input;

    if (!employee && !contractor) {
      throw new Error('Either employee or contractor is required');
    }

    if (!template) {
      throw new Error('template is required');
    }

    let templateTasks = template.tasks ?? [];
    let createdDate = new Date();

    // Create checklist tasks from template
    let tasks: OnboardingChecklistTaskField[] = templateTasks.map(
      (templateTask) => {
        let dueDate: Date | undefined;
        if (templateTask.dueDate && templateTask.dueDate.value) {
          dueDate = new Date(createdDate);
          dueDate.setDate(dueDate.getDate() + templateTask.dueDate.value);
        }

        return new OnboardingChecklistTaskField({
          title: templateTask.title,
          dueDate: dueDate,
          status: 'pending',
          notes: templateTask.notes,
          // assignee is left empty — manager will assign
        });
      },
    );

    // Create the checklist
    let checklist = new OnboardingChecklist({
      employee: employee || undefined,
      contractor: contractor || undefined,
      template: template,
      tasks: tasks,
      createdDate: createdDate,
      status: 'not-started',
    });

    // Save to realm — use the realm of the person (employee or contractor)
    let person = employee || contractor;
    let realm = person?.[realmURL]?.href;
    let saved = (await new SaveCardCommand(this.commandContext).execute({
      card: checklist,
      realm,
    } as any)) as OnboardingChecklist;

    return new CreateOnboardingChecklistResult({
      message: `Onboarding checklist created for ${
        employee?.name || contractor?.name
      } with ${tasks.length} tasks.`,
      checklist: saved,
    });
  }
}
