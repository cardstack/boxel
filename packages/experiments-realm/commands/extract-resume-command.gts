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

const SYSTEM_PROMPT = `You are a resume parser. You are given raw resume text.
Extract the candidate's details and reply with ONE JSON object only — no prose, no markdown fences. Shape:
{"name":"<full name or null>","email":"<email or null>","phone":"<phone or null>","appliedRole":"<most recent/likely target role or null>","skills":["<skill>", ...]}
Rules: skills is a flat list of up to 12 concrete skills/technologies actually present in the resume; use null for anything not found; never invent data.`;

interface ParsedResume {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  appliedRole?: string | null;
  skills?: string[] | null;
}

function parseModelJson(output: string): ParsedResume {
  let text = output
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(text) as ParsedResume;
  } catch {
    throw new Error(
      `Could not parse the extraction result as JSON. Raw output: ${output.slice(
        0,
        200,
      )}`,
    );
  }
}

class ExtractResumeInput extends CardDef {
  @field candidate = linksTo(() => Candidate, { searchable: true });
  @field llmModel = contains(StringField);
}

class ExtractResumeResult extends CardDef {
  @field summary = contains(StringField);
}

export class ExtractResumeCommand extends Command<
  typeof ExtractResumeInput,
  typeof ExtractResumeResult
> {
  static actionVerb = 'Extract';
  static displayName = 'Extract Resume';

  async getInputType() {
    return ExtractResumeInput;
  }

  protected async run(input: ExtractResumeInput): Promise<ExtractResumeResult> {
    let { candidate } = input;
    if (!candidate) {
      throw new Error('candidate is required');
    }
    if (!candidate.resumeText?.trim()) {
      throw new Error(
        'The candidate has no resumeText to extract from — paste the resume into the resumeText field first',
      );
    }

    let oneShot = new OneShotLlmRequestCommand(this.commandContext);
    let result = await oneShot.execute({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: candidate.resumeText,
      skillCardIds: [],
      llmModel: input.llmModel || 'anthropic/claude-sonnet-4.6',
    });
    let parsed = parseModelJson((result as any)?.output ?? '');

    if (parsed.name && !candidate.name) {
      candidate.name = parsed.name;
    }
    if (parsed.email && !candidate.email) {
      candidate.email = parsed.email;
    }
    if (parsed.phone && !candidate.phone) {
      candidate.phone = parsed.phone;
    }
    if (parsed.appliedRole && !candidate.appliedRole) {
      candidate.appliedRole = parsed.appliedRole;
    }
    if (Array.isArray(parsed.skills) && parsed.skills.length) {
      candidate.skills = parsed.skills.filter(
        (skill): skill is string => typeof skill === 'string',
      );
    }
    if (candidate.status === 'applied' || !candidate.status) {
      candidate.status = 'screening';
    }
    await new SaveCardCommand(this.commandContext).execute({
      card: candidate,
    });

    let extracted = [
      parsed.name && 'name',
      parsed.email && 'email',
      parsed.phone && 'phone',
      parsed.appliedRole && 'role',
      parsed.skills?.length && `${parsed.skills.length} skills`,
    ]
      .filter(Boolean)
      .join(', ');
    return new ExtractResumeResult({
      summary: `Extracted ${extracted || 'nothing new'} from the resume.`,
    });
  }
}
