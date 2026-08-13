import {
  CardDef,
  field,
  contains,
  linksTo,
  realmURL,
  StringField,
} from '@cardstack/base/card-api';
import { Command } from '@cardstack/runtime-common';
import OneShotLlmRequestCommand from '@cardstack/boxel-host/commands/one-shot-llm-request';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { Candidate } from '../candidate';
import { InterviewPlan, InterviewPlanRoundField } from '../interview-plan';
import { InterviewRoundField } from '../interview-round-field';

const PREAMBLE = `You are a senior technical recruiter preparing an interview kit.
Given a candidate's applied role, skills, and resume, produce interview questions as GitHub-flavored markdown.
Ground every question in the candidate's actual experience where possible — reference specifics from the resume rather than asking generically. Never invent unverifiable claims about the candidate.
Output 5-10 questions total, organized under the section(s) below. Output markdown only — no preamble, no closing remarks.`;

// Each round probes a different thing, so the section breakdown a
// phone-screen kit needs (culture/logistics/basic fit) is not the same
// breakdown a final round needs (closing/behavioral/culture-fit) — sharing
// one fixed 4-section prompt across every round produced onsite-depth
// questions for a 20-minute phone screen and vice versa.
const ROUND_PROMPTS: Record<string, string> = {
  'phone-screen': `This is a PHONE SCREEN — a short initial call. Focus on:
## Culture & motivation (2 questions)
## Logistics & fit (2 questions — availability, comp expectations, work authorization, notice period)
## Basic role fit (2 questions confirming baseline experience against the applied role)`,
  technical: `This is a TECHNICAL round. Focus on:
## Role-specific depth (4 questions, grounded in the candidate's actual experience — reference specifics from the resume)
## Problem-solving / coding (3 questions probing how they approach an unfamiliar problem)
## Red-flag probes (2 questions targeting gaps or ambiguities you notice in the resume)`,
  onsite: `This is an ONSITE round — the full battery. Focus on:
## Problem-solving (3 questions)
## System design (2 questions appropriate to the applied role's seniority)
## Behavioral (3 questions)
## Red-flag probes (2 questions targeting gaps or ambiguities you notice in the resume)`,
  panel: `This is a PANEL round — multiple interviewers, one session. Focus on:
## Problem-solving (2 questions)
## System design (2 questions appropriate to the applied role's seniority)
## Behavioral (3 questions)
## Cross-functional collaboration (2 questions)`,
  final: `This is the FINAL round — closing the loop. Focus on:
## Behavioral (3 questions)
## Culture fit (3 questions)
## Closing questions (2 questions surfacing any remaining hesitations or open questions from the candidate's side)`,
};

function systemPromptFor(roundType: string | undefined | null): string {
  let section =
    (roundType && ROUND_PROMPTS[roundType]) || ROUND_PROMPTS.technical;
  return `${PREAMBLE}\n\n${section}`;
}

class GenerateQuestionsInput extends CardDef {
  @field candidate = linksTo(() => Candidate, { searchable: true });
  @field roundType = contains(InterviewRoundField, {
    description: 'Which round of the interview loop to generate questions for',
  });
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
    let { candidate, focusArea, roundType } = input;
    if (!candidate) {
      throw new Error('candidate is required');
    }
    if (!candidate.position) {
      throw new Error(
        "This candidate has no linked position — link a Position before generating interview questions, so the questions can be saved to that position's interview plan",
      );
    }
    if (!roundType) {
      throw new Error('roundType is required');
    }

    let userPrompt = [
      `Role applied for: ${candidate.appliedRole ?? 'unknown'}`,
      `Skills: ${
        (candidate.skills ?? [])
          .filter(Boolean)
          .map((skill) => skill.title)
          .join(', ') || 'not listed'
      }`,
      focusArea ? `Focus the questions on: ${focusArea}` : '',
      '',
      'Resume:',
      candidate.resumeText ?? '(no resume text provided)',
    ]
      .filter(Boolean)
      .join('\n');

    let oneShot = new OneShotLlmRequestCommand(this.commandContext);
    let result = await oneShot.execute({
      systemPrompt: systemPromptFor(roundType),
      userPrompt,
      skillCardIds: [],
      llmModel: input.llmModel || 'anthropic/claude-sonnet-4.6',
    });
    let questions = (result as any)?.output ?? '';
    if (!questions) {
      throw new Error('The model returned no questions');
    }

    // Find-or-create the position's interview plan (mirrors
    // ExtractResumeCommand's find-or-create idiom for skills, adapted from a
    // linksToMany target to a linksTo one).
    let position = candidate.position;
    let plan = position.interviewPlan;
    if (!plan) {
      let realm = position[realmURL]?.href;
      plan = (await new SaveCardCommand(this.commandContext).execute({
        card: new InterviewPlan({ position, createdDate: new Date() }),
        realm,
      } as any)) as InterviewPlan;
      position.interviewPlan = plan;
      await new SaveCardCommand(this.commandContext).execute({
        card: position,
      });
    }

    // Upsert the round matching roundType — replace an existing round of the
    // same type rather than appending a duplicate, so re-running the command
    // for a round updates it in place instead of piling up stale copies.
    let rounds = (plan.rounds ?? []).slice();
    let existingIndex = rounds.findIndex(
      (round) => round?.roundType === roundType,
    );
    let newRound = new InterviewPlanRoundField({ roundType, questions });
    if (existingIndex === -1) {
      rounds.push(newRound);
    } else {
      rounds[existingIndex] = newRound;
    }
    plan.rounds = rounds;
    await new SaveCardCommand(this.commandContext).execute({ card: plan });

    return new GenerateQuestionsResult({ questions });
  }
}
