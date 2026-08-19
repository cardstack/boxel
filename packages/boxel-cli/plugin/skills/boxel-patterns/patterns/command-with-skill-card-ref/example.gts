import { CardDef, field, contains, StringField, Component } from 'https://cardstack.com/base/card-api';
// 🎯 NEWER PATH (2026-05+): tools/ai-assistant (was commands/use-ai-assistant).
//    Symbol is still `UseAiAssistantCommand`.
import UseAiAssistantCommand from '@cardstack/boxel-host/tools/ai-assistant';
import SetActiveLLMCommand from '@cardstack/boxel-host/tools/set-active-llm';
import { Button } from '@cardstack/boxel-ui/components';

// 🧩 PATTERN: Card-triggered AI Room
//
// 1. Build a skill-card URL relative to THIS module via `import.meta.url`.
// 2. Pass `attachedCards` so the LLM sees the source data.
// 3. Optionally pin the model via SetActiveLLMCommand.

export class TopicCard extends CardDef {
  static displayName = 'Topic';

  @field cardTitle = contains(StringField);
  @field summary = contains(StringField);

  static isolated = class extends Component<typeof TopicCard> {
    askAssistant = async () => {
      let { commandContext } = this.args.context!;

      // (1) Skill card URL — sibling folder in this realm.
      // @ts-expect-error import.meta is supported by the Boxel host
      let skillCardId = new URL('../Skill/topic-explainer', import.meta.url).href;

      // (2) Open the AI room with this card attached as context.
      await new UseAiAssistantCommand(commandContext).execute({
        skillCardId,
        attachedCards: [this.args.model],
        llmMode: 'ask', // or 'act' if the skill mutates cards
      });

      // (3) Optional: pin the LLM mode for this conversation.
      await new SetActiveLLMCommand(commandContext).execute({
        mode: 'anthropic/claude-sonnet-4.6',
      });
    };

    <template>
      <article class='topic'>
        <h2>{{@model.cardTitle}}</h2>
        <p>{{@model.summary}}</p>
        <Button {{on 'click' this.askAssistant}}>Ask AI to explain</Button>
      </article>
    </template>
  };
}
