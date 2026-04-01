import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  linksTo,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import enumField from 'https://cardstack.com/base/enum';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { concat, get } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';

// ── Field Types ──

const PredicateGroupField = enumField(StringField, {
  displayName: 'Predicate Group',
  options: [
    { value: 'all', label: 'All Conditions' },
    { value: 'any', label: 'Any Condition' },
  ],
});

const PredicateSubjectField = enumField(StringField, {
  displayName: 'Predicate Subject',
  options: [
    { value: 'attachment', label: 'Attachment' },
    { value: 'linked-card', label: 'Linked Card' },
    { value: 'message', label: 'Message' },
  ],
});

const PredicateComparatorField = enumField(StringField, {
  displayName: 'Comparator',
  options: [
    { value: 'present', label: 'Is Present' },
    { value: 'equals', label: 'Equals' },
    { value: 'contains', label: 'Contains' },
  ],
});

const AttachmentTypeField = enumField(StringField, {
  displayName: 'Attachment Type',
  options: [
    'form',
    'survey',
    'proposal',
    'contract',
    'invoice',
    'payment',
    'workspace',
    'quote',
    'confirmation',
    'profile',
  ],
});

const ToneField = enumField(StringField, {
  displayName: 'Tone',
  options: ['advisor', 'captain', 'client', 'owner', 'self'],
});

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function hasText(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return normalizeText(value).length > 0;
}

function matchesText(actual: unknown, expected: unknown): boolean {
  return normalizeText(actual) === normalizeText(expected);
}

function includesText(actual: unknown, expected: unknown): boolean {
  return normalizeText(actual).includes(normalizeText(expected));
}

function compareFieldValue(
  actual: unknown,
  comparator: string,
  expected: unknown,
): boolean {
  if (comparator === 'equals') {
    return matchesText(actual, expected);
  }
  if (comparator === 'contains') {
    return includesText(actual, expected);
  }
  return hasText(actual);
}

function summarizeCondition(condition: PredicateConditionField): string {
  let parts: string[] = [];

  if (hasText(condition.attachmentType)) {
    parts.push(`type is ${condition.attachmentType}`);
  }
  if (hasText(condition.author)) {
    parts.push(`author is ${condition.author}`);
  }
  if (hasText(condition.tone)) {
    parts.push(`tone is ${condition.tone}`);
  }
  if (hasText(condition.textContains)) {
    parts.push(`text includes "${condition.textContains}"`);
  }
  if (hasText(condition.fieldName)) {
    let comparator = condition.comparator ?? 'present';
    if (comparator === 'present') {
      parts.push(`${condition.fieldName} is present`);
    } else {
      parts.push(
        `${condition.fieldName} ${comparator} "${condition.value ?? ''}"`,
      );
    }
  }

  let subject = condition.subject ?? 'message';
  if (!parts.length) {
    return `exists ${subject}`;
  }

  return `${subject} where ${parts.join(' and ')}`;
}

function subjectLabel(subject: string | null | undefined): string {
  if (subject === 'attachment') {
    return 'Attachment';
  }
  if (subject === 'linked-card') {
    return 'Linked Card';
  }
  return 'Message';
}

function comparatorLabel(comparator: string | null | undefined): string {
  if (comparator === 'equals') {
    return 'equals';
  }
  if (comparator === 'contains') {
    return 'contains';
  }
  return 'is present';
}

function truncateLabel(label: string, max = 72): string {
  if (label.length <= max) {
    return label;
  }
  return `${label.slice(0, max - 1).trimEnd()}…`;
}

function conditionTitle(condition: PredicateConditionField): string {
  let subject = subjectLabel(condition.subject);
  let detail: string | null = null;

  if (hasText(condition.fieldName)) {
    let comparator = comparatorLabel(condition.comparator);
    detail =
      comparator === 'is present'
        ? `${condition.fieldName} ${comparator}`
        : `${condition.fieldName} ${comparator} ${condition.value ?? ''}`;
  } else if (hasText(condition.textContains)) {
    detail = `text contains ${condition.textContains}`;
  } else if (hasText(condition.attachmentType)) {
    detail = `${condition.attachmentType}`;
  } else if (hasText(condition.author)) {
    detail = `${condition.author}`;
  } else if (hasText(condition.tone)) {
    detail = `${condition.tone}`;
  }

  if (hasText(condition.attachmentType) && hasText(condition.fieldName)) {
    detail = `${condition.attachmentType}.${detail}`;
  }

  return truncateLabel(detail ? `${subject}: ${detail}` : subject);
}

function predicateTitle(predicate: PredicateField): string {
  let conditions = predicate.conditions ?? [];
  let prefix = (predicate.group ?? 'all') === 'any' ? 'Any' : 'All';

  if (!conditions.length) {
    return `${prefix} Conditions`;
  }

  if (conditions.length === 1) {
    return `${prefix}: ${conditionTitle(conditions[0])}`;
  }

  let first = conditionTitle(conditions[0]);
  return truncateLabel(`${prefix} of ${conditions.length}: ${first}`);
}

