import { CardDef, contains, field } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Command } from '@cardstack/runtime-common';
import OneShotLlmRequestCommand from '@cardstack/boxel-host/commands/one-shot-llm-request';

const SYSTEM_PROMPT = `You are a summarizer. The user message is a JSON object:
- "content": the material to summarize. The only source of facts — never add ones that are not in it.
- "focus": optional — the angle the summary should take.
- "style": optional — the requested form, e.g. "one sentence", "short paragraph", "bullets". Default: short paragraph.

OUTPUT: the summary only. No preamble, no "Here is", no sign-off.`;

export class SummarizeInput extends CardDef {
  @field content = contains(StringField, {
    description: 'The material to summarize — the only source of facts.',
  });
  @field focus = contains(StringField, {
    description: 'Optional angle, e.g. "what was accomplished".',
  });
  @field style = contains(StringField, {
    description: 'Optional form: "one sentence", "short paragraph", "bullets".',
  });
  @field llmModel = contains(StringField);
}

export class SummarizeResult extends CardDef {
  @field summary = contains(StringField);
}

/**
 * The generic summarization verb. Distinct from the kernel's Summarize
 * Session host tool (which summarizes an AI room): this one takes whatever
 * content the caller hands it — session notes, a thread, a document — plus
 * an optional focus and form. Gathering the content is the caller's job;
 * the block only promises the summary sticks to it.
 */
export default class SummarizeCommand extends Command<
  typeof SummarizeInput,
  typeof SummarizeResult
> {
  static actionVerb = 'Summarize';
  static displayName = 'Summarize with AI';

  async getInputType() {
    return SummarizeInput;
  }

  protected async run(input: SummarizeInput): Promise<SummarizeResult> {
    if (!input.content?.trim()) {
      throw new Error('content is required');
    }
    let oneShot = new OneShotLlmRequestCommand(this.commandContext);
    let result = await oneShot.execute({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: JSON.stringify({
        content: input.content,
        focus: input.focus || undefined,
        style: input.style || undefined,
      }),
      skillCardIds: [],
      llmModel: input.llmModel || 'anthropic/claude-sonnet-4.6',
    });
    let summary = (((result as any)?.output ?? '') as string).trim();
    if (!summary) {
      throw new Error('Summarizer returned nothing');
    }
    return new SummarizeResult({ summary });
  }
}
