import {
  CardDef,
  field,
  contains,
  linksTo,
  realmURL,
  StringField,
} from '@cardstack/base/card-api';
import { Command, codeRef } from '@cardstack/runtime-common';
import OneShotLlmRequestCommand from '@cardstack/boxel-host/commands/one-shot-llm-request';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { SearchCardsByQueryCommand } from '@cardstack/boxel-host/commands/search-cards';

import { Candidate } from '../candidate';
import { Skill } from '../skill';
import { WorkHistoryEntryField } from '../work-history-entry-field';
import { EducationEntryField } from '../education-entry-field';

const here: string = import.meta.url;
const skillRef = codeRef(here, '../skill', 'Skill');

const SYSTEM_PROMPT = `You are a resume parser. You are given raw resume text.
Extract the candidate's details and reply with ONE JSON object only — no prose, no markdown fences. Shape:
{"name":"<full name or null>","email":"<email or null>","phone":"<phone or null>","appliedRole":"<most recent/likely target role or null>","skills":["<skill>", ...],"workHistory":[{"company":"<company or null>","title":"<title or null>","startDate":"<ISO date YYYY-MM-DD or null>","endDate":"<ISO date YYYY-MM-DD or null>"}],"education":[{"school":"<school or null>","degree":"<degree or null>","fieldOfStudy":"<field of study or null>","graduationYear":<year as a number or null>}]}
Rules: skills is a flat list of up to 12 concrete skills/technologies actually present in the resume; workHistory and education are flat lists of the jobs/schools actually present in the resume, in the order they appear; use null for anything not found; never invent data.`;

interface ParsedResume {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  appliedRole?: string | null;
  skills?: string[] | null;
  workHistory?: Array<{
    company?: string | null;
    title?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  }> | null;
  education?: Array<{
    school?: string | null;
    degree?: string | null;
    fieldOfStudy?: string | null;
    graduationYear?: number | null;
  }> | null;
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
    if (
      Array.isArray(parsed.workHistory) &&
      parsed.workHistory.length &&
      !candidate.workHistory?.length
    ) {
      candidate.workHistory = parsed.workHistory
        .filter((entry) => entry && (entry.company || entry.title))
        .map(
          (entry) =>
            new WorkHistoryEntryField({
              company: entry.company ?? undefined,
              title: entry.title ?? undefined,
              startDate: entry.startDate
                ? new Date(entry.startDate)
                : undefined,
              endDate: entry.endDate ? new Date(entry.endDate) : undefined,
            }),
        );
    }
    if (
      Array.isArray(parsed.education) &&
      parsed.education.length &&
      !candidate.education?.length
    ) {
      candidate.education = parsed.education
        .filter((entry) => entry && entry.school)
        .map(
          (entry) =>
            new EducationEntryField({
              school: entry.school ?? undefined,
              degree: entry.degree ?? undefined,
              fieldOfStudy: entry.fieldOfStudy ?? undefined,
              graduationYear:
                typeof entry.graduationYear === 'number'
                  ? entry.graduationYear
                  : undefined,
            }),
        );
    }
    let matchedSkills: Skill[] = [];
    let newSkillCount = 0;
    if (Array.isArray(parsed.skills) && parsed.skills.length) {
      let rawNames = parsed.skills.filter(
        (skill): skill is string => typeof skill === 'string',
      );
      let names = rawNames.map((name) => name.toLowerCase().trim());
      let search = new SearchCardsByQueryCommand(this.commandContext);
      let searchResult = await search.execute({
        query: { filter: { type: skillRef } },
      });
      let existingSkills = (searchResult.instances ?? []) as Skill[];
      matchedSkills = existingSkills.filter((skill) =>
        names.includes((skill.name ?? '').toLowerCase().trim()),
      );

      // Skills the model surfaced that don't exist in the library yet — create
      // them rather than silently dropping them, so the extraction reflects
      // what the resume actually says.
      let matchedNames = new Set(
        matchedSkills.map((skill) => (skill.name ?? '').toLowerCase().trim()),
      );
      let unmatchedNames = rawNames.filter(
        (name) => !matchedNames.has(name.toLowerCase().trim()),
      );
      if (unmatchedNames.length) {
        let realm = candidate[realmURL]?.href;
        for (let name of unmatchedNames) {
          let skill = new Skill({ name, category: 'tool' });
          let saved = (await new SaveCardCommand(this.commandContext).execute({
            card: skill,
            realm,
          } as any)) as Skill;
          matchedSkills.push(saved);
          newSkillCount++;
        }
      }

      if (matchedSkills.length) {
        candidate.skills = matchedSkills;
      }
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
      candidate.workHistory?.length && 'work history',
      candidate.education?.length && 'education',
      matchedSkills.length &&
        `${matchedSkills.length} skills${
          newSkillCount ? ` (${newSkillCount} new)` : ''
        }`,
    ]
      .filter(Boolean)
      .join(', ');
    return new ExtractResumeResult({
      summary: `Extracted ${extracted || 'nothing new'} from the resume.`,
    });
  }
}
