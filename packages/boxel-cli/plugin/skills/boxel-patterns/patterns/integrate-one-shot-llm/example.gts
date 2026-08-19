import { CardDef, field, contains, StringField, Component } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { Button } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import OneShotLlmRequestCommand from '@cardstack/boxel-host/tools/one-shot-llm-request';

// 🧩 PATTERN: One-shot LLM call via OpenRouter (no conversation, no skill).
//
// Use OneShotLlmRequestCommand for single calls. Use command-with-skill-card-ref
// when you want a back-and-forth conversation in the AI room.

export class TextParser extends CardDef {
  static displayName = 'Text Parser';

  @field rawInput = contains(StringField);
  @field structured = contains(StringField); // JSON-string output

  static isolated = class extends Component<typeof TextParser> {
    @tracked status: 'idle' | 'loading' | 'success' | 'error' = 'idle';
    @tracked errorMessage = '';

    parseTask = restartableTask(async () => {
      this.status = 'loading';
      try {
        let { commandContext } = this.args.context!;
        let llm = new OneShotLlmRequestCommand(commandContext);

        let result = await llm.execute({
          systemPrompt: 'Extract structured fields from the input. Output JSON only.',
          userPrompt: this.args.model.rawInput ?? '',
          llmModel: 'anthropic/claude-haiku-4.5',
        });

        // Result shape varies — unwrap defensively.
        let output = (result as any)?.output
          ?? (result as any)?.attributes?.output
          ?? '';

        this.args.model.structured = String(output);
        this.status = 'success';
      } catch (err: any) {
        this.errorMessage = err?.message ?? 'Unknown error';
        this.status = 'error';
      }
    });

    @action runParse() { this.parseTask.perform(); }

    <template>
      <article>
        <h2>Text Parser</h2>
        <p><strong>Input:</strong> {{@model.rawInput}}</p>

        <Button {{on 'click' this.runParse}} disabled={{this.parseTask.isRunning}}>
          {{#if this.parseTask.isRunning}}Parsing…{{else}}Parse with LLM{{/if}}
        </Button>

        {{#if (eq this.status 'success')}}
          <pre>{{@model.structured}}</pre>
        {{else if (eq this.status 'error')}}
          <p class='error'>Error: {{this.errorMessage}}</p>
        {{/if}}
      </article>
    </template>
  };
}
