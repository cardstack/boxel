import { CardDef, contains, field } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { Command } from '@cardstack/runtime-common';
import OneShotLlmRequestCommand from '@cardstack/boxel-host/commands/one-shot-llm-request';

const SYSTEM_PROMPT = `You are a classifier. The user message is a JSON object with two keys:
- "criteria": the caller's rules — what is being classified, which labels are allowed, how to score, and what signals matter. These rules are the only authority; follow them exactly.
- "facts": a JSON object describing the one item to classify. Use only these facts. Never invent facts that are not present.

OUTPUT: ONE JSON object only. No prose, no markdown fences. Shape:
{"label":"<one of the caller's allowed labels>","score":<number on the caller's scale>,"rationale":"one short sentence citing the facts that drove the result"}`;

export class ClassifyInput extends CardDef {
  @field criteria = contains(StringField, {
    description:
      'Domain rules: allowed labels, scoring scale, and which signals matter.',
  });
  @field facts = contains(StringField, {
    description: 'JSON object describing the item to classify.',
  });
  @field llmModel = contains(StringField);
}

export class ClassifyResult extends CardDef {
  @field label = contains(StringField);
  @field score = contains(NumberField);
  @field rationale = contains(StringField);
}

export default class ClassifyCommand extends Command<
  typeof ClassifyInput,
  typeof ClassifyResult
> {
  static actionVerb = 'Classify';
  static displayName = 'Classify with AI';

  async getInputType() {
    return ClassifyInput;
  }

  protected async run(input: ClassifyInput): Promise<ClassifyResult> {
    if (!input.criteria) throw new Error('criteria is required');
    if (!input.facts) throw new Error('facts is required');
    let facts: unknown;
    try {
      facts = JSON.parse(input.facts);
    } catch {
      throw new Error('facts must be a JSON string');
    }

    let oneShot = new OneShotLlmRequestCommand(this.commandContext);
    let result = await oneShot.execute({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: JSON.stringify({ criteria: input.criteria, facts }),
      skillCardIds: [],
      llmModel: input.llmModel || 'anthropic/claude-sonnet-4.6',
    });

    let raw = ((result as any)?.output ?? '') as string;
    let start = raw.indexOf('{');
    let end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error(`Classifier returned no JSON: ${raw.slice(0, 200)}`);
    }
    let parsed: { label?: unknown; score?: unknown; rationale?: unknown };
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      throw new Error(`Classifier returned invalid JSON: ${raw.slice(0, 200)}`);
    }
    let score = Number(parsed.score);
    return new ClassifyResult({
      label: typeof parsed.label === 'string' ? parsed.label : undefined,
      score: Number.isFinite(score) ? score : undefined,
      rationale:
        typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
    });
  }
}