export class PredicateConditionField extends FieldDef {
  static displayName = 'Predicate Condition';
  @field subject = contains(PredicateSubjectField);
  @field attachmentType = contains(AttachmentTypeField);
  @field author = contains(StringField);
  @field tone = contains(ToneField);
  @field textContains = contains(StringField);
  @field fieldName = contains(StringField);
  @field comparator = contains(PredicateComparatorField);
  @field value = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: PredicateConditionField) {
      return conditionTitle(this);
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    get summary() {
      return summarizeCondition(this.args.model);
    }

    get subjectLabel() {
      return subjectLabel(this.args.model.subject);
    }

    get comparatorLabel() {
      return comparatorLabel(this.args.model.comparator);
    }

    get showsMatchValue() {
      return hasText(this.args.model.value) && (this.args.model.comparator ?? 'present') !== 'present';
    }

    <template>
      <div class='predicate-condition-card'>
        <div class='predicate-condition-top'>
          <span class='predicate-subject-pill'>{{this.subjectLabel}}</span>
          {{#if @model.attachmentType}}
            <span class='predicate-chip'>{{@model.attachmentType}}</span>
          {{/if}}
          {{#if @model.tone}}
            <span class='predicate-chip tone'>{{@model.tone}}</span>
          {{/if}}
          {{#if @model.author}}
            <span class='predicate-chip'>{{@model.author}}</span>
          {{/if}}
        </div>
        <div class='predicate-condition-copy'>
          {{this.summary}}
        </div>
        {{#if @model.fieldName}}
          <div class='predicate-condition-detail'>
            <span class='predicate-detail-key'>{{@model.fieldName}}</span>
            <span class='predicate-detail-op'>{{this.comparatorLabel}}</span>
            {{#if this.showsMatchValue}}
              <span class='predicate-detail-value'>{{@model.value}}</span>
            {{/if}}
          </div>
        {{/if}}
      </div>
      <style scoped>
        .predicate-condition-card {
          display: grid;
          gap: 8px;
          padding: 10px 12px;
          border: 1px solid #d9e1ec;
          border-radius: 12px;
          background: linear-gradient(180deg, #ffffff, #f8fafc);
        }
        .predicate-condition-top {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
        }
        .predicate-subject-pill,
        .predicate-chip {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.4;
        }
        .predicate-subject-pill {
          background: #0f172a;
          color: #ffffff;
        }
        .predicate-chip {
          background: #e2e8f0;
          color: #334155;
        }
        .predicate-chip.tone {
          background: #d1fae5;
          color: #065f46;
        }
        .predicate-condition-copy {
          font-size: 12px;
          line-height: 1.45;
          color: #475569;
        }
        .predicate-condition-detail {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
          font-size: 11px;
          color: #334155;
        }
        .predicate-detail-key {
          font-weight: 700;
        }
        .predicate-detail-value {
          padding: 2px 8px;
          border-radius: 999px;
          background: #eff6ff;
          color: #1d4ed8;
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    get summary() {
      return summarizeCondition(this.args.model);
    }

    get isMessageSubject() {
      return (this.args.model.subject ?? 'message') === 'message';
    }

    get usesAttachmentFacts() {
      let subject = this.args.model.subject ?? 'message';
      return subject === 'attachment' || subject === 'linked-card';
    }

    get usesLinkedCardFacts() {
      return (this.args.model.subject ?? 'message') === 'linked-card';
    }

    get showsValueInput() {
      return (
        this.usesLinkedCardFacts &&
        (this.args.model.comparator ?? 'present') !== 'present'
      );
    }

    <template>
      <div class='predicate-edit-card'>
        <div class='predicate-edit-header'>
          <div class='predicate-edit-title'>Condition</div>
          <div class='predicate-edit-summary'>{{this.summary}}</div>
        </div>

        <div class='predicate-edit-grid predicate-edit-grid-tight'>
          <div class='predicate-edit-field predicate-edit-span-2'>
            <div class='predicate-edit-label'>Subject</div>
            <@fields.subject @format='edit' />
          </div>
          {{#if this.usesAttachmentFacts}}
            <div class='predicate-edit-field predicate-edit-span-2'>
              <div class='predicate-edit-label'>Attachment Type</div>
              <@fields.attachmentType @format='edit' />
            </div>
          {{/if}}
        </div>

        <div class='predicate-edit-grid'>
          <div class='predicate-edit-field'>
            <div class='predicate-edit-label'>Author</div>
            <@fields.author @format='edit' />
          </div>
          <div class='predicate-edit-field'>
            <div class='predicate-edit-label'>Tone</div>
            <@fields.tone @format='edit' />
          </div>
        </div>

        <div class='predicate-edit-field'>
          <div class='predicate-edit-label'>Message Text Contains</div>
          <@fields.textContains @format='edit' />
        </div>

        {{#if this.usesLinkedCardFacts}}
          <div class='predicate-edit-grid'>
            <div class='predicate-edit-field'>
              <div class='predicate-edit-label'>Linked Card Field</div>
              <@fields.fieldName @format='edit' />
            </div>
            <div class='predicate-edit-field'>
              <div class='predicate-edit-label'>Comparator</div>
              <@fields.comparator @format='edit' />
            </div>
          </div>

          {{#if this.showsValueInput}}
            <div class='predicate-edit-field'>
              <div class='predicate-edit-label'>Match Value</div>
              <@fields.value @format='edit' />
            </div>
          {{/if}}
        {{/if}}
      </div>

      <style scoped>
        .predicate-edit-card {
          display: grid;
          gap: 14px;
          padding: 14px;
          border: 1px solid #d9e1ec;
          border-radius: 14px;
          background: #ffffff;
        }
        .predicate-edit-header {
          display: grid;
          gap: 4px;
        }
        .predicate-edit-title {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #64748b;
        }
        .predicate-edit-summary {
          font-size: 13px;
          line-height: 1.45;
          color: #0f172a;
        }
        .predicate-edit-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .predicate-edit-grid-tight {
          align-items: end;
        }
        .predicate-edit-field {
          display: grid;
          gap: 6px;
          min-width: 0;
        }
        .predicate-edit-span-2 {
          grid-column: span 2;
        }
        .predicate-edit-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #64748b;
        }
        @media (max-width: 720px) {
          .predicate-edit-grid {
            grid-template-columns: 1fr;
          }
          .predicate-edit-span-2 {
            grid-column: span 1;
          }
        }
      </style>
    </template>
  };
}

export class PredicateField extends FieldDef {
  static displayName = 'Predicate';
  @field group = contains(PredicateGroupField);
  @field conditions = containsMany(PredicateConditionField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: PredicateField) {
      return predicateTitle(this);
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    get groupLabel() {
      return (this.args.model.group ?? 'all') === 'any'
        ? 'Match any condition'
        : 'Match all conditions';
    }

    get hasConditions() {
      return (this.args.model.conditions?.length ?? 0) > 0;
    }

    <template>
      <div class='predicate-summary-card'>
        <div class='predicate-summary-header'>
          <span class='predicate-group-pill'>{{this.groupLabel}}</span>
        </div>
        <div class='predicate-summary-list'>
          {{#if this.hasConditions}}
            <@fields.conditions @format='embedded' />
          {{else}}
            <div class='predicate-summary-empty'>No conditions configured</div>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .predicate-summary-card {
          display: grid;
          gap: 10px;
        }
        .predicate-summary-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .predicate-group-pill {
          display: inline-flex;
          align-items: center;
          padding: 3px 10px;
          border-radius: 999px;
          background: #ecfeff;
          color: #155e75;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .predicate-summary-list {
          display: grid;
          gap: 8px;
        }
        .predicate-summary-empty {
          font-size: 12px;
          color: #64748b;
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    get groupLabel() {
      return (this.args.model.group ?? 'all') === 'any'
        ? 'Complete when any one condition matches'
        : 'Complete only when every condition matches';
    }

    <template>
      <div class='predicate-edit-shell'>
        <div class='predicate-edit-shell-header'>
          <div class='predicate-edit-shell-title'>Completion Rule</div>
          <div class='predicate-edit-shell-copy'>{{this.groupLabel}}</div>
        </div>

        <div class='predicate-edit-shell-group'>
          <div class='predicate-edit-shell-label'>Rule Mode</div>
          <@fields.group @format='edit' />
        </div>

        <div class='predicate-edit-shell-list'>
          <div class='predicate-edit-shell-label'>Conditions</div>
          <@fields.conditions @format='edit' />
        </div>
      </div>

      <style scoped>
        .predicate-edit-shell {
          display: grid;
          gap: 14px;
          padding: 14px;
          border: 1px solid #cbd5e1;
          border-radius: 16px;
          background: linear-gradient(180deg, #ffffff, #f8fafc);
        }
        .predicate-edit-shell-header,
        .predicate-edit-shell-group,
        .predicate-edit-shell-list {
          display: grid;
          gap: 6px;
        }
        .predicate-edit-shell-title,
        .predicate-edit-shell-label {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #64748b;
        }
        .predicate-edit-shell-copy {
          font-size: 13px;
          color: #0f172a;
          line-height: 1.45;
        }
      </style>
    </template>
  };
}

export class ParticipantField extends FieldDef {
  static displayName = 'Participant';
  @field initials = contains(StringField);
  @field name = contains(StringField);
  @field role = contains(StringField);
  @field tone = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='p-inline'>
        <span class={{concat 'p-av ' @model.tone}}>{{@model.initials}}</span>
        <span>{{@model.name}}</span>
      </div>
      <style scoped>
        .p-inline { display: flex; align-items: center; gap: 6px; font-size: 13px; }
        .p-av { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 800; color: #fff; background: #6b7280; }
        .p-av.advisor { background: #64748b; color: #fff; }
        .p-av.client { background: #7c4dff; }
        .p-av.captain { background: #13edb5; color: #053d31; }
        .p-av.owner { background: #dbeafe; color: #1e40af; }
      </style>
    </template>
  };
}

export class AttachmentField extends FieldDef {
  static displayName = 'Attachment';
  @field attachmentType = contains(StringField);
  @field typeLabel = contains(StringField);
  @field status = contains(StringField);
  @field ctaLabel = contains(StringField);
  @field messageRef = contains(StringField);
  @field linkedCard = linksTo(CardDef);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='att-card'>
        <@fields.linkedCard @format="embedded" />
        {{#if @model.ctaLabel}}
          <button type='button' class='att-cta'>{{@model.ctaLabel}}</button>
        {{/if}}
      </div>
      <style scoped>
        .att-card { border: 1px solid #e4e7ed; border-radius: 8px; overflow: hidden; max-width: 380px; }
        .att-cta { width: 100%; border: none; border-top: 1px solid #e4e7ed; background: #f7f8fa; color: #0aad82; font-size: 12px; font-weight: 700; padding: 8px; cursor: pointer; transition: background 0.15s; }
        .att-cta:hover { background: #0aad82; color: #fff; }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='att-fit'>
        <span class='att-fit-type'>{{@model.typeLabel}}</span>
        <span class='att-fit-title'>{{@model.cardTitle}}</span>
      </div>
      <style scoped>
        .att-fit { padding: 6px 8px; display: flex; align-items: center; gap: 6px; }
        .att-fit-type { font-size: 8px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #6b7280; }
        .att-fit-title { font-size: 12px; font-weight: 600; color: #1a1f2e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      </style>
    </template>
  };
}

export class MessageField extends FieldDef {
  static displayName = 'Message';
  @field initials = contains(StringField);
  @field author = contains(StringField);
  @field sentAt = contains(StringField);
  @field text = contains(StringField);
  @field tone = contains(StringField);
  @field isBot = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='m-inline'>
        <span class={{concat 'm-av ' @model.tone}}>{{@model.initials}}</span>
        <div class='m-copy'>
          <strong>{{@model.author}}</strong>
          <span>{{@model.text}}</span>
        </div>
      </div>
    </template>
  };
}

export class StepField extends FieldDef {
  static displayName = 'Step';
  @field label = contains(StringField);
  @field status = contains(StringField);
  @field weight = contains(NumberField);
  @field predicate = contains(PredicateField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class={{concat 'step-inline ' @model.status}}>
        {{@model.label}}
      </div>
    </template>
  };
}

// ── Interfaces ──

interface MessageView {
  id: string;
  initials: string;
  author: string;
  sentAt: string;
  text: string;
  tone: string;
  isOwn: boolean;
  isBot: boolean;
  attachmentIndices: number[];
}

interface MessageFact {
  index: number;
  author: string;
  tone: string;
  text: string;
  isBot: boolean;
}

interface AttachmentFact {
  index: number;
  attachmentType: string;
  typeLabel: string;
  status: string;
  messageIndex: number;
  author: string;
  tone: string;
  text: string;
  linkedCard: CardDef | null;
}

interface ResolvedStepView {
  label: string;
  status: string;
  weight: number;
  completed: boolean;
}

interface WorkflowResolution {
  progressPercent: number;
  steps: ResolvedStepView[];
  completedWeight: number;
  totalWeight: number;
}

function visibleMessageCount(
  model: WorkflowCard,
  limit?: number,
): number {
  let total = model.messages?.length ?? 0;
  if (limit == null || limit < 0) {
    return total;
  }
  return Math.max(0, Math.min(limit, total));
}

function attachmentMessageIndex(attachment: AttachmentField): number | null {
  let parsed = Number.parseInt(attachment.messageRef ?? '', 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function buildMessageFacts(
  model: WorkflowCard,
  limit?: number,
): MessageFact[] {
  let count = visibleMessageCount(model, limit);
  return (model.messages ?? []).slice(0, count).map((message, index) => ({
    index,
    author: message.author ?? '',
    tone: message.tone ?? '',
    text: message.text ?? '',
    isBot: (message.isBot ?? '') === 'true',
  }));
}

function buildAttachmentFacts(
  model: WorkflowCard,
  limit?: number,
): AttachmentFact[] {
  let count = visibleMessageCount(model, limit);
  let messages = model.messages ?? [];
  let facts: AttachmentFact[] = [];

  (model.attachments ?? []).forEach((attachment, index) => {
    let messageIndex = attachmentMessageIndex(attachment);
    if (messageIndex == null || messageIndex < 0 || messageIndex >= count) {
      return;
    }

    let sourceMessage = messages[messageIndex];
    facts.push({
      index,
      attachmentType: attachment.attachmentType ?? '',
      typeLabel: attachment.typeLabel ?? '',
      status: attachment.status ?? '',
      messageIndex,
      author: sourceMessage?.author ?? '',
      tone: sourceMessage?.tone ?? '',
      text: sourceMessage?.text ?? '',
      linkedCard: (attachment as any).linkedCard ?? null,
    });
  });

  return facts;
}

function conditionMatchesMessage(
  condition: PredicateConditionField,
  message: MessageFact,
): boolean {
  if (hasText(condition.author) && !matchesText(message.author, condition.author)) {
    return false;
  }
  if (hasText(condition.tone) && !matchesText(message.tone, condition.tone)) {
    return false;
  }
  if (
    hasText(condition.textContains) &&
    !includesText(message.text, condition.textContains)
  ) {
    return false;
  }
  return true;
}

function conditionMatchesAttachment(
  condition: PredicateConditionField,
  attachment: AttachmentFact,
): boolean {
  if (
    hasText(condition.attachmentType) &&
    !matchesText(attachment.attachmentType, condition.attachmentType)
  ) {
    return false;
  }
  if (hasText(condition.author) && !matchesText(attachment.author, condition.author)) {
    return false;
  }
  if (hasText(condition.tone) && !matchesText(attachment.tone, condition.tone)) {
    return false;
  }
  if (
    hasText(condition.textContains) &&
    !includesText(attachment.text, condition.textContains)
  ) {
    return false;
  }
  return true;
}

function conditionMatchesLinkedCard(
  condition: PredicateConditionField,
  attachment: AttachmentFact,
): boolean {
  if (!attachment.linkedCard) {
    return false;
  }
  if (!conditionMatchesAttachment(condition, attachment)) {
    return false;
  }
  if (!hasText(condition.fieldName)) {
    return true;
  }

  let comparator = condition.comparator ?? 'present';
  let actual = (attachment.linkedCard as any)[condition.fieldName ?? ''];
  return compareFieldValue(actual, comparator, condition.value);
}

function evaluatePredicate(
  predicate: PredicateField | null | undefined,
  messageFacts: MessageFact[],
  attachmentFacts: AttachmentFact[],
): boolean {
  let conditions = predicate?.conditions ?? [];
  if (!conditions.length) {
    return false;
  }

  let group = predicate?.group ?? 'all';
  let results = conditions.map((condition) => {
    let subject = condition.subject ?? 'message';
    if (subject === 'attachment') {
      return attachmentFacts.some((attachment) =>
        conditionMatchesAttachment(condition, attachment),
      );
    }
    if (subject === 'linked-card') {
      return attachmentFacts.some((attachment) =>
        conditionMatchesLinkedCard(condition, attachment),
      );
    }
    return messageFacts.some((message) =>
      conditionMatchesMessage(condition, message),
    );
  });

  return group === 'any' ? results.some(Boolean) : results.every(Boolean);
}

function resolveWorkflowState(
  model: WorkflowCard,
  limit?: number,
): WorkflowResolution {
  let messageFacts = buildMessageFacts(model, limit);
  let attachmentFacts = buildAttachmentFacts(model, limit);
  let steps = model.steps ?? [];
  let resolvedSteps: ResolvedStepView[] = [];
  let totalWeight = 0;
  let completedWeight = 0;

  steps.forEach((step) => {
    let weight = step.weight && step.weight > 0 ? step.weight : 1;
    let completed =
      step.predicate?.conditions?.length
      ? evaluatePredicate(step.predicate, messageFacts, attachmentFacts)
      : (step.status ?? '') === 'completed';

    totalWeight += weight;
    if (completed) {
      completedWeight += weight;
    }

    resolvedSteps.push({
      label: step.label ?? 'Untitled step',
      status: 'upcoming',
      weight,
      completed,
    });
  });

  let currentAssigned = false;
  resolvedSteps = resolvedSteps.map((step) => {
    if (step.completed) {
      return { ...step, status: 'completed' };
    }
    if (!currentAssigned) {
      currentAssigned = true;
      return { ...step, status: 'current' };
    }
    return { ...step, status: 'upcoming' };
  });

  return {
    progressPercent:
      totalWeight > 0
        ? Math.round((completedWeight / totalWeight) * 100)
        : (model.progressPercent ?? 0),
    steps: resolvedSteps,
    completedWeight,
    totalWeight,
  };
}

// ── Main WorkflowCard ──

export class WorkflowCard extends CardDef {
  static displayName = 'Workflow';
  static prefersWideFormat = true;

  @field timeLabel = contains(StringField);
  @field category = contains(StringField);
  @field categoryTone = contains(StringField);
  @field title = contains(StringField);
  @field preview = contains(StringField);
  @field contextTitle = contains(StringField);
  @field progressPercent = contains(NumberField);
  @field progressTone = contains(StringField);
  @field workspaceLabel = contains(StringField);
  @field composerPlaceholder = contains(StringField);
  @field unreadCount = contains(NumberField);
  @field participants = containsMany(ParticipantField);
  @field messages = containsMany(MessageField);
  @field steps = containsMany(StepField);
  @field attachments = containsMany(AttachmentField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: WorkflowCard) {
      return this.title ?? 'Workflow';
    },
  });

  // ── Isolated: Conversation + Sidebar ──

  static isolated = class Isolated extends Component<typeof WorkflowCard> {
    @tracked draftMessage = '';
    @tracked localMessages: MessageView[] = [];
    @tracked isAtBottom = true;
    @tracked isReplaying = false;
    @tracked replayVisibleCount = -1;
    @tracked showTyping = false;
    @tracked typingAuthor = '';
    @tracked typingInitials = '';
    @tracked typingTone = '';
    _streamEl: HTMLElement | null = null;
    _replayTimer: ReturnType<typeof setTimeout> | null = null;
    _streamId = `stream-${Math.random().toString(36).slice(2, 8)}`;
    _scrollInitTimer = setTimeout(() => {
      let el = document.getElementById(this._streamId);
      if (el) {
        this._streamEl = el;
        el.scrollTop = el.scrollHeight;
      }
    }, 300);

    willDestroy() {
      super.willDestroy();
      if (this._replayTimer) clearTimeout(this._replayTimer);
      if (this._scrollInitTimer) clearTimeout(this._scrollInitTimer);
    }

    preventCardOpen = (event: Event) => {
      event.stopPropagation();
    };

    // ── Scroll: sticky-to-bottom like Slack ──

    handleStreamScroll = (event: Event) => {
      let el = event.currentTarget as HTMLElement;
      this._streamEl = el;
      if (!this.isReplaying) {
        let threshold = 60;
        this.isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
      }
    };

    scrollToBottom = () => {
      requestAnimationFrame(() => {
        let el = this._streamEl;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    };

    // ── Replay: realistic async conversation simulation ──

    startReplay = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.isReplaying) {
        this.stopReplay();
        return;
      }
      this.localMessages = [];
      this.isReplaying = true;
      this.replayVisibleCount = 0;
      this.isAtBottom = true;
      this.showTyping = false;
      this.scrollToBottom();
      this.scheduleNextReplayMessage();
    };

    scheduleNextReplayMessage = () => {
      let messages = this.args.model.messages ?? [];
      let total = messages.length;
      if (this.replayVisibleCount >= total) {
        this.showTyping = false;
        this.isReplaying = false;
        this.replayVisibleCount = -1;
        return;
      }

      let nextMsg = messages[this.replayVisibleCount];
      let isBot = (nextMsg?.isBot ?? '') === 'true';
      let textLen = (nextMsg?.text ?? '').length;
      let tone = nextMsg?.tone ?? 'neutral';
      let author = nextMsg?.author ?? 'System';
      let initials = nextMsg?.initials ?? '';

      if (isBot) {
        // System/bot messages: fast, no typing indicator
        let delay = 300 + Math.random() * 500;
        this._replayTimer = setTimeout(() => {
          this.showTyping = false;
          this.replayVisibleCount = this.replayVisibleCount + 1;
          this.scrollToBottom();
          this.scheduleNextReplayMessage();
        }, delay);
      } else {
        // Human messages: think pause → typing indicator → reveal
        let thinkTime = 700 + Math.random() * 1200;
        let typeTime = Math.min(500 + textLen * 10, 3200);

        this._replayTimer = setTimeout(() => {
          // Show "X is typing..." indicator
          this.typingAuthor = author;
          this.typingInitials = initials;
          this.typingTone = tone;
          this.showTyping = true;
          this.scrollToBottom();

          this._replayTimer = setTimeout(() => {
            // Replace typing indicator with actual message
            this.showTyping = false;
            this.replayVisibleCount = this.replayVisibleCount + 1;
            this.scrollToBottom();
            this.scheduleNextReplayMessage();
          }, typeTime);
        }, thinkTime);
      }
    };

    stopReplay = () => {
      if (this._replayTimer) {
        clearTimeout(this._replayTimer);
        this._replayTimer = null;
      }
      this.showTyping = false;
      this.isReplaying = false;
      this.replayVisibleCount = -1;
    };

    get workflowState(): WorkflowResolution {
      return resolveWorkflowState(
        this.args.model,
        this.isReplaying ? this.replayVisibleCount : undefined,
      );
    }

    get totalMessageCount(): number {
      return this.args.model.messages?.length ?? 0;
    }

    get replayCompletedLabels(): string[] {
      if (!this.isReplaying || this.replayVisibleCount <= 0) {
        return [];
      }

      let current = this.workflowState;
      let previous = resolveWorkflowState(
        this.args.model,
        this.replayVisibleCount - 1,
      );

      return current.steps
        .filter(
          (step, index) =>
            step.status === 'completed' &&
            previous.steps[index]?.status !== 'completed',
        )
        .map((step) => step.label);
    }

    get replayStatusText(): string {
      let completedLabels = this.replayCompletedLabels;
      if (completedLabels.length) {
        return `Checked off: ${completedLabels.join(', ')}`;
      }
      if (this.replayVisibleCount >= this.totalMessageCount) {
        return 'Replay complete';
      }
      return `Replaying ${this.replayVisibleCount}/${this.totalMessageCount}`;
    }

    get activeMessages(): MessageView[] {
      let allAttachments = this.args.model.attachments ?? [];

      let persisted = (this.args.model.messages ?? []).map(
        (message: MessageField, msgIdx: number) => {
          let ref = String(msgIdx);
          let attIndices: number[] = [];
          allAttachments.forEach((att: AttachmentField, idx: number) => {
            if ((att.messageRef ?? '') === ref) {
              attIndices.push(idx);
            }
          });

          return {
            id: `msg-${msgIdx}`,
            initials: message.initials ?? '--',
            author: message.author ?? 'Unknown',
            sentAt: message.sentAt ?? '',
            text: message.text ?? '',
            tone: message.tone ?? 'neutral',
            isOwn: (message.tone ?? '') === 'self',
            isBot: (message.isBot ?? '') === 'true',
            attachmentIndices: attIndices,
          };
        },
      );

      let all = [...persisted, ...this.localMessages];
      if (this.isReplaying && this.replayVisibleCount >= 0) {
        return all.slice(0, this.replayVisibleCount);
      }
      return all;
    }

    handleInput = (event: Event) => {
      this.draftMessage = (event.target as HTMLTextAreaElement).value;
    };

    handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.sendMessage();
      }
    };

    sendMessage = () => {
      let text = this.draftMessage.trim();
      if (!text) return;

      this.localMessages = [
        ...this.localMessages,
        {
          id: `local-${Date.now()}`,
          initials: 'YO',
          author: '@You',
          sentAt: 'Now',
          text,
          tone: 'self',
          isOwn: true,
          isBot: false,
          attachmentIndices: [],
        },
      ];

      this.draftMessage = '';
      this.isAtBottom = true;
      this.scrollToBottom();
    };

    <template>
      <div class='wf-layout' {{on 'click' this.preventCardOpen}}>

        {{! ── Conversation column ── }}
        <main class='conv-pane'>
          <header class='conv-header'>
            <div class='conv-header-left'>
              <span class='conv-title'>{{@model.title}}</span>
              <span class={{concat 'cat-pill ' @model.categoryTone}}>{{@model.category}}</span>
            </div>
            <div class='conv-header-actions'>
              {{#if this.isReplaying}}
                <div class='replay-pill'>
                  <span class='replay-pill-pct'>{{this.workflowState.progressPercent}}%</span>
                  <span class='replay-pill-copy'>{{this.replayStatusText}}</span>
                </div>
              {{/if}}
              <button
                type='button'
                class={{if this.isReplaying 'icon-btn replaying' 'icon-btn'}}
                aria-label={{if this.isReplaying 'Stop replay' 'Replay messages'}}
                {{on 'click' this.startReplay}}
              >
                {{#if this.isReplaying}}
                  <svg width='14' height='14' viewBox='0 0 24 24' fill='currentColor' stroke='none'><rect x='6' y='6' width='12' height='12' rx='2'/></svg>
                {{else}}
                  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><polygon points='5 3 19 12 5 21 5 3'/></svg>
                {{/if}}
              </button>
              <button type='button' class='icon-btn' aria-label='Search'>
                <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><circle cx='11' cy='11' r='8'/><path d='m21 21-4.35-4.35'/></svg>
              </button>
              <button type='button' class='icon-btn' aria-label='More'>
                <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><circle cx='12' cy='5' r='1'/><circle cx='12' cy='12' r='1'/><circle cx='12' cy='19' r='1'/></svg>
              </button>
            </div>
          </header>

          <div class='message-stream' id={{this._streamId}} {{on 'scroll' this.handleStreamScroll}}>
            {{#each this.activeMessages as |msg|}}
              {{#if msg.isBot}}
                <div class='msg-row bot'>
                  <div class='bot-bar'></div>
                  <div class='msg-body bot-body'>
                    <div class='msg-meta'>
                      <span class='msg-author bot-author'>
                        <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M12 2L2 7l10 5 10-5-10-5z'/><path d='M2 17l10 5 10-5'/><path d='M2 12l10 5 10-5'/></svg>
                        System
                      </span>
                      <span class='msg-time'>{{msg.sentAt}}</span>
                    </div>
                    <div class='msg-text bot-text'>{{msg.text}}</div>
                    {{#each msg.attachmentIndices as |attIdx|}}
                      {{#let (get (get @fields.attachments attIdx) 'linkedCard') as |LinkedCard|}}
                        {{#let (get @model.attachments attIdx) as |att|}}
                          <div class='msg-attachment-card att-quoted'>
                            <div class='att-card'>
                              <div class='att-card-body'>
                                <LinkedCard @format="embedded" />
                              </div>
                              {{#if att.ctaLabel}}
                                <button type='button' class='att-cta'>{{att.ctaLabel}}</button>
                              {{/if}}
                            </div>
                          </div>
                        {{/let}}
                      {{/let}}
                    {{/each}}
                  </div>
                </div>
              {{else}}
                <div class={{if msg.isOwn 'msg-row own' 'msg-row'}}>
                  <div class={{concat 'msg-avatar ' msg.tone}}>{{msg.initials}}</div>
                  <div class='msg-body'>
                    <div class='msg-meta'>
                      <span class='msg-author'>{{msg.author}}</span>
                      <span class='msg-time'>{{msg.sentAt}}</span>
                    </div>
                    <div class='msg-text'>{{msg.text}}</div>
                    {{#each msg.attachmentIndices as |attIdx|}}
                      {{#let (get (get @fields.attachments attIdx) 'linkedCard') as |LinkedCard|}}
                        {{#let (get @model.attachments attIdx) as |att|}}
                          <div class='msg-attachment-card'>
                            <div class='att-card'>
                              <div class='att-card-body'>
                                <LinkedCard @format="embedded" />
                              </div>
                              {{#if att.ctaLabel}}
                                <button type='button' class='att-cta'>{{att.ctaLabel}}</button>
                              {{/if}}
                            </div>
                          </div>
                        {{/let}}
                      {{/let}}
                    {{/each}}
                  </div>
                </div>
              {{/if}}
            {{/each}}
            {{#if this.showTyping}}
              <div class='msg-row typing-row'>
                <div class={{concat 'msg-avatar ' this.typingTone}}>{{this.typingInitials}}</div>
                <div class='msg-body'>
                  <div class='msg-meta'>
                    <span class='msg-author'>{{this.typingAuthor}}</span>
                  </div>
                  <div class='msg-text typing-bubble'>
                    <span class='typing-dot'></span>
                    <span class='typing-dot'></span>
                    <span class='typing-dot'></span>
                  </div>
                </div>
              </div>
            {{/if}}
          </div>

          <div class='composer'>
            <button type='button' class='composer-attach' aria-label='Attach'>
              <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'/></svg>
            </button>
            <div class='composer-field'>
              <textarea
                class='composer-input'
                rows='1'
                placeholder={{if @model.composerPlaceholder @model.composerPlaceholder 'Type a message…'}}
                value={{this.draftMessage}}
                {{on 'input' this.handleInput}}
                {{on 'keydown' this.handleKeydown}}
              ></textarea>
            </div>
            <button
              type='button'
              class={{if this.draftMessage 'composer-send active' 'composer-send'}}
              aria-label='Send'
              {{on 'click' this.sendMessage}}
            >
              <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><line x1='22' y1='2' x2='11' y2='13'/><polygon points='22 2 15 22 11 13 2 9 22 2'/></svg>
            </button>
          </div>
        </main>

        {{! ── Right sidebar: progress + participants ── }}
        <aside class='ctx-pane'>
          <header class='ctx-header'>
            <span class='ctx-title'>{{if @model.contextTitle @model.contextTitle @model.category}}</span>
          </header>

          {{! Progress donut + steps }}
          <div class='ctx-progress'>
            <div class='donut-wrap'>
              <div
                class={{concat 'donut ' @model.progressTone}}
                style={{concat '--pct:' this.workflowState.progressPercent ';'}}
                data-replaying={{if this.isReplaying 'true' 'false'}}
              >
                <span class='donut-pct'>{{this.workflowState.progressPercent}}%</span>
                <span class='donut-sub'>complete</span>
              </div>
            </div>
          </div>

          <div class='ctx-steps'>
            <div class='ctx-section-label'>Steps</div>
            {{#each this.workflowState.steps as |step|}}
              <div class={{concat 'step-row ' step.status}}>
                <div class='step-icon-wrap'>
                  {{#if (eq step.status 'completed')}}
                    <div class='step-icon completed'>
                      <svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3'><polyline points='20 6 9 17 4 12'/></svg>
                    </div>
                  {{else if (eq step.status 'current')}}
                    <div class='step-icon current'><div class='step-dot'></div></div>
                  {{else}}
                    <div class='step-icon upcoming'><div class='step-dot-empty'></div></div>
                  {{/if}}
                </div>
                <span class='step-label'>{{step.label}}</span>
              </div>
            {{/each}}
          </div>

          {{! Participants }}
          <div class='ctx-participants'>
            <div class='ctx-section-label'>Participants</div>
            {{#each @model.participants as |p|}}
              <div class='participant-row'>
                <div class={{concat 'part-avatar ' p.tone}}>{{p.initials}}</div>
                <div class='part-info'>
                  <div class='part-name'>{{p.name}}</div>
                  <div class='part-role'>{{p.role}}</div>
                </div>
              </div>
            {{/each}}
            <button type='button' class='add-participant-btn'>
              <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><line x1='12' y1='5' x2='12' y2='19'/><line x1='5' y1='12' x2='19' y2='12'/></svg>
              Add participant
            </button>
          </div>
        </aside>

      </div>

      <style scoped>
        @property --pct {
          syntax: '<number>';
          inherits: false;
          initial-value: 0;
        }

        /* ── Design tokens ── */
        .wf-layout {
          --c-dark: #0f1117;
          --c-white: #ffffff;
          --c-surface: #f7f8fa;
          --c-border: #e4e7ed;
          --c-text: #1a1f2e;
          --c-muted: #6b7280;
          --c-support: #0aad82;
          --c-support-bg: rgba(10, 173, 130, 0.1);
          --c-listing: #6540ff;
          --c-listing-bg: rgba(101, 64, 255, 0.12);
          --font: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;

          display: grid;
          grid-template-columns: minmax(0, 1fr) 280px;
          height: 100%;
          width: 100%;
          font-family: var(--font);
          font-size: 14px;
          line-height: 1.5;
          overflow: hidden;
        }

        /* ── Conversation column ── */
        .conv-pane {
          background: var(--c-white);
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--c-border);
          overflow: hidden;
        }

        .conv-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 18px; border-bottom: 1px solid var(--c-border);
          background: #fff; flex-shrink: 0;
        }
        .conv-header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .conv-title { font-size: 14px; font-weight: 700; color: var(--c-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .conv-header-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .replay-pill {
          display: flex;
          align-items: center;
          gap: 8px;
          max-width: 280px;
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(10, 173, 130, 0.1);
          color: var(--c-support);
        }
        .replay-pill-pct {
          font-size: 11px;
          font-weight: 800;
          flex-shrink: 0;
        }
        .replay-pill-copy {
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cat-pill {
          font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
          padding: 3px 8px; border-radius: 5px;
        }
        .cat-pill.support { background: rgba(10, 173, 130, 0.12); color: #0aad82; }
        .cat-pill.listing { background: rgba(101, 64, 255, 0.1); color: #6540ff; }

        .icon-btn {
          width: 30px; height: 30px; border-radius: 7px; border: none;
          background: transparent; color: var(--c-muted);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: background 0.15s;
        }
        .icon-btn:hover { background: var(--c-surface); color: var(--c-text); }
        .icon-btn.replaying { background: rgba(10, 173, 130, 0.12); color: var(--c-support); }
        .icon-btn.replaying:hover { background: rgba(10, 173, 130, 0.18); }

        /* ── Message stream ── */
        .message-stream {
          flex: 1; overflow-y: auto; padding: 20px 18px 12px;
          display: flex; flex-direction: column; gap: 18px;
          scrollbar-width: thin; scrollbar-color: #e4e7ed transparent;
        }

        .msg-row { display: flex; align-items: flex-start; gap: 10px; }
        .msg-row.own { flex-direction: row-reverse; }

        .msg-avatar {
          width: 32px; height: 32px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 800; flex-shrink: 0;
        }
        .msg-body { max-width: 480px; min-width: 0; }
        .msg-meta { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
        .msg-row.own .msg-meta { flex-direction: row-reverse; }
        .msg-author { font-size: 12px; font-weight: 700; color: var(--c-text); }
        .msg-time { font-size: 11px; color: var(--c-muted); }

        .msg-text {
          font-size: 13.5px; line-height: 1.55; color: #2d3452;
          background: var(--c-surface); border-radius: 0 12px 12px 12px;
          padding: 10px 13px; white-space: pre-wrap;
        }
        .msg-row.own .msg-text { background: #eef2ff; border-radius: 12px 0 12px 12px; color: #1e2d6b; }

        /* ── Bot / system messages ── */
        .msg-row.bot { display: flex; align-items: flex-start; gap: 0; }
        .bot-bar { width: 3px; min-height: 100%; background: var(--c-support); border-radius: 3px; flex-shrink: 0; margin-right: 10px; }
        .bot-body { max-width: 100%; }
        .bot-author { display: inline-flex; align-items: center; gap: 4px; color: var(--c-support) !important; }
        .bot-text { background: rgba(10, 173, 130, 0.06) !important; border-radius: 8px !important; font-size: 13px !important; color: var(--c-muted) !important; font-style: italic; }

        /* ── Attachment cards ── */
        .msg-attachment-card { margin-top: 8px; max-width: 380px; }
        .att-quoted { zoom: 0.65; }
        .att-card { border: 1px solid #e4e7ed; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.07); background: #fff; }
        .att-card-body { overflow: hidden; }
        .att-card .att-cta {
          display: block; width: 100%; border: none; border-top: 1px solid #e4e7ed;
          background: #3d4152; color: #fff; font-size: 12.5px; font-weight: 600;
          padding: 10px 16px; cursor: pointer; transition: background 0.15s;
          text-align: center; letter-spacing: 0.02em;
        }
        .att-card .att-cta:hover { background: #0aad82; }

        /* ── Avatar tone colors ── */
        .captain { background: #13edb5; color: #053d31; }
        .client { background: #7c4dff; color: #fff; }
        .owner { background: #dbeafe; color: #1e40af; }
        .advisor { background: #e2e8f0; color: #334155; }
        .self { background: #dbeafe; color: #1e40af; }

        /* ── Composer ── */
        .composer {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 14px; border-top: 1px solid var(--c-border);
          background: #fff; flex-shrink: 0;
        }
        .composer-attach {
          width: 34px; height: 34px; border-radius: 50%;
          border: 1px solid var(--c-border); background: var(--c-surface);
          color: var(--c-muted); display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0; transition: border-color 0.15s, color 0.15s;
        }
        .composer-attach:hover { border-color: var(--c-support); color: var(--c-support); }
        .composer-field { flex: 1; min-width: 0; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 20px; padding: 8px 14px; }
        .composer-input { width: 100%; border: none; background: transparent; resize: none; outline: none; font: inherit; font-size: 13.5px; color: var(--c-text); line-height: 1.45; }
        .composer-input::placeholder { color: #9ca3af; }
        .composer-send {
          width: 34px; height: 34px; border-radius: 50%; border: none;
          background: var(--c-border); color: #9ca3af;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0; transition: background 0.15s, color 0.15s;
        }
        .composer-send.active { background: var(--c-support); color: #fff; }

        /* ── Right sidebar ── */
        .ctx-pane {
          background: var(--c-surface); display: flex; flex-direction: column; overflow: hidden;
        }
        .ctx-header { padding: 14px 16px; border-bottom: 1px solid var(--c-border); background: #fff; flex-shrink: 0; }
        .ctx-title { font-size: 13px; font-weight: 700; color: var(--c-text); }

        .ctx-progress {
          padding: 20px 16px 16px; display: flex; justify-content: center;
          border-bottom: 1px solid var(--c-border); background: #fff;
        }
        .donut-wrap { display: flex; align-items: center; justify-content: center; }
        .donut {
          --pct: 0; --ring-c: var(--c-support); --track-c: #e8ecf4;
          width: 110px; height: 110px; border-radius: 50%;
          background: radial-gradient(closest-side, #fff 72%, transparent 74%), conic-gradient(var(--ring-c) calc(var(--pct) * 1%), var(--track-c) 0);
          display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative;
          transition: --pct 420ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease, transform 240ms ease;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
          will-change: --pct, transform;
        }
        .donut.support { --ring-c: var(--c-support); }
        .donut.listing { --ring-c: var(--c-listing); }
        .donut[data-replaying='true'] {
          animation: donutBreathe 3.2s ease-in-out infinite;
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
        }
        .donut-pct { font-size: 20px; font-weight: 800; color: var(--c-text); line-height: 1; }
        .donut-sub { font-size: 10px; color: var(--c-muted); letter-spacing: 0.04em; }

        .ctx-steps { padding: 16px; border-bottom: 1px solid var(--c-border); background: #fff; }
        .ctx-section-label { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--c-muted); margin-bottom: 10px; }

        .step-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 12.5px; }
        .step-icon-wrap { flex-shrink: 0; }
        .step-icon { width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
        .step-icon.completed { background: var(--c-support); color: #fff; }
        .step-icon.current { border: 2px solid var(--c-support); background: transparent; }
        .step-icon.upcoming { border: 2px solid var(--c-border); background: transparent; }
        .step-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--c-support); }
        .step-dot-empty { width: 6px; height: 6px; border-radius: 50%; background: var(--c-border); }
        .step-label { color: var(--c-muted); }
        .step-row.completed .step-label { color: var(--c-muted); text-decoration: line-through; opacity: 0.7; }
        .step-row.current .step-label { color: var(--c-text); font-weight: 700; }

        .ctx-participants { padding: 16px; background: #fff; flex: 1; overflow-y: auto; }
        .participant-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; }
        .part-avatar {
          width: 32px; height: 32px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 800; flex-shrink: 0;
        }
        .part-info { min-width: 0; }
        .part-name { font-size: 12.5px; font-weight: 700; color: var(--c-text); }
        .part-role { font-size: 11.5px; color: var(--c-muted); }
        .add-participant-btn {
          width: 100%; margin-top: 8px; padding: 9px 12px;
          border: 1px dashed var(--c-border); border-radius: 8px;
          background: transparent; color: var(--c-muted);
          font-size: 12px; font-weight: 500;
          display: flex; align-items: center; justify-content: center; gap: 6px;
          cursor: pointer; transition: border-color 0.15s, color 0.15s;
        }
        .add-participant-btn:hover { border-color: var(--c-support); color: var(--c-support); }

        /* ── Typing indicator ── */
        .typing-row { animation: msgFadeIn 0.2s ease-out; }
        .typing-bubble { display: flex !important; align-items: center; gap: 4px; padding: 10px 16px !important; }
        .typing-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #9ca3af;
          animation: typingBounce 1.4s ease-in-out infinite;
        }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }

        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes donutBreathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.018); }
        }
        @keyframes msgFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* ── Message entrance animation (during replay) ── */
        .msg-row { animation: msgFadeIn 0.25s ease-out; }

        /* ── Scrollbars ── */
        .message-stream::-webkit-scrollbar, .ctx-participants::-webkit-scrollbar { width: 4px; }
        .message-stream::-webkit-scrollbar-thumb, .ctx-participants::-webkit-scrollbar-thumb { background: var(--c-border); border-radius: 4px; }

        /* ── Responsive ── */
        @media (max-width: 800px) {
          .wf-layout { grid-template-columns: 1fr; }
          .ctx-pane { display: none; }
        }
      </style>
    </template>
  };

  // ── Fitted: Dark tile card ──

  static fitted = class Fitted extends Component<typeof WorkflowCard> {
    get workflowState(): WorkflowResolution {
      return resolveWorkflowState(this.args.model);
    }

    get hasUnread(): boolean {
      return (this.args.model.unreadCount ?? 0) > 0;
    }

    get participantNames(): string {
      return (this.args.model.participants ?? [])
        .map((p: ParticipantField) => p.name ?? '')
        .filter(Boolean)
        .join(', ');
    }

    <template>
      <div class='wf-fitted'>
        <div class='fitted-top'>
          <div class='fit-time-row'>
            {{#if this.hasUnread}}
              <span class='unread-badge'>{{@model.unreadCount}}</span>
            {{/if}}
            <span class='fit-time'>{{@model.timeLabel}}</span>
          </div>
          <span class={{concat 'fit-cat ' @model.categoryTone}}>{{@model.category}}</span>
        </div>
        <div class='fit-title'>{{@model.title}}</div>
        <div class='fit-preview'>{{@model.preview}}</div>
        <div class='fit-bottom'>
          <div class='fit-people'>
            <svg class='fit-people-icon' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8'><path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M23 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/></svg>
            <span class='fit-names'>{{this.participantNames}}</span>
          </div>
          <div
            class={{concat 'fit-ring ' @model.progressTone}}
            style={{concat '--pct:' this.workflowState.progressPercent ';'}}
          ></div>
        </div>
      </div>

      <style scoped>
        .wf-fitted {
          width: 100%; height: 100%; box-sizing: border-box;
          background: linear-gradient(160deg, #10131a, #1a2030 55%, #0c3b34);
          color: #e8eaf0; padding: 14px 16px;
          display: flex; flex-direction: column;
          font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
          overflow: hidden;
        }
        .fitted-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .fit-time-row { display: flex; align-items: center; gap: 7px; }
        .unread-badge {
          width: 18px; height: 18px; border-radius: 50%;
          background: #ef4444; color: #fff;
          font-size: 10px; font-weight: 800; line-height: 1;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .fit-time { font-size: 11px; color: rgba(255, 255, 255, 0.45); }
        .fit-cat {
          font-size: 9px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
          padding: 2px 7px; border-radius: 4px; flex-shrink: 0;
        }
        .fit-cat.support { background: rgba(19, 237, 181, 0.14); color: #13edb5; }
        .fit-cat.listing { background: rgba(101, 64, 255, 0.18); color: #a48dff; }
        .fit-title {
          font-size: 13.5px; font-weight: 700; color: #f0f2f7;
          margin-bottom: 4px; line-height: 1.35;
        }
        .fit-preview {
          font-size: 11.5px; color: rgba(255, 255, 255, 0.38);
          margin-bottom: 10px; line-height: 1.4;
          display: -webkit-box; -webkit-line-clamp: 2;
          -webkit-box-orient: vertical; overflow: hidden;
        }
        .fit-bottom { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: auto; }
        .fit-people {
          display: flex; align-items: center; gap: 6px;
          min-width: 0; flex: 1;
        }
        .fit-people-icon { color: rgba(255, 255, 255, 0.3); flex-shrink: 0; }
        .fit-names {
          font-size: 11px; color: rgba(255, 255, 255, 0.38);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .fit-ring {
          --pct: 0; --ring-c: #0aad82; --track-c: rgba(255, 255, 255, 0.1);
          width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
          background: radial-gradient(closest-side, #10131a 64%, transparent 66%), conic-gradient(var(--ring-c) calc(var(--pct) * 1%), var(--track-c) 0);
        }
        .fit-ring.support { --ring-c: #0aad82; }
        .fit-ring.listing { --ring-c: #6540ff; }
      </style>
    </template>
  };

  // ── Embedded: Compact summary ──

  static embedded = class Embedded extends Component<typeof WorkflowCard> {
    get workflowState(): WorkflowResolution {
      return resolveWorkflowState(this.args.model);
    }

    <template>
      <div class='wf-embed'>
        <span class={{concat 'embed-cat ' @model.categoryTone}}>{{@model.category}}</span>
        <span class='embed-title'>{{@model.title}}</span>
        <div class='embed-ring-wrap'>
          <div
            class={{concat 'embed-ring ' @model.progressTone}}
            style={{concat '--pct:' this.workflowState.progressPercent ';'}}
          ></div>
          <span class='embed-pct'>{{this.workflowState.progressPercent}}%</span>
        </div>
      </div>

      <style scoped>
        .wf-embed {
          display: flex; align-items: center; gap: 8px; padding: 10px 14px;
          background: linear-gradient(135deg, #10131a, #202739); color: #f0f2f7;
          border-radius: 10px; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
        }
        .embed-cat {
          font-size: 9px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
          padding: 2px 6px; border-radius: 4px; flex-shrink: 0;
        }
        .embed-cat.support { background: rgba(19, 237, 181, 0.14); color: #13edb5; }
        .embed-cat.listing { background: rgba(101, 64, 255, 0.18); color: #a48dff; }
        .embed-title { font-size: 13px; font-weight: 700; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .embed-ring-wrap { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .embed-ring {
          --pct: 0; --ring-c: #0aad82; --track-c: rgba(255, 255, 255, 0.1);
          width: 20px; height: 20px; border-radius: 50%;
          background: radial-gradient(closest-side, #10131a 65%, transparent 67%), conic-gradient(var(--ring-c) calc(var(--pct) * 1%), var(--track-c) 0);
        }
        .embed-ring.support { --ring-c: #0aad82; }
        .embed-ring.listing { --ring-c: #6540ff; }
        .embed-pct { font-size: 10px; color: rgba(255, 255, 255, 0.5); }
      </style>
    </template>
  };
}
// touched for re-index
