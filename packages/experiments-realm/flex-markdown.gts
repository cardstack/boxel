// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
// ¹ Unified Field System - Complete standalone implementation
// Combines: field-write-helpers + FlexMarkdownField + UnifiedFieldExample
// For easy distribution and demonstration of unified field patterns

import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  primitive,
  queryableValue,
} from 'https://cardstack.com/base/card-api'; // ² Core imports
import { tracked } from '@glimmer/tracking'; // ³ Tracked decorator
import { Button } from '@cardstack/boxel-ui/components'; // ⁴ UI components
import { on } from '@ember/modifier'; // ⁵ Events
import { pick } from '@cardstack/boxel-ui/helpers'; // ⁶ Helpers
import MarkdownIcon from '@cardstack/boxel-icons/align-box-left-middle'; // ⁷ Icon
import { getField } from '@cardstack/runtime-common'; // ⁸ Field lookup

// ═══════════════════════════════════════════════════════════════
// SECTION 1: Unified Field Write Helpers
// ═══════════════════════════════════════════════════════════════

export type FieldWriteArgs = {
  // ⁹ Shared args shape
  model?: unknown;
  set?: (valueOrKey: any, maybeValue?: any) => void;
  card?: CardDef;
  fieldName?: string;
};

export type SetFieldOptions = {
  // ¹⁰ Optional advanced opts
  prefer?: 'renderer' | 'delegation';
  onMissing?: (args: FieldWriteArgs) => void;
};

export function setFieldValue(args: FieldWriteArgs, value: unknown): boolean {
  // ¹¹ Unified setter
  if (args?.card && args?.fieldName) {
    (args.card as any)[args.fieldName] = value;
    return true;
  }
  if (typeof args?.set === 'function') {
    try {
      if (args.set.length >= 2) {
        args.set('model', value);
      } else {
        args.set(value);
      }
      return true;
    } catch {
      // ignore
    }
  }
  return false;
}

export function setFieldValueEx( // ¹² Preference + hooks
  args: FieldWriteArgs,
  value: unknown,
  opts?: SetFieldOptions,
): boolean {
  const prefer = opts?.prefer ?? 'renderer';
  const hasRenderer = !!(args?.card && args?.fieldName);
  const hasDelegation = typeof args?.set === 'function';

  if (prefer === 'renderer' && hasRenderer) return setFieldValue(args, value);
  if (prefer === 'delegation' && hasDelegation)
    return setFieldValue(args, value);
  if (hasRenderer || hasDelegation) return setFieldValue(args, value);
  opts?.onMissing?.(args);
  return false;
}

export function getFieldValue<T = unknown>(
  args: FieldWriteArgs,
): T | undefined {
  // ¹³ Unified getter
  if (args?.card && args?.fieldName) {
    return (args.card as any)[args.fieldName] as T;
  }
  return args?.model as T;
}

