import {
  CardDef,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { OnboardingChecklist } from '../onboarding-checklist';
import { Employee } from '../employee';

class AssignOnboardingTaskInput extends CardDef {
  @field onboardingChecklist = linksTo(() => OnboardingChecklist, {
    searchable: true,
  });
  @field taskIndex = contains(NumberField);
  @field assignee = linksTo(() => Employee, { searchable: true });
}

class AssignOnboardingTaskResult extends CardDef {
  @field message = contains(StringField);
  @field checklist = linksTo(() => OnboardingChecklist);
}

export class AssignOnboardingTaskCommand extends Command<
  typeof AssignOnboardingTaskInput,
  typeof AssignOnboardingTaskResult
> {
  static actionVerb = 'Assign';
  static displayName = 'Assign Onboarding Task';

  async getInputType() {
    return AssignOnboardingTaskInput;
  }

  protected async run(
    input: AssignOnboardingTaskInput,
  ): Promise<AssignOnboardingTaskResult> {
    let { onboardingChecklist, taskIndex, assignee } = input;

    if (!onboardingChecklist) {
      throw new Error('onboardingChecklist is required');
    }

    if (taskIndex == null) {
      throw new Error('taskIndex is required');
    }

    if (!assignee) {
      throw new Error('assignee is required');
    }

    let tasks = onboardingChecklist.tasks ?? [];
    if (taskIndex < 0 || taskIndex >= tasks.length) {
      throw new Error(
        `Task index ${taskIndex} out of bounds (checklist has ${tasks.length} tasks)`,
      );
    }

    let task = tasks[taskIndex];
    if (!task) {
      throw new Error(`No task found at index ${taskIndex}`);
    }

    // Assign the task
    task.assignee = assignee;

    // Save the checklist with updated task
    await new SaveCardCommand(this.commandContext).execute({
      card: onboardingChecklist,
    });

    return new AssignOnboardingTaskResult({
      message: `Task "${task.title}" assigned to ${assignee.name}.`,
      checklist: onboardingChecklist,
    });
  }
}
