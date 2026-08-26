import { CardDef, contains, field } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Command } from '@cardstack/runtime-common';
import OneShotLlmRequestCommand from '@cardstack/boxel-host/commands/one-shot-llm-request';

const SYSTEM_PROMPT = `You are a generator. The user message is a JSON object with up to three keys:
- "instructions": what to produce — the only authority on content, tone and scope. Follow exactly.
- "context": optional JSON facts to ground the output. Use only these facts where facts are needed; never invent ones that contradict them.
- "shape": optional description of the JSON structure the output must have.

OUTPUT: if "shape" is present, ONE JSON value matching it — no prose, no markdown fences. Otherwise plain text with no preamble and no sign-off.`;

export class GenerateInput extends CardDef {
  @field instructions = contains(StringField, {
    description: 'What to produce. The only authority on content and scope.',
  });
  @field context = contains(StringField, {
    description: 'Optional JSON facts to ground the output.',
  });
  @field shape = contains(StringField, {
    description:
      'Optional JSON shape the output must match. Present = output is JSON only.',
  });
  @field llmModel = contains(StringField);
}

export class GenerateResult extends CardDef {
  @field output = contains(StringField);
}

/**
 * The generic generation verb: instructions in, artifact out. The block has
 * no opinion on what is being made — a learning plan, a template, a draft —
 * the caller supplies the instructions, the grounding facts, and (when the
 * output must be machine-readable) the shape. Parsing the result into cards
 * is the caller's job; this block only guarantees that a shaped request
 * returns valid JSON or throws.
 */
export default class GenerateCommand extends Command<
  typeof GenerateInput,
  typeof GenerateResult
> {
  static actionVerb = 'Generate';
  static displayName = 'Generate with AI';

  async getInputType() {
    return GenerateInput;
  }

  protected async run(input: GenerateInput): Promise<GenerateResult> {
    if (!input.instructions?.trim()) {
      throw new Error('instructions is required');
    }
    let payload: Record<string, unknown> = {
      instructions: input.instructions,
    };
    if (input.context?.trim()) {
      try {
        payload.context = JSON.parse(input.context);
      } catch {
        throw new Error('context must be a JSON string');
      }
    }
    if (input.shape?.trim()) {
      payload.shape = input.shape;
    }

    let oneShot = new OneShotLlmRequestCommand(this.commandContext);
    let result = await oneShot.execute({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: JSON.stringify(payload),
      skillCardIds: [],
      llmModel: input.llmModel || 'anthropic/claude-sonnet-4.6',
    });

    let raw = (((result as any)?.output ?? '') as string).trim();
    if (!input.shape?.trim()) {
      return new GenerateResult({ output: raw });
    }

    let objStart = raw.indexOf('{');
    let arrStart = raw.indexOf('[');
    let start =
      objStart < 0 ? arrStart : arrStart < 0 ? objStart : Math.min(objStart, arrStart);
    let end = raw[start] === '{' ? raw.lastIndexOf('}') : raw.lastIndexOf(']');
    if (start < 0 || end <= start) {
      throw new Error(`Generator returned no JSON: ${raw.slice(0, 200)}`);
    }
    let sliced = raw.slice(start, end + 1);
    try {
      JSON.parse(sliced);
    } catch {
      throw new Error(`Generator returned invalid JSON: ${raw.slice(0, 200)}`);
    }
    return new GenerateResult({ output: sliced });
  }
}
