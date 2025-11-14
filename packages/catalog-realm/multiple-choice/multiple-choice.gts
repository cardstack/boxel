import NumberField from 'https://cardstack.com/base/number';
import {
  CardDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DatetimeField from 'https://cardstack.com/base/datetime';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq, or, bool } from '@cardstack/boxel-ui/helpers';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { Command } from '@cardstack/runtime-common';
import UseAiAssistantCommand from '@cardstack/boxel-host/commands/ai-assistant';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

class MultipleChoiceEmbedded extends Component<typeof MultipleChoice> {
  @tracked isSending = false;
  @tracked errorMessage: string | null = null;
  @tracked selectedOption: string | null = null;
  @tracked selectedIndex: number | null = null;
  @tracked hasResponded = false;

  constructor(owner: any, args: any) {
    super(owner, args);
    // If card already has a selectedOption, show confirmation screen
    if (this.args.model?.selectedOption) {
      this.selectedOption = this.args.model.selectedOption;
      // Find the index of the selected option
      const options = this.args.model.options || [];
      this.selectedIndex = options.indexOf(this.selectedOption);
      this.hasResponded = true;
    }
  }

  getOptionLetter(index: number | null): string {
    if (index === null) {
      return '';
    }
    return String.fromCharCode(65 + index); // A, B, C, D, etc.
  }

  @action
  clearError() {
    this.errorMessage = null;
    this.selectedOption = null;
    this.selectedIndex = null;
  }

  @action
  async sendMessage(option: string, index: number) {
    const roomId = this.args.model?.roomId;
    if (!roomId) {
      this.errorMessage = 'No room ID available';
      console.error('No room ID available');
      return;
    }

    const commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.errorMessage = 'Command context not available';
      console.error('Command context not available');
      return;
    }

    this.isSending = true;
    this.errorMessage = null;
    this.selectedOption = option;
    this.selectedIndex = index;

