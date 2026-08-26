import { CardDef, contains, field } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { Command } from '@cardstack/runtime-common';
import OneShotLlmRequestCommand from '@cardstack/boxel-host/commands/one-shot-llm-request';

const SYSTEM_PROMPT = `You are a recommender — a knowledgeable friend, not a manager. The user message is a JSON object:
- "goal": what the person is trying to achieve. The only authority on direction.
- "context": optional JSON facts about where they are now (history, current state). Ground every suggestion in these facts; never invent progress they have not made.
- "count": how many suggestions to return.

OUTPUT: ONE JSON array only, exactly "count" items, no prose, no markdown fences. Each item: {"title":"short actionable suggestion","reason":"one sentence tying it to the goal and the context facts"}.`;

export class RecommendInput extends CardDef {
  @field goal = contains(StringField, {
    description: 'What the person is trying to achieve.',
  });
  @field context = contains(StringField, {
    description: 'Optional JSON facts: current state, history.',
  });
  @field count = contains(NumberField, {
    description: 'How many suggestions. Default 3.',
  });
  @field llmModel = contains(StringField);
}

export class RecommendResult extends CardDef {
  @field suggestions = contains(StringField, {
    description: 'JSON array of {title, reason}.',
  });
}

/**
 * The generic suggestion verb: "given where I am, what next?" The block has
 * no opinion on the domain — next task for a quest, next clause for a
 * contract — the caller supplies the goal and the grounding facts, and gets
 * back a fixed-count JSON array of {title, reason}. Turning suggestions
 * into cards, and whether to take them at all, stays with the caller.
 */
export default class RecommendCommand extends Command<
  typeof RecommendInput,
  typeof RecommendResult
> {
  static actionVerb = 'Recommend';
  static displayName = 'Recommend with AI';

  async getInputType() {
    return RecommendInput;
  }

  protected async run(input: RecommendInput): Promise<RecommendResult> {
    if (!input.goal?.trim()) {
      throw new Error('goal is required');
    }
    let count =
      typeof input.count === 'number' && input.count > 0
        ? Math.floor(input.count)
        : 3;
    let payload: Record<string, unknown> = { goal: input.goal, count };
    if (input.context?.trim()) {
      try {
        payload.context = JSON.parse(input.context);
      } catch {
        throw new Error('context must be a JSON string');
      }
    }

    let oneShot = new OneShotLlmRequestCommand(this.commandContext);
    let result = await oneShot.execute({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: JSON.stringify(payload),
      skillCardIds: [],
      llmModel: input.llmModel || 'anthropic/claude-sonnet-4.6',
    });

    let raw = (((result as any)?.output ?? '') as string).trim();
    let start = raw.indexOf('[');
    let end = raw.lastIndexOf(']');
    if (start < 0 || end <= start) {
      throw new Error(`Recommender returned no JSON array: ${raw.slice(0, 200)}`);
    }
    let sliced = raw.slice(start, end + 1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(sliced);
    } catch {
      throw new Error(
        `Recommender returned invalid JSON: ${raw.slice(0, 200)}`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Recommender returned JSON that is not an array');
    }
    return new RecommendResult({ suggestions: sliced });
  }
}
