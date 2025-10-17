import { fn } from '@ember/helper';
import {
  CardDef,
  Component,
  field,
  contains,
  getField,
} from 'https://cardstack.com/base/card-api';
import DatetimeField from 'https://cardstack.com/base/datetime';
import StringField from 'https://cardstack.com/base/string';
import { tracked } from '@glimmer/tracking';
import { Button } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';
import Modifier from 'ember-modifier';
import * as chrono from 'https://cdn.skypack.dev/chrono-node@2.7.6';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';

// Auto-save modifier
class AutoSaveModifier extends Modifier {
  prevValue: unknown = null;

  modify(_element: Element, _positional: unknown[], named: { value: unknown; onSave: () => void }) {
    const { value, onSave } = named;
    if (this.prevValue !== null && this.prevValue !== value) {
      onSave();
    }
    this.prevValue = value;
  }
}

// FlexDateTimeField extends DatetimeField to inherit date functionality
export class FlexDateTimeField extends DatetimeField {
  static displayName = 'Flex DateTime Field';
  


  // Get the component class based on format and variant
  static getComponent(format: string, variant?: string): any {
    if (format === 'edit') {
      // Default to smart variant for edit mode (supports @fields delegation)
      if (variant === 'standard') {
        return StandardEditComponent;
      }
      return SmartEditComponent;
    } else if (format === 'embedded') {
      return EmbeddedComponent;
    } else if (format === 'atom') {
      return AtomComponent;
    } else if (format === 'fitted') {
      return FittedComponent;
    }
    // Default to embedded
    return EmbeddedComponent;
  }
}

// Standard edit component - reimplements DatetimeField's edit logic
class StandardEditComponent extends Component<typeof FlexDateTimeField> {
  
  parseInput = (date: string) => {
    if (!date?.length) {
      if (this.args.card && this.args.fieldName) {
        this.args.card[this.args.fieldName] = null;
        this.args.context?.actions?.saveCard?.();
      }
      return;
    }
    
    // Parse ISO date string to Date object
    const parsedDate = new Date(date);
    if (this.args.card && this.args.fieldName) {
      this.args.card[this.args.fieldName] = parsedDate;
      this.args.context?.actions?.saveCard?.();
    }
  };