export function clearFieldValue(
  args: FieldWriteArgs,
  empty: unknown = null,
): boolean {
  // ¹⁴ Clear helper
  return setFieldValue(args, empty);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 2: FieldRenderer Component
// ═══════════════════════════════════════════════════════════════

class FieldRenderer extends Component<typeof FieldDef> {
  // ¹⁵ Renderer with variant support
  get componentClass() {
    const format = this.args.format || 'embedded';
    const variant = this.args.variant;

    const fieldType = this.fieldType;
    if (fieldType?.getComponent) {
      return fieldType.getComponent(format, variant);
    }

    // Fallback to embedded
    return this.fieldType?.embedded || null;
  }

  get fieldType() {
    if (this.args.card && this.args.fieldName) {
      try {
        const field = getField(this.args.card, this.args.fieldName);
        return field?.card;
      } catch (e) {
        // ignore lookup errors and fall through
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
        @set={{@set}}
      />
    {{/let}}
  </template>
}

// ═══════════════════════════════════════════════════════════════
// SECTION 3: FlexMarkdownField Implementation
// ═══════════════════════════════════════════════════════════════

export class FlexMarkdownField extends FieldDef {
  // ¹⁶ Field definition
  static displayName = 'Flex Markdown'; // ¹⁷ Display name
  static icon = MarkdownIcon; // ¹⁸ Type icon
  static [primitive]: string; // ¹⁹ Stores as string primitive

  static [queryableValue](value: any, _stack: any[]): string {
    // ²⁰ Queryable as string
    if (value == null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    return String(value);
  }

  // ²¹ Variant router used by FieldRenderer
  static getComponent(format: string, variant?: string) {
    if (format === 'edit') {
      return variant === 'standard'
        ? this.StandardEditComponent
        : this.SmartEditComponent;
    }
    if (format === 'atom') return this.AtomComponent;
    if (format === 'fitted') return this.FittedComponent;
    return this.EmbeddedComponent;
  }

  // ²² Smart edit: textarea + quick toolbar for headings, bold, italic, link
  static SmartEditComponent = class SmartEditComponent extends Component<
    typeof FlexMarkdownField
  > {
    onInput = (value: string) => setFieldValue(this.args, value);

    addHeading = () => {
      const current = (getFieldValue<string>(this.args) ?? '').toString();
      setFieldValue(this.args, `# ${current}`);
    };

    addHeading2 = () => {
      const current = (getFieldValue<string>(this.args) ?? '').toString();
      setFieldValue(this.args, `## ${current}`);
    };

    makeBold = () => {
      const current = (getFieldValue<string>(this.args) ?? '').toString();
      setFieldValue(this.args, `**${current}**`);
    };

    makeItalic = () => {
      const current = (getFieldValue<string>(this.args) ?? '').toString();
      setFieldValue(this.args, `*${current}*`);
    };

    addLink = () => {
      const current = (getFieldValue<string>(this.args) ?? '').toString();
      setFieldValue(this.args, `[${current}]()`);
    };

    <template>
      <div class='md-editor smart'>
        <div class='toolbar'>
          <button
            type='button'
            class='tb'
            {{on 'click' this.addHeading}}
          >#</button>
          <button
            type='button'
            class='tb'
            {{on 'click' this.addHeading2}}
          >##</button>
          <button type='button' class='tb' {{on 'click' this.makeBold}}><strong
            >B</strong></button>
          <button type='button' class='tb' {{on 'click' this.makeItalic}}><em
            >I</em></button>
          <button
            type='button'
            class='tb'
            {{on 'click' this.addLink}}
          >[link]</button>
        </div>
        <textarea
          class='md-input'
          value={{@model}}
          placeholder='Write markdown...'
          {{on 'input' (pick 'target.value' this.onInput)}}
        ></textarea>
      </div>

      <style scoped>
        .md-editor {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .toolbar {
          display: flex;
          gap: 0.25rem;
        }
        .tb {
          padding: 0.25rem 0.5rem;
          font-size: 0.75rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 4px;
          background: white;
          cursor: pointer;
        }
        .tb:hover {
          background: #f3f4f6;
        }
        .md-input {
          min-height: 8rem;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 6px;
          font-family: inherit;
          font-size: 0.875rem;
        }
      </style>
    </template>
  };

  // ²³ Standard edit: plain textarea
  static StandardEditComponent = class StandardEditComponent extends Component<
    typeof FlexMarkdownField
  > {
    onInput = (value: string) => setFieldValue(this.args, value);

    <template>
      <div class='md-editor standard'>
        <textarea
          class='md-input'
          value={{@model}}
          placeholder='Write markdown...'
          {{on 'input' (pick 'target.value' this.onInput)}}
        ></textarea>
      </div>

      <style scoped>
        .md-input {
          min-height: 8rem;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 6px;
          font-family: inherit;
          font-size: 0.875rem;
        }
      </style>
    </template>
  };

  // ²⁴ Embedded display
  static EmbeddedComponent = class EmbeddedComponent extends Component<
    typeof FlexMarkdownField
  > {
    <template>
      <div class='md-embedded'>
        {{if @model @model 'No content'}}
      </div>
      <style scoped>
        .md-embedded {
          font-size: 0.875rem;
          color: #1f2937;
        }
      </style>
    </template>
  };

  // ²⁵ Atom display
  static AtomComponent = class AtomComponent extends Component<
    typeof FlexMarkdownField
  > {
    <template>
      <span class='md-atom'>{{if @model @model '—'}}</span>
      <style scoped>
        .md-atom {
          font-size: 0.8125rem;
          color: #4b5563;
        }
      </style>
    </template>
  };

  // ²⁶ Fitted display (compact)
  static FittedComponent = class FittedComponent extends Component<
    typeof FlexMarkdownField
  > {
    <template>
      <div class='md-fitted'>
        <div class='title'>{{if @model @model 'No content'}}</div>
      </div>
      <style scoped>
        .md-fitted {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.5rem;
          font-size: 0.8125rem;
          text-align: center;
        }
        .title {
          line-clamp: 3;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      </style>
    </template>
  };

  // ²⁷ @fields compatibility (single component per format)
  static edit = this.SmartEditComponent; // default edit for @fields
  static embedded = this.EmbeddedComponent;
  static atom = this.AtomComponent;
  static fitted = this.FittedComponent;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 4: Test Harness Card
// ═══════════════════════════════════════════════════════════════

export class UnifiedFieldExample extends CardDef {
  // ²⁸ Card definition
  static displayName = 'Unified Field Example'; // ²⁹ Name

  @field body = contains(FlexMarkdownField); // ³⁰ Field

  static isolated = class Isolated extends Component<typeof this> {
    // ³¹ Isolated format
    @tracked isEdit = true;
    toggle = () => (this.isEdit = !this.isEdit);

    <template>
      <div class='harness'>
        <header class='header'>
          <h1>Unified Field Example</h1>
          <p class='subtitle'>Demonstrating @fields delegation vs FieldRenderer
            with variants</p>
          <Button @kind='primary' {{on 'click' this.toggle}}>{{if
              this.isEdit
              'Switch to View'
              'Switch to Edit'
            }}</Button>
        </header>

        <section class='panel'>
          <h2>1) FieldRenderer (smart variant)</h2>
          <p class='desc'>Uses FieldRenderer with @variant="smart" - toolbar +
            textarea</p>
          {{#if this.isEdit}}
            <FieldRenderer
              @model={{@model.body}}
              @format='edit'
              @variant='smart'
              @context={{@context}}
              @card={{@model}}
              @fieldName='body'
            />
          {{else}}
            <div class='display'>{{if
                @model.body
                @model.body
                'No content'
              }}</div>
          {{/if}}
        </section>

        <section class='panel'>
          <h2>2) FieldRenderer (standard variant)</h2>
          <p class='desc'>Uses FieldRenderer with @variant="standard" - plain
            textarea</p>
          {{#if this.isEdit}}
            <FieldRenderer
              @model={{@model.body}}
              @format='edit'
              @variant='standard'
              @context={{@context}}
              @card={{@model}}
              @fieldName='body'
            />
          {{else}}
            <div class='display'>{{if
                @model.body
                @model.body
                'No content'
              }}</div>
          {{/if}}
        </section>

        <section class='panel'>
          <h2>3) Traditional @fields delegation</h2>
          <p class='desc'>Uses classic &lt;@fields.body @format="edit" /&gt; -
            defaults to smart</p>
          <div class='fields-delegation'>
            <@fields.body @format={{if this.isEdit 'edit' 'embedded'}} />
          </div>
        </section>
      </div>

      <style scoped>
        .harness {
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          max-width: 1200px;
          margin: 0 auto;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 2px solid #e5e7eb;
          padding-bottom: 0.75rem;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .header h1 {
          font-size: 1.5rem;
          font-weight: 700;
          margin: 0;
        }
        .subtitle {
          font-size: 0.875rem;
          color: #6b7280;
          margin: 0;
          flex-basis: 100%;
        }
        .panel {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 1rem;
        }
        .panel h2 {
          font-size: 1rem;
          margin: 0 0 0.25rem 0;
          font-weight: 600;
        }
        .desc {
          font-size: 0.8125rem;
          color: #6b7280;
          margin: 0 0 0.75rem 0;
        }
        .fields-delegation {
          border: 1px dashed #d1d5db;
          border-radius: 6px;
          padding: 0.75rem;
          background: #fafafa;
        }
        .display {
          padding: 0.75rem;
          background: #f9fafb;
          border-radius: 4px;
          min-height: 3rem;
          font-size: 0.875rem;
          color: #374151;
        }
      </style>
    </template>
  };
}
