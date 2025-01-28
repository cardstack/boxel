import { CardDef, Component } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import SetActiveLLMCommand from '@cardstack/boxel-host/commands/set-active-llm';
import CreateAiAssistantRoomCommand from '@cardstack/boxel-host/commands/create-ai-assistant-room';
import OpenAiAssistantRoomCommand from '@cardstack/boxel-host/commands/open-ai-assistant-room';
import { Button } from '@cardstack/boxel-ui/components';

class IsolatedTemplate extends Component<typeof SetLlmExample> {
  @tracked modelId = 'microsoft/phi-4';
  @tracked currentRoomId: string | null = null;

  @action
  async createRoom() {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) return;

    let createAIAssistantRoomCommand = new CreateAiAssistantRoomCommand(
      commandContext,
    );
    let { roomId } = await createAIAssistantRoomCommand.execute({
      name: `Chat with ${this.modelId}`,
    });

    let openAiAssistantRoomCommand = new OpenAiAssistantRoomCommand(
      commandContext,
    );
    await openAiAssistantRoomCommand.execute({
      roomId,
    });

    this.currentRoomId = roomId;
  }

  @action
  async setLLM() {
    if (!this.currentRoomId) return;

    let commandContext = this.args.context?.commandContext;
    if (!commandContext) return;

    let setActiveLLMCommand = new SetActiveLLMCommand(commandContext);

    await setActiveLLMCommand.execute({
      model: this.modelId,
      roomId: this.currentRoomId,
    });
  }

  @action
  updatemodelId(event: Event) {
    this.modelId = (event.target as HTMLInputElement).value;
  }

  <template>
    <div class='llm-setter'>
      <div class='content'>
        <div class='input-section'>
          <label for='llm-model-name-input'>LLM Model Name</label>
          <input
            type='text'
            value={{this.modelId}}
            {{on 'input' this.updatemodelId}}
            class='model-input'
            id='llm-model-name-input'
          />
        </div>

        <div class='buttons-section'>
          <Button
            class='create-button'
            data-test-create-room
            {{on 'click' this.createRoom}}
          >
            Create Room
          </Button>

          <Button
            class='set-button'
            data-test-set-llm
            {{on 'click' this.setLLM}}
          >
            Set Active LLM
          </Button>
        </div>

        {{#if this.currentRoomId}}
          <div class='room-info'>
            <span class='room-label'>Room ID:</span>
            <span class='room-id'>{{this.currentRoomId}}</span>
          </div>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .llm-setter {
        max-width: 600px;
        margin: 0 auto;
        padding: 2rem;
      }

      .content {
        background: white;
        border-radius: 16px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
        padding: 1.5rem;
      }

      .input-section {
        margin-bottom: 1.5rem;
      }

      .input-section label {
        display: block;
        margin-bottom: 0.5rem;
        color: #7f8c8d;
        font-size: 0.9rem;
      }

      .model-input {
        width: 100%;
        padding: 0.75rem;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        font-size: 1rem;
        transition: border-color 0.2s;
      }

      .model-input:focus {
        outline: none;
        border-color: #34d399;
        box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.2);
      }

      .buttons-section {
        display: flex;
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .create-button,
      .set-button {
        flex: 1;
        padding: 0.75rem 1.5rem;
        font-size: 1.1rem;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition:
          transform 0.2s,
          box-shadow 0.2s;
      }

      .create-button {
        background: linear-gradient(135deg, #4f46e5, #3730a3);
      }

      .set-button {
        background: linear-gradient(135deg, #34d399, #059669);
      }

      .create-button:hover,
      .set-button:hover {
        transform: translateY(-1px);
      }

      .create-button:hover {
        box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
      }

      .set-button:hover {
        box-shadow: 0 4px 12px rgba(52, 211, 153, 0.3);
      }

      .set-button[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }

      .room-info {
        margin-top: 1rem;
        padding: 1rem;
        background: #f8fafc;
        border-radius: 8px;
        font-size: 0.9rem;
      }

      .room-label {
        color: #64748b;
        margin-right: 0.5rem;
      }

      .room-id {
        color: #1e293b;
        font-family: monospace;
        font-size: 0.95rem;
      }
    </style>
  </template>
}

export class SetLlmExample extends CardDef {
  static displayName = 'SetLLMExample';

  static isolated = IsolatedTemplate;
}
