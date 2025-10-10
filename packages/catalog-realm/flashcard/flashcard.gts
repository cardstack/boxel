// ═══ [EDIT TRACKING: ON] Mark all changes with ¹ ═══
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import LightbulbIcon from '@cardstack/boxel-icons/lightbulb'; // ⁴ Icon import

class FlashcardIsolated extends Component<typeof FlashcardCard> {
  // ⁹ Clean, focus-first isolated format
  @tracked showAnswer = false;

  @action
  toggleAnswer() {
    this.showAnswer = !this.showAnswer;
  }

  <template>
    <div class='flashcard-clean'>
      {{#if @model.subject}}
        <div class='study-header'>
          <div class='subject-badge'>
            {{@model.subject}}
            {{#if @model.difficulty}}
              •
              {{@model.difficulty}}
            {{/if}}
          </div>
        </div>
      {{/if}}

      <div class='card-stage'>
        <div class='flashcard'>
          <div class='card-content'>
            {{#if this.showAnswer}}
              <div class='content-type answer-type'>Answer</div>
              <div class='card-text'>
                {{#if @model.answer}}
                  <@fields.answer />
                {{else}}
                  <div class='placeholder'>No answer provided</div>
                {{/if}}
              </div>
            {{else}}
              <div class='content-type question-type'>Question</div>
              <div class='card-text'>
                {{#if @model.question}}
                  <@fields.question />
                {{else}}
                  <div class='placeholder'>No question provided</div>
                {{/if}}
              </div>
            {{/if}}
          </div>
        </div>

        <div class='flip-action'>
          <button class='flip-button' {{on 'click' this.toggleAnswer}}>
            {{if this.showAnswer 'Show Question' 'Show Answer'}}
          </button>
        </div>
      </div>
    </div>

    <style scoped>
      /* Clean, focus-first flashcard design */
      .flashcard-clean {
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        max-width: 42rem;
        margin: 0 auto;
        padding: 2rem;
        height: 100%;
        overflow-y: auto;
        background: #f8fafc;

        /* Minimal design tokens */
        --primary: #1e3a8a;
        --secondary: #059669;
        --surface: #ffffff;
        --text-primary: #1f2937;
        --text-secondary: #6b7280;
        --border: #e5e7eb;
        --radius: 12px;
      }

      /* Minimal header */
      .study-header {
        text-align: center;
        margin-bottom: 2rem;
      }

      .subject-badge {
        display: inline-block;
        background: rgba(30, 58, 138, 0.1);
        color: var(--primary);
        padding: 0.5rem 1rem;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 600;
      }

      /* Card stage - main focus */
      .card-stage {
        margin-bottom: 2rem;
      }

      .flashcard {
        background: var(--surface);
        border-radius: var(--radius);
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        border: 1px solid var(--border);
        overflow: hidden;
        transition: transform 0.2s ease;
      }

      .flashcard:hover {
        transform: translateY(-2px);
      }

      .card-content {
        padding: 3rem 2rem;
        text-align: center;
        min-height: 300px;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }

      .content-type {
        font-size: 0.875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.025em;
        margin-bottom: 2rem;
        opacity: 0.7;
      }

      .question-type {
        color: var(--primary);
      }

      .answer-type {
        color: var(--secondary);
      }

      .card-text {
        font-size: 1.25rem;
        line-height: 1.6;
        color: var(--text-primary);
      }

      .placeholder {
        color: var(--text-secondary);
        font-style: italic;
      }

      /* Action button with more spacing */
      .flip-action {
        text-align: center;
        margin-top: 3rem;
        margin-bottom: 2rem;
      }

      .flip-button {
        background: var(--primary);
        color: white;
        border: none;
        padding: 1rem 2rem;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(30, 58, 138, 0.2);
      }

      .flip-button:hover {
        background: #1d4ed8;
        transform: translateY(-1px);
      }

      /* Mobile responsive */
      @media (max-width: 768px) {
        .flashcard-clean {
          padding: 1rem;
        }

        .card-content {
          padding: 2rem 1rem;
          min-height: 200px;
        }

        .card-text {
          font-size: 1.125rem;
        }

        .score-buttons {
          flex-direction: column;
          gap: 0.75rem;
        }

        .stats-summary {
          flex-direction: column;
          gap: 0.5rem;
        }
      }
    </style>
  </template>
}

class FlashcardEmbedded extends Component<typeof FlashcardCard> {
  // ¹¹ Clean embedded format
  @tracked showAnswer = false;

  @action
  toggleAnswer() {
    this.showAnswer = !this.showAnswer;
  }

  <template>
    <div class='flashcard-embedded'>
      <div class='card-header'>
        {{#if @model.subject}}
          <div class='subject-badge'>
            {{@model.subject}}
          </div>
        {{/if}}
      </div>

      <div class='card-body'>
        <div class='content-area'>
          {{#if this.showAnswer}}
            <div class='content-type'>Answer</div>
            <div class='card-text'>
              {{#if @model.answer}}
                <@fields.answer />
              {{else}}
                <div class='placeholder'>No answer provided</div>
              {{/if}}
            </div>
          {{else}}
            <div class='content-type'>Question</div>
            <div class='card-text'>
              {{#if @model.question}}
                <@fields.question />
              {{else}}
                <div class='placeholder'>No question provided</div>
              {{/if}}
            </div>
          {{/if}}
        </div>

        <div class='card-actions'>
          <button class='flip-button' {{on 'click' this.toggleAnswer}}>
            {{if this.showAnswer 'Question' 'Answer'}}
          </button>
        </div>
      </div>

    </div>

    <style scoped>
      /* Clean embedded flashcard */
      .flashcard-embedded {
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
        background: #ffffff;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        font-size: 0.8125rem;
        display: flex;
        flex-direction: column;
        min-height: 220px;
        transition: all 0.2s ease;

        --primary: #1e3a8a;
        --secondary: #059669;
        --text-primary: #1f2937;
        --text-secondary: #6b7280;
        --border: #e5e7eb;
        --surface-subtle: #f8fafc;
      }

      .flashcard-embedded:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      }

      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 1rem 0;
      }

      .subject-badge {
        background: rgba(30, 58, 138, 0.1);
        color: var(--primary);
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.6875rem;
        font-weight: 600;
      }

      .card-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: 0 1rem;
      }

      .content-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        margin-bottom: 1rem;
      }

      .content-type {
        text-align: center;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.025em;
        margin-bottom: 1rem;
        color: var(--text-secondary);
      }

      .card-text {
        text-align: center;
        padding: 1rem;
        background: var(--surface-subtle);
        border-radius: 6px;
        min-height: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.875rem;
        line-height: 1.4;
        color: var(--text-primary);
        border: 1px solid rgba(226, 232, 240, 0.6);
      }

      .placeholder {
        color: var(--text-secondary);
        font-style: italic;
      }

      .card-actions {
        text-align: center;
        margin-bottom: 1rem;
      }

      .flip-button {
        background: var(--primary);
        color: white;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .flip-button:hover {
        background: #1d4ed8;
      }

      @media (max-width: 480px) {
        .card-text {
          padding: 0.75rem;
          min-height: 60px;
        }

        .card-footer {
          flex-direction: column;
          gap: 0.5rem;
          text-align: center;
        }
      }
    </style>
  </template>
}

export class FlashcardCard extends CardDef {
  // ⁵ Flashcard card definition
  static displayName = 'Flashcard';
  static icon = LightbulbIcon;

  @field question = contains(MarkdownField); // ⁶ Card front
  @field answer = contains(MarkdownField);
  @field difficulty = contains(StringField); // easy, medium, hard
  @field subject = contains(StringField);
  @field tags = contains(StringField); // comma-separated: "algorithms,binary-search,complexity"

  // ⁸ Computed title from question
  @field title = contains(StringField, {
    computeVia: function (this: FlashcardCard) {
      try {
        const question = this.question || 'Untitled Flashcard';
        const maxLength = 50;
        if (question.length <= maxLength) return question;
        return question.substring(0, maxLength - 3) + '...';
      } catch (e) {
        console.error('Flashcard: Error computing title', e);
        return 'Untitled Flashcard';
      }
    },
  });

  static isolated = FlashcardIsolated;

  static embedded = FlashcardEmbedded;
}