  get formatted() {
    if (!this.args.model) {
      return;
    }
    // Format date for datetime-local input: YYYY-MM-DDTHH:mm
    const date = this.args.model instanceof Date ? this.args.model : new Date(this.args.model);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  <template>
    <div class='standard-datetime-edit'>
      <input
        type='datetime-local'
        class='datetime-input'
        value={{this.formatted}}
        max='9999-12-31T23:59:59'
        aria-label='Edit date and time'
        {{on 'change' this.parseInput}}
      />
    </div>

    <style scoped>
      .standard-datetime-edit {
        display: flex;
        flex-direction: column;
      }

      .datetime-input {
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius, 0.375rem);
        background: yellow; /* DEBUG: Yellow background */
        color: var(--foreground, #1f2937);
        transition: all 0.2s;
      }

      .datetime-input:hover {
        border-color: var(--ring, #3b82f6);
      }

      .datetime-input:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 3px var(--ring, #3b82f6) / 10%;
      }
    </style>
  </template>
}

// Smart natural language date picker component - Excel-like compact design
class SmartEditComponent extends Component<typeof FlexDateTimeField> {
  @tracked isParsing = false;
  @tracked error = '';
  @tracked reasoning = '';
  @tracked showReasoning = false;
  @tracked chronoFailed = false;
  @tracked naturalInput = '';
  @tracked showNaturalInput = false;

  constructor(owner: any, args: any) {
    super(owner, args);
    // Always start in natural input mode (like Excel)
    this.showNaturalInput = true;
  }

  saveCard = async () => {
    try {
      await this.args.context?.actions?.saveCard?.();
    } catch (error) {
      console.error('Failed to save card:', error);
    }
  };

  toggleInputMode = () => {
    this.showNaturalInput = !this.showNaturalInput;
    this.chronoFailed = false;
    this.error = '';
  };

  onTextInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    this.naturalInput = input.value;
    
    // Show AI button whenever there's text
    this.chronoFailed = !!input.value;
    
    // Don't auto-parse - wait for Enter key
  };

  onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (this.naturalInput) {
        // Try chrono first, then fall back to AI if needed
        this.tryParseOnEnter();
      }
    }
  };

  tryParseOnEnter = async () => {
    if (!this.naturalInput) return;

    try {
      // Try chrono parsing first
      const chronoResults = chrono.parse(this.naturalInput, new Date());
      
      if (chronoResults && chronoResults.length === 1) {
        const result = chronoResults[0];
        const hasDate = result.start.get('day') && result.start.get('month') && result.start.get('year');
        
        if (hasDate && this.args.card && this.args.fieldName) {
          const chronoDate = result.start.date();
          this.args.card[this.args.fieldName] = chronoDate;
          this.reasoning = 'Interpreting date...';
          this.error = '';
          await this.saveCard();
          
          this.showReasoning = true;
          setTimeout(() => {
            this.showReasoning = false;
            this.showNaturalInput = false;
            this.chronoFailed = false;
          }, 1500);
          return;
        }
      }
      
      // If chrono couldn't parse, use AI
      void this.parseWithAI();
    } catch (err) {
      console.error('Parsing error:', err);
      void this.parseWithAI();
    }
  };



  parseWithAI = async () => {
    this.isParsing = true;
    this.error = '';

    try {
      if (!this.naturalInput) {
        throw new Error('No text to parse');
      }

      const sendRequestViaProxyCommand = new SendRequestViaProxyCommand(
        this.args.context.commandContext,
      );

      const currentDate = new Date().toISOString();
      const prompt = `Parse this text into a valid ISO 8601 datetime string (YYYY-MM-DDTHH:mm:ssZ). If no time is specified, use 00:00:00. If no year is specified, use the current year. For relative dates like "tomorrow", "next week", etc., calculate from the current date provided below.

Return your response in this exact JSON format:
{
  "date": "YYYY-MM-DDTHH:mm:ssZ",
  "reasoning": "brief explanation of how you interpreted it (1 sentence max)"
}

Current date: ${currentDate}
Text: "${this.naturalInput}"`;

      const result = await sendRequestViaProxyCommand.execute({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        requestBody: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!result.response.ok) {
        throw new Error(`Failed to parse: ${result.response.statusText}`);
      }

      const responseData = await result.response.json();
      let content = responseData.choices?.[0]?.message?.content?.trim();

      if (!content) {
        throw new Error('No response from LLM');
      }

      content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
      const parsed = JSON.parse(content);
      const parsedDateString = parsed.date;
      const reasoningText = parsed.reasoning || '';

      if (!parsedDateString) {
        throw new Error('No date returned from LLM');
      }

      const dateObj = new Date(parsedDateString);
      if (isNaN(dateObj.getTime())) {
        throw new Error('Invalid date format returned');
      }

      if (this.args.card && this.args.fieldName) {
        this.args.card[this.args.fieldName] = dateObj;
      }
      this.reasoning = `AI: ${reasoningText}`;
      await this.saveCard();

      if (this.reasoning) {
        this.showReasoning = true;
        setTimeout(() => {
          this.showReasoning = false;
          this.showNaturalInput = false; // Flip to picker display
        }, 2000);
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Date parsing failed:', error);
    } finally {
      this.isParsing = false;
    }
  };

  get formatted() {
    if (!this.args.model) return;
    const date = this.args.model instanceof Date ? this.args.model : new Date(this.args.model);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  parseInput = (date: string) => {
    if (!date?.length) {
      if (this.args.card && this.args.fieldName) {
        this.args.card[this.args.fieldName] = null;
        this.args.context?.actions?.saveCard?.();
      }
      return;
    }
    const parsedDate = new Date(date);
    if (this.args.card && this.args.fieldName) {
      this.args.card[this.args.fieldName] = parsedDate;
      this.args.context?.actions?.saveCard?.();
    }
  };

  <template>
    <div class='smart-excel-input' {{AutoSaveModifier value=@model onSave=this.saveCard}}>
      {{#if this.showNaturalInput}}
        <div class='input-row'>
          <input
            type='text'
            class='natural-input'
            value={{this.naturalInput}}
            placeholder={{if @model (formatDateTime @model size='medium') 'tomorrow 3pm, next Friday, in 2 weeks...'}}
            aria-label='Enter a natural language date'
            {{on 'input' this.onTextInput}}
            {{on 'keydown' this.onKeyDown}}
          />
          {{#if this.chronoFailed}}
            <button
              type='button'
              class='inline-ai-btn'
              {{on 'click' this.parseWithAI}}
              disabled={{this.isParsing}}
            >
              {{#if this.isParsing}}⏳{{else}}✨{{/if}}
            </button>
          {{/if}}
          {{#if @model}}
            <button type='button' class='toggle-btn' {{on 'click' this.toggleInputMode}}>📅</button>
          {{/if}}
        </div>
        {{#if this.showReasoning}}
          <div class='hint-tooltip'>💡 {{this.reasoning}}</div>
        {{/if}}
        {{#if this.error}}
          <div class='error-hint'>⚠️ {{this.error}}</div>
        {{/if}}
      {{else}}
        <div class='input-row'>
          <input
            type='datetime-local'
            class='datetime-input'
            value={{this.formatted}}
            max='9999-12-31T23:59:59'
            aria-label='Edit date and time'
            {{on 'change' this.parseInput}}
          />
          <button type='button' class='toggle-btn' {{on 'click' this.toggleInputMode}}>✏️</button>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .smart-excel-input {
        position: relative;
        font-size: 0.875rem;
      }

      .input-row {
        display: flex;
        gap: 0.25rem;
        align-items: stretch;
      }

      .natural-input,
      .datetime-input {
        flex: 1;
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
        border: 1px solid var(--input, #e5e7eb);
        border-radius: var(--radius, 0.375rem);
        background: yellow; /* DEBUG: Yellow background */
        color: var(--foreground, #1f2937);
        font-family: inherit;
        transition: all 0.15s;
      }

      .natural-input {
        border-color: var(--primary, #3b82f6);
      }

      .natural-input::placeholder {
        color: var(--muted-foreground, #9ca3af);
        font-style: italic;
      }

      .natural-input:focus,
      .datetime-input:focus {
        outline: none;
        border-color: var(--ring, #3b82f6);
        box-shadow: 0 0 0 2px var(--ring, #3b82f6) / 10%;
      }

      .inline-ai-btn,
      .toggle-btn {
        padding: 0.5rem;
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius, 0.375rem);
        background: var(--background, white);
        color: var(--foreground, #1f2937);
        cursor: pointer;
        transition: all 0.15s;
        font-size: 1rem;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 2.25rem;
      }

      .inline-ai-btn {
        background: var(--primary, #3b82f6);
        border-color: var(--primary, #3b82f6);
        color: var(--primary-foreground, white);
      }

      .inline-ai-btn:hover:not(:disabled),
      .toggle-btn:hover {
        opacity: 0.9;
        transform: translateY(-1px);
      }

      .inline-ai-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .hint-tooltip {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        margin-top: 0.25rem;
        padding: 0.375rem 0.5rem;
        background: var(--accent, #f3f4f6);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.75rem;
        color: var(--accent-foreground, #374151);
        z-index: 10;
        animation: fadeIn 0.2s;
      }

      .error-hint {
        margin-top: 0.25rem;
        padding: 0.375rem 0.5rem;
        background: var(--destructive, #fee) / 20%;
        border: 1px solid var(--destructive, #fcc);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.75rem;
        color: var(--destructive, #c00);
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(-2px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    </style>
  </template>
}

// Embedded display component
class EmbeddedComponent extends Component<typeof FlexDateTimeField> {
  <template>
    <div class='datetime-embedded'>
      {{#if @model}}
        <span class='date-value'>{{formatDateTime @model size='medium'}}</span>
      {{else}}
        <span class='no-date'>No date set</span>
      {{/if}}
    </div>

    <style scoped>
      .datetime-embedded {
        font-size: 0.875rem;
        color: var(--foreground, #1f2937);
      }

      .date-value {
        color: var(--primary, #059669);
        font-weight: 500;
      }

      .no-date {
        color: var(--muted-foreground, #9ca3af);
        font-style: italic;
      }
    </style>
  </template>
}

// Atom (inline) display component
class AtomComponent extends Component<typeof FlexDateTimeField> {
  <template>
    <span class='datetime-atom'>
      {{#if @model}}
        {{formatDateTime @model size='short'}}
      {{else}}
        <span class='empty'>—</span>
      {{/if}}
    </span>

    <style scoped>
      .datetime-atom {
        font-size: 0.8125rem;
        color: #4b5563;
      }

      .empty {
        color: rgba(0, 0, 0, 0.3);
      }
    </style>
  </template>
}

// Fitted display component
class FittedComponent extends Component<typeof FlexDateTimeField> {
  get dateDisplay() {
    if (!this.args.model) return null;
    const date = this.args.model instanceof Date ? this.args.model : new Date(this.args.model);
    return {
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      time: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    };
  }

  <template>
    <div class='datetime-fitted'>
      {{#if this.dateDisplay}}
        <div class='date-part'>{{this.dateDisplay.date}}</div>
        <div class='time-part'>{{this.dateDisplay.time}}</div>
      {{else}}
        <div class='no-date-fitted'>No date</div>
      {{/if}}
    </div>

    <style scoped>
      .datetime-fitted {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.5rem;
      }

      .date-part {
        font-size: 0.875rem;
        font-weight: 600;
        color: #1f2937;
      }

      .time-part {
        font-size: 0.75rem;
        color: #6b7280;
      }

      .no-date-fitted {
        font-size: 0.8125rem;
        color: rgba(0, 0, 0, 0.4);
        font-style: italic;
      }
    </style>
  </template>
}

// FieldRenderer - the key component that enables flexible rendering
// This component bypasses the @fields system to allow passing variant parameters
class FieldRenderer extends Component<typeof FlexDateTimeField> {
  get componentClass() {
    const format = this.args.format || 'embedded';
    const variant = this.args.variant;

    const fieldType = this.fieldType;
    if (fieldType?.getComponent) {
      return fieldType.getComponent(format, variant);
    }

    return EmbeddedComponent;
  }

  get fieldType() {
    if (this.args.card && this.args.fieldName) {
      try {
        const field = getField(this.args.card, this.args.fieldName);
        return field?.card;
      } catch {
        // ignore lookup errors and fall through to other heuristics
      }
    }

    return this.args.model?.constructor;
  }

  <template>
    {{#let (component this.componentClass) as |FieldComponent|}}
      <FieldComponent 
        @model={{@model}} 
        @context={{@context}}
        @card={{@card}}
        @fieldName={{@fieldName}}
      />
    {{/let}}
  </template>


  // Set smart variant as default edit component for @fields compatibility
  static edit = SmartEditComponent;
}

// Test harness card
export class FlexDateTimeTestHarness extends CardDef {
  static displayName = 'Flex DateTime Test Harness';

  @field eventDate = contains(FlexDateTimeField);
  @field meetingTime = contains(FlexDateTimeField);
  @field deadline = contains(FlexDateTimeField);
  @field emptyDate = contains(FlexDateTimeField);

  static isolated = class Isolated extends Component<typeof this> {
    @tracked isEditMode = false;

    toggleEditMode = () => {
      this.isEditMode = !this.isEditMode;
    };

    <template>
      <div class='test-harness'>
        <header class='harness-header'>
          <h1>FlexDateTimeField Test Harness</h1>
          <Button @kind='primary' {{on 'click' this.toggleEditMode}}>
            {{if this.isEditMode 'Switch to View' 'Switch to Edit'}}
          </Button>
        </header>

        <div class='test-sections'>
          <section class='test-section'>
            <h2>Smart Edit Variant (Natural Language)</h2>
            <div class='field-example'>
              <label>Event Date:</label>
              {{#if this.isEditMode}}
                <FieldRenderer
                  @model={{@model.eventDate}}
                  @format='edit'
                  @variant='smart'
                  @context={{@context}}
                  @card={{@model}}
                  @fieldName='eventDate'
                />
              {{else}}
                <FieldRenderer
                  @model={{@model.eventDate}}
                  @format='embedded'
                  @context={{@context}}
                  @card={{@model}}
                  @fieldName='eventDate'
                />
              {{/if}}
            </div>
          </section>

          <section class='test-section'>
            <h2>Standard Edit Variant (Date Picker)</h2>
            <div class='field-example'>
              <label>Meeting Time:</label>
              {{#if this.isEditMode}}
                <FieldRenderer
                  @model={{@model.meetingTime}}
                  @format='edit'
                  @variant='standard'
                  @context={{@context}}
                  @card={{@model}}
                  @fieldName='meetingTime'
                />
              {{else}}
                <FieldRenderer
                  @model={{@model.meetingTime}}
                  @format='embedded'
                  @context={{@context}}
                  @card={{@model}}
                  @fieldName='meetingTime'
                />
              {{/if}}
            </div>
          </section>

          <section class='test-section'>
            <h2>Atom Format</h2>
            <div class='field-example'>
              <label>Deadline (inline):</label>
              <FieldRenderer
                @model={{@model.deadline}}
                @format='atom'
                @context={{@context}}
                @card={{@model}}
                @fieldName='deadline'
              />
            </div>
          </section>

          <section class='test-section'>
            <h2>Fitted Format</h2>
            <div class='field-example fitted-example'>
              <FieldRenderer
                @model={{@model.eventDate}}
                @format='fitted'
                @context={{@context}}
                @card={{@model}}
                @fieldName='eventDate'
              />
            </div>
          </section>

          <section class='test-section'>
            <h2>Empty State</h2>
            <div class='field-example'>
              <label>Empty Date:</label>
              {{#if this.isEditMode}}
                <FieldRenderer
                  @model={{@model.emptyDate}}
                  @format='edit'
                  @variant='smart'
                  @context={{@context}}
                  @card={{@model}}
                  @fieldName='emptyDate'
                />
              {{else}}
                <FieldRenderer
                  @model={{@model.emptyDate}}
                  @format='embedded'
                  @context={{@context}}
                  @card={{@model}}
                  @fieldName='emptyDate'
                />
              {{/if}}
            </div>
          </section>
        </div>
      </div>

      <style scoped>
        .test-harness {
          padding: 2rem;
          max-width: 1200px;
          margin: 0 auto;
        }

        .harness-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
          padding-bottom: 1rem;
          border-bottom: 2px solid #e5e7eb;
        }

        .harness-header h1 {
          font-size: 1.5rem;
          font-weight: 700;
          color: #1f2937;
          margin: 0;
        }

        .test-sections {
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }

        .test-section {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 1.5rem;
        }

        .test-section h2 {
          font-size: 1.125rem;
          font-weight: 600;
          color: #374151;
          margin: 0 0 1rem 0;
        }

        .field-example {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .field-example label {
          font-size: 0.875rem;
          font-weight: 500;
          color: #6b7280;
        }

        .fitted-example {
          max-width: 200px;
          border: 1px dashed #d1d5db;
          border-radius: 4px;
        }
      </style>
    </template>
  };
}

// Export FieldRenderer so it can be used in other cards
export { FieldRenderer };