    try {
      // Send the message
      const useAiAssistantCommand = new UseAiAssistantCommand(commandContext);
      await useAiAssistantCommand.execute({
        roomId,
        prompt: option,
      });

      // Persist the selected option to the card
      if (this.args.model?.id) {
        const patchCommand = new PatchCardInstanceCommand(commandContext, {
          cardType: MultipleChoice,
        });
        await patchCommand.execute({
          cardId: this.args.model.id,
          patch: {
            attributes: {
              selectedOption: option,
            },
          },
        });
      }

      // Mark as responded after successful send
      this.hasResponded = true;
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : 'Failed to send message';
      console.error('Error sending message:', error);
      this.selectedOption = null;
      this.selectedIndex = null;
    } finally {
      this.isSending = false;
    }
  }

  <template>
    <div class='gameshow-container {{if this.hasResponded "completed"}}'>
      <div class='spotlight-effect'></div>
      <div class='confetti-bg'></div>

      {{#if this.errorMessage}}
        <div class='error-message'>
          ❌
          {{this.errorMessage}}
          <button class='retry-btn' {{on 'click' this.clearError}}>Try Again</button>
        </div>
      {{/if}}

      {{#if this.hasResponded}}
        <div class='response-confirmed'>
          <div class='checkmark-circle'>
            <svg class='checkmark' viewBox='0 0 52 52'>
              <circle
                class='checkmark-circle-bg'
                cx='26'
                cy='26'
                r='25'
                fill='none'
              />
              <path
                class='checkmark-check'
                fill='none'
                d='M14.1 27.2l7.1 7.2 16.7-16.8'
              />
            </svg>
          </div>
          <div class='confirm-message'>Your choice has been sent</div>
          <div class='chosen-option'>
            <span class='chosen-letter'>{{this.getOptionLetter
                this.selectedIndex
              }}</span>
            <span class='chosen-text'>{{this.selectedOption}}</span>
          </div>
          <div class='waiting-message'>Waiting for narrator...</div>
        </div>
      {{else}}
        <div class='gameshow-title'>
          <span class='title-text'>Make Your Choice!</span>
          <div class='title-underline'></div>
        </div>

        <div class='options-grid'>
          {{#each @model.options as |option index|}}
            <button
              class='gameshow-button option-{{index}}
                {{if (eq this.selectedOption option) "selected"}}'
              disabled={{or this.isSending (bool this.selectedOption)}}
              {{on 'click' (fn this.sendMessage option index)}}
            >
              <div class='button-shine'></div>
              <div class='button-content'>
                <span class='option-letter'>{{this.getOptionLetter
                    index
                  }}</span>
                <span class='option-text'>{{option}}</span>
              </div>
              <div class='button-glow'></div>
              {{#if (eq this.selectedOption option)}}
                <div class='selection-indicator'>✓</div>
              {{/if}}
            </button>
          {{/each}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      @keyframes pulse {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.05);
        }
      }

      @keyframes shimmer {
        0% {
          background-position: -1000px 0;
        }
        100% {
          background-position: 1000px 0;
        }
      }

      @keyframes glow {
        0%,
        100% {
          opacity: 0.5;
        }
        50% {
          opacity: 1;
        }
      }

      @keyframes rotate {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .gameshow-container {
        position: relative;
        padding: 0.75rem;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        overflow: hidden;
        width: 100%;
        min-height: fit-content;
      }

      .spotlight-effect {
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(
          circle,
          rgba(255, 255, 255, 0.1) 0%,
          transparent 70%
        );
        animation: rotate 20s linear infinite;
        pointer-events: none;
      }

      .confetti-bg {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-image:
          radial-gradient(circle, #fbbf24 2px, transparent 2px),
          radial-gradient(circle, #ef4444 2px, transparent 2px),
          radial-gradient(circle, #3b82f6 2px, transparent 2px),
          radial-gradient(circle, #10b981 2px, transparent 2px);
        background-size:
          50px 50px,
          80px 80px,
          60px 60px,
          70px 70px;
        background-position:
          0 0,
          40px 40px,
          20px 20px,
          50px 10px;
        opacity: 0.2;
        pointer-events: none;
      }

      .gameshow-title {
        position: relative;
        text-align: center;
        margin-bottom: 0.5rem;
        z-index: 1;
      }

      .title-text {
        display: inline-block;
        font-size: 0.875rem;
        font-weight: 800;
        color: #ffffff;
        text-shadow:
          0 0 6px rgba(255, 215, 0, 0.7),
          0 0 10px rgba(255, 215, 0, 0.5),
          1px 1px 0 rgba(0, 0, 0, 0.3);
        letter-spacing: 0.5px;
        animation: pulse 2s ease-in-out infinite;
      }

      .title-underline {
        height: 1.5px;
        width: 40%;
        margin: 0.125rem auto 0;
        background: linear-gradient(90deg, transparent, #fbbf24, transparent);
        border-radius: 1px;
        animation: shimmer 3s infinite;
      }

      .options-grid {
        position: relative;
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.375rem;
        z-index: 1;
      }

      .gameshow-button {
        position: relative;
        padding: 0;
        background: linear-gradient(145deg, #fbbf24, #f59e0b);
        border: 2px solid #fff;
        cursor: pointer;
        transition: all 0.3s ease;
        overflow: hidden;
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.25),
          inset 0 1px 0 rgba(255, 255, 255, 0.4);
      }

      .gameshow-button.option-0 {
        background: linear-gradient(145deg, #ef4444, #dc2626);
      }

      .gameshow-button.option-1 {
        background: linear-gradient(145deg, #3b82f6, #2563eb);
      }

      .gameshow-button.option-2 {
        background: linear-gradient(145deg, #10b981, #059669);
      }

      .gameshow-button.option-3 {
        background: linear-gradient(145deg, #f59e0b, #d97706);
      }

      .gameshow-button.option-4 {
        background: linear-gradient(145deg, #8b5cf6, #7c3aed);
      }

      .gameshow-button.option-5 {
        background: linear-gradient(145deg, #ec4899, #db2777);
      }

      .button-shine {
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.3),
          transparent
        );
        transition: left 0.5s;
      }

      .gameshow-button:hover .button-shine {
        left: 100%;
      }

      .button-content {
        position: relative;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.625rem;
        z-index: 1;
      }

      .option-letter {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        background: rgba(255, 255, 255, 0.3);
        border: 1.5px solid rgba(255, 255, 255, 0.8);
        border-radius: 50%;
        font-size: 0.625rem;
        font-weight: 900;
        color: #fff;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
        flex-shrink: 0;
      }

      .option-text {
        font-size: 0.8125rem;
        font-weight: 600;
        color: #fff;
        text-align: left;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
        flex: 1;
        line-height: 1.3;
      }

      .button-glow {
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(
          circle,
          rgba(255, 255, 255, 0.3) 0%,
          transparent 70%
        );
        opacity: 0;
        transition: opacity 0.3s;
      }

      .gameshow-button:hover {
        transform: translateY(-2px) scale(1.01);
        box-shadow:
          0 6px 16px rgba(0, 0, 0, 0.35),
          inset 0 1px 0 rgba(255, 255, 255, 0.5),
          0 0 15px rgba(255, 255, 255, 0.3);
      }

      .gameshow-button:hover .button-glow {
        opacity: 1;
        animation: glow 1.5s ease-in-out infinite;
      }

      .gameshow-button:active {
        transform: translateY(-2px) scale(0.98);
      }

      .gameshow-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }

      .gameshow-button:disabled:hover {
        transform: none;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
      }

      .error-message {
        position: relative;
        padding: 0.375rem 0.5rem;
        margin-bottom: 0.375rem;
        background: linear-gradient(135deg, #fef2f2, #fee2e2);
        border: 1.5px solid #ef4444;
        color: #991b1b;
        font-weight: 600;
        font-size: 0.6875rem;
        text-align: center;
        box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }

      .retry-btn {
        padding: 0.25rem 0.5rem;
        background: #fff;
        border: 1px solid #ef4444;
        color: #dc2626;
        font-size: 0.625rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }

      .retry-btn:hover {
        background: #fef2f2;
        transform: translateY(-1px);
      }

      /* Selected state styling */
      .gameshow-button.selected {
        transform: scale(0.95);
        opacity: 0.8;
        box-shadow: inset 0 4px 12px rgba(0, 0, 0, 0.4);
      }

      .selection-indicator {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 2rem;
        color: white;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
        z-index: 10;
        animation: checkmark-pop 0.3s ease-out;
      }

      @keyframes checkmark-pop {
        0% {
          transform: translate(-50%, -50%) scale(0);
        }
        50% {
          transform: translate(-50%, -50%) scale(1.2);
        }
        100% {
          transform: translate(-50%, -50%) scale(1);
        }
      }

      /* Response confirmed state */
      .response-confirmed {
        position: relative;
        text-align: center;
        padding: 1.5rem 0.75rem;
        z-index: 1;
      }

      .checkmark-circle {
        margin: 0 auto 0.75rem;
        width: 4rem;
        height: 4rem;
      }

      .checkmark {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        display: block;
        stroke-width: 2;
        stroke: #fff;
        stroke-miterlimit: 10;
        box-shadow: inset 0 0 0 #10b981;
        animation:
          fill 0.4s ease-in-out 0.4s forwards,
          scale 0.3s ease-in-out 0.9s both;
      }

      .checkmark-circle-bg {
        stroke-dasharray: 166;
        stroke-dashoffset: 166;
        stroke-width: 2;
        stroke-miterlimit: 10;
        stroke: #10b981;
        fill: none;
        animation: stroke 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards;
      }

      .checkmark-check {
        transform-origin: 50% 50%;
        stroke-dasharray: 48;
        stroke-dashoffset: 48;
        stroke: #fff;
        stroke-width: 3;
        animation: stroke 0.3s cubic-bezier(0.65, 0, 0.45, 1) 0.8s forwards;
      }

      @keyframes stroke {
        100% {
          stroke-dashoffset: 0;
        }
      }

      @keyframes scale {
        0%,
        100% {
          transform: none;
        }
        50% {
          transform: scale3d(1.1, 1.1, 1);
        }
      }

      @keyframes fill {
        100% {
          box-shadow: inset 0 0 0 2rem #10b981;
        }
      }

      .confirm-message {
        font-size: 1rem;
        font-weight: 700;
        color: #fff;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        margin-bottom: 0.75rem;
      }

      .chosen-option {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.625rem 1rem;
        background: rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(8px);
        border: 2px solid rgba(255, 255, 255, 0.4);
        margin-bottom: 0.75rem;
      }

      .chosen-letter {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        background: rgba(255, 255, 255, 0.3);
        border: 2px solid rgba(255, 255, 255, 0.8);
        border-radius: 50%;
        font-size: 0.75rem;
        font-weight: 900;
        color: #fff;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
      }

      .chosen-text {
        font-size: 0.875rem;
        font-weight: 600;
        color: #fff;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
      }

      .waiting-message {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.9);
        font-style: italic;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }

      .gameshow-container.completed {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      }

      @media (max-width: 768px) {
        .gameshow-container {
          padding: 0.625rem;
        }

        .title-text {
          font-size: 0.8125rem;
        }

        .button-content {
          padding: 0.4375rem 0.5625rem;
        }

        .option-letter {
          width: 1.125rem;
          height: 1.125rem;
          font-size: 0.5625rem;
        }

        .option-text {
          font-size: 0.75rem;
        }
      }
    </style>
  </template>
}

export class MultipleChoice extends CardDef {
  static displayName = 'Multiple Choice';

  @field options = containsMany(StringField);
  @field roomId = contains(StringField);
  @field selectedOption = contains(StringField); // What user chose
  @field turnNumber = contains(NumberField); // Context
  @field timestamp = contains(DatetimeField); // When offered

  static embedded = MultipleChoiceEmbedded;
}

class SuggestActionInput extends CardDef {
  @field options = containsMany(StringField);
  @field roomId = contains(StringField);
  @field realmHref = contains(StringField); // Where to save the card
}

export class SuggestAction extends Command<
  typeof SuggestActionInput,
  typeof MultipleChoice
> {
  static displayName = 'Suggest Action';

  async getInputType() {
    return SuggestActionInput;
  }

  protected async run(input: SuggestActionInput): Promise<MultipleChoice> {
    const multipleChoice = new MultipleChoice();
    multipleChoice.options = input.options;
    multipleChoice.roomId = input.roomId;

    // Create a proper Date object and convert to ISO string for DatetimeField
    const now = new Date();
    multipleChoice.timestamp = now;

    // Save the card to the realm
    await new SaveCardCommand(this.commandContext).execute({
      card: multipleChoice,
      realm: input.realmHref,
    });

    // Now the card has an ID and can be linked
    return multipleChoice;
  }
}
