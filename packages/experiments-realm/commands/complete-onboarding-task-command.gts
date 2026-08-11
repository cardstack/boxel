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

class CompleteOnboardingTaskInput extends CardDef {
  @field onboardingChecklist = linksTo(() => OnboardingChecklist, {
    searchable: true,
  });
  @field taskIndex = contains(NumberField);
  @field completedNote = contains(StringField);
}

class CompleteOnboardingTaskResult extends CardDef {
  @field message = contains(StringField);
  @field checklist = linksTo(() => OnboardingChecklist);
}

export class CompleteOnboardingTaskCommand extends Command<
  typeof CompleteOnboardingTaskInput,
  typeof CompleteOnboardingTaskResult
> {
  static actionVerb = 'Complete';
  static displayName = 'Complete Onboarding Task';

  async getInputType() {
    return CompleteOnboardingTaskInput;
  }

  protected async run(
    input: CompleteOnboardingTaskInput,
  ): Promise<CompleteOnboardingTaskResult> {
    let { onboardingChecklist, taskIndex, completedNote } = input;

    if (!onboardingChecklist) {
      throw new Error('onboardingChecklist is required');
    }

    if (taskIndex == null) {
      throw new Error('taskIndex is required');
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

    // Mark task as complete
    task.status = 'complete';
    task.completedDate = new Date();

    // Append note if provided
    if (completedNote) {
      if (task.notes) {
        task.notes = `${task.notes}\n\n---\n${completedNote}`;
      } else {
        task.notes = completedNote;
      }
    }

    // Save the checklist with updated task
    await new SaveCardCommand(this.commandContext).execute({
      card: onboardingChecklist,
    });

    // Update checklist.completedDate if all tasks are now complete
    if (tasks.every((t) => t && t.status === 'complete')) {
      onboardingChecklist.completedDate = new Date();
      await new SaveCardCommand(this.commandContext).execute({
        card: onboardingChecklist,
      });
    }

    return new CompleteOnboardingTaskResult({
      message: `Task "${task.title}" marked complete.`,
      checklist: onboardingChecklist,
    });
  }
}
