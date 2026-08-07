import {
  CardDef,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import { Command } from '@cardstack/runtime-common';
import OneShotLlmRequestCommand from '@cardstack/boxel-host/commands/one-shot-llm-request';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { Candidate } from '../candidate';

const SYSTEM_PROMPT = `You are a senior technical recruiter preparing an interview kit.
Given a candidate's applied role, skills, and resume, produce interview questions as GitHub-flavored markdown with these sections:
## Warm-up (2 questions)
## Role-specific (4 questions, grounded in the candidate's actual experience — reference specifics from the resume)
## Behavioral (3 questions)
## Red-flag probes (2 questions targeting gaps or ambiguities you notice in the resume)
Output markdown only — no preamble, no closing remarks.`;

class GenerateQuestionsInput extends CardDef {
  @field candidate = linksTo(() => Candidate, { searchable: true });
  @field focusArea = contains(StringField, {
    description: 'Optional topic to emphasize, e.g. "system design"',
  });
  @field llmModel = contains(StringField);
}

class GenerateQuestionsResult extends CardDef {
  @field questions = contains(StringField);
}

export class GenerateInterviewQuestionsCommand extends Command<
  typeof GenerateQuestionsInput,
  typeof GenerateQuestionsResult
> {
  static actionVerb = 'Generate';
  static displayName = 'Generate Interview Questions';

  async getInputType() {
    return GenerateQuestionsInput;
  }

  protected async run(
    input: GenerateQuestionsInput,
  ): Promise<GenerateQuestionsResult> {
    let { candidate, focusArea } = input;
    if (!candidate) {
      throw new Error('candidate is required');
    }
    let userPrompt = [
      `Role applied for: ${candidate.appliedRole ?? 'unknown'}`,
      `Skills: ${(candidate.skills ?? []).join(', ') || 'not listed'}`,
      focusArea ? `Focus the questions on: ${focusArea}` : '',
      '',
      'Resume:',
      candidate.resumeText ?? '(no resume text provided)',
    ]
      .filter(Boolean)
      .join('\n');

    let oneShot = new OneShotLlmRequestCommand(this.commandContext);
    let result = await oneShot.execute({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      skillCardIds: [],
      llmModel: input.llmModel || 'anthropic/claude-sonnet-4.6',
    });
    let questions = (result as any)?.output ?? '';
    if (!questions) {
      throw new Error('The model returned no questions');
    }

    candidate.generatedQuestions = questions;
    await new SaveCardCommand(this.commandContext).execute({
      card: candidate,
    });

    return new GenerateQuestionsResult({ questions });
  }
}
