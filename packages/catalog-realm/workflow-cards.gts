import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

// ═══════════════════════════════════════════
// Workflow Card Types — Domain CardDefs
// ═══════════════════════════════════════════
// Each type is an independent CardDef with its own identity.
// AttachmentCard in workflow-card.gts links to them via linksTo(CardDef).
// Rendering is delegated through <@fields.linkedCard />.

// ──────────── Shared Sub-Fields ────────────

export class ServiceLineField extends FieldDef {
  static displayName = 'Service Line';
  @field description = contains(StringField);
  @field amount = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='svc-line'>
        <span class='svc-desc'>{{@model.description}}</span>
        <span class='svc-amt'>{{@model.amount}}</span>
      </div>
      <style scoped>
        .svc-line {
          display: flex;
          justify-content: space-between;
          padding: 3px 0;
          font-size: 12px;
        }
        .svc-desc {
          color: #6b7280;
        }
        .svc-amt {
          font-weight: 600;
          color: #1a1f2e;
        }
      </style>
    </template>
  };
}

// ──────────── Communication ────────────

export class ServiceRequestCard extends CardDef {
  static displayName = 'Service Request';
  @field requesterName = contains(StringField);
  @field eventType = contains(StringField);
  @field guestCount = contains(StringField);
  @field eventDate = contains(StringField);
  @field venue = contains(StringField);
  @field message = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: ServiceRequestCard) {
      return this.requesterName ?? 'Service Request';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='req-card'>
        <div class='req-header'>
          <span class='req-icon'>
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2.5'
              stroke-linecap='round'
              stroke-linejoin='round'
            ><path
                d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
              /><polyline points='14 2 14 8 20 8' /><line
                x1='16'
                y1='13'
                x2='8'
                y2='13'
              /><line x1='16' y1='17' x2='8' y2='17' /></svg>
          </span>
          <span class='req-badge'>REQUEST</span>
        </div>
        <div class='req-name'>{{@model.requesterName}}</div>
        <div class='req-grid'>
          {{#if @model.eventType}}<div class='req-cell'><span
                class='req-label'
              >Event</span><span
                class='req-value'
              >{{@model.eventType}}</span></div>{{/if}}
          {{#if @model.guestCount}}<div class='req-cell'><span
                class='req-label'
              >Guests</span><span
                class='req-value'
              >{{@model.guestCount}}</span></div>{{/if}}
          {{#if @model.eventDate}}<div class='req-cell'><span
                class='req-label'
              >Date</span><span
                class='req-value'
              >{{@model.eventDate}}</span></div>{{/if}}
          {{#if @model.venue}}<div class='req-cell'><span
                class='req-label'
              >Venue</span><span
                class='req-value'
              >{{@model.venue}}</span></div>{{/if}}
        </div>
        {{#if @model.message}}
          <div class='req-msg'>
            <div class='req-msg-bar'></div>
            <p>{{@model.message}}</p>
          </div>
        {{/if}}
      </div>
      <style scoped>
        .req-card {
          background: #fff;
          padding: 14px 16px;
        }
        .req-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 10px;
        }
        .req-icon {
          color: #ea580c;
          display: flex;
        }
        .req-badge {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #ea580c;
          background: #fff7ed;
          padding: 2px 8px;
          border-radius: 10px;
        }
        .req-name {
          font-size: 15px;
          font-weight: 700;
          color: #1a1f2e;
          margin-bottom: 10px;
        }
        .req-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-bottom: 10px;
        }
        .req-cell {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .req-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #9ca3af;
        }
        .req-value {
          font-size: 13px;
          font-weight: 600;
          color: #374151;
        }
        .req-msg {
          display: flex;
          gap: 8px;
          padding-top: 10px;
          border-top: 1px solid #f3f4f6;
        }
        .req-msg-bar {
          width: 3px;
          min-height: 100%;
          background: #fed7aa;
          border-radius: 2px;
          flex-shrink: 0;
        }
        .req-msg p {
          margin: 0;
          font-size: 12px;
          color: #6b7280;
          line-height: 1.5;
          font-style: italic;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fit'>
        <div class='fit-bar'></div>
        <div class='fit-content'>
          <div class='fit-top'>
            <span class='fit-badge'>REQUEST</span>
            <span class='fit-name'>{{@model.requesterName}}</span>
          </div>
          <div class='fit-detail'>
            {{#if @model.eventType}}<span>{{@model.eventType}}</span>{{/if}}
            {{#if @model.venue}}<span
                class='fit-sep'
              >{{@model.venue}}</span>{{/if}}
          </div>
        </div>
      </div>
      <style scoped>
        .fit {
          display: flex;
          height: 100%;
          overflow: hidden;
          background: #fff;
        }
        .fit-bar {
          width: 4px;
          flex-shrink: 0;
          background: #ea580c;
        }
        .fit-content {
          flex: 1;
          padding: 10px 12px;
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .fit-top {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 3px;
        }
        .fit-badge {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #ea580c;
          flex-shrink: 0;
        }
        .fit-name {
          font-size: 13px;
          font-weight: 700;
          color: #1a1f2e;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-detail {
          font-size: 11px;
          color: #6b7280;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-sep::before {
          content: ' · ';
          color: #d1d5db;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='iso'>
        <div class='iso-accent'></div>
        <div class='iso-header'>
          <svg
            class='iso-icon'
            width='20'
            height='20'
            viewBox='0 0 24 24'
            fill='none'
            stroke='#ea580c'
            stroke-width='2'
            stroke-linecap='round'
            stroke-linejoin='round'
          ><path
              d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
            /><polyline points='14 2 14 8 20 8' /><line
              x1='16'
              y1='13'
              x2='8'
              y2='13'
            /><line x1='16' y1='17' x2='8' y2='17' /></svg>
          <div>
            <div class='iso-type'>Service Request</div>
            <div class='iso-title'>{{@model.requesterName}}</div>
          </div>
        </div>
        <div class='iso-grid'>
          {{#if @model.eventType}}<div class='iso-field'><span
                class='iso-label'
              >Event Type</span><span
                class='iso-value'
              >{{@model.eventType}}</span></div>{{/if}}
          {{#if @model.guestCount}}<div class='iso-field'><span
                class='iso-label'
              >Guest Count</span><span
                class='iso-value'
              >{{@model.guestCount}}</span></div>{{/if}}
          {{#if @model.eventDate}}<div class='iso-field'><span
                class='iso-label'
              >Date</span><span
                class='iso-value'
              >{{@model.eventDate}}</span></div>{{/if}}
          {{#if @model.venue}}<div class='iso-field'><span
                class='iso-label'
              >Venue</span><span
                class='iso-value'
              >{{@model.venue}}</span></div>{{/if}}
        </div>
        {{#if @model.message}}
          <div class='iso-msg'>
            <div class='iso-msg-label'>Message</div>
            <div class='iso-msg-body'>{{@model.message}}</div>
          </div>
        {{/if}}
      </article>
      <style scoped>
        .iso {
          background: #fff;
          min-height: 100%;
        }
        .iso-accent {
          height: 4px;
          background: linear-gradient(90deg, #ea580c, #fb923c);
        }
        .iso-header {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 24px 28px 16px;
        }
        .iso-icon {
          flex-shrink: 0;
          margin-top: 2px;
        }
        .iso-type {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #ea580c;
          margin-bottom: 4px;
        }
        .iso-title {
          font-size: 22px;
          font-weight: 800;
          color: #111827;
          line-height: 1.2;
        }
        .iso-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          padding: 0 28px 20px;
        }
        .iso-field {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .iso-label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #9ca3af;
        }
        .iso-value {
          font-size: 15px;
          font-weight: 600;
          color: #374151;
        }
        .iso-msg {
          padding: 16px 28px 24px;
          border-top: 1px solid #f3f4f6;
        }
        .iso-msg-label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #9ca3af;
          margin-bottom: 8px;
        }
        .iso-msg-body {
          font-size: 15px;
          color: #4b5563;
          line-height: 1.7;
          border-left: 3px solid #fed7aa;
          padding-left: 16px;
        }
      </style>
    </template>
  };
}

export class SurveyCard extends CardDef {
  static displayName = 'Survey';
  @field topic = contains(StringField);
  @field questionCount = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: SurveyCard) {
      return this.topic ?? 'Survey';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='survey-card'>
        <div class='survey-header'>
          <span class='survey-icon'>
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
              stroke-linecap='round'
              stroke-linejoin='round'
            ><path d='M9 11l3 3L22 4' /><path
                d='M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'
              /></svg>
          </span>
          <span class='survey-badge'>SURVEY</span>
        </div>
        <div class='survey-topic'>{{@model.topic}}</div>
        {{#if @model.questionCount}}
          <div class='survey-count'>
            <span class='survey-num'>{{@model.questionCount}}</span>
            <span class='survey-label'>questions</span>
          </div>
          <div class='survey-dots'>
            <span class='dot filled'></span>
            <span class='dot filled'></span>
            <span class='dot filled'></span>
            <span class='dot'></span>
            <span class='dot'></span>
            <span class='dot'></span>
            <span class='dot'></span>
            <span class='dot'></span>
          </div>
        {{/if}}
        <div class='survey-cta'>Fill out survey</div>
      </div>
      <style scoped>
        .survey-card {
          background: #fff;
          padding: 14px 16px;
        }
        .survey-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 12px;
        }
        .survey-icon {
          color: #ca8a04;
          display: flex;
        }
        .survey-badge {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #ca8a04;
          background: #fefce8;
          padding: 2px 8px;
          border-radius: 10px;
        }
        .survey-topic {
          font-size: 15px;
          font-weight: 700;
          color: #1a1f2e;
          margin-bottom: 12px;
        }
        .survey-count {
          display: flex;
          align-items: baseline;
          gap: 4px;
          margin-bottom: 8px;
        }
        .survey-num {
          font-size: 22px;
          font-weight: 800;
          color: #ca8a04;
        }
        .survey-label {
          font-size: 12px;
          color: #6b7280;
        }
        .survey-dots {
          display: flex;
          gap: 5px;
          margin-bottom: 12px;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #e5e7eb;
        }
        .dot.filled {
          background: #ca8a04;
        }
        .survey-cta {
          font-size: 12px;
          font-weight: 600;
          color: #ca8a04;
          padding-top: 10px;
          border-top: 1px solid #f3f4f6;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fit'>
        <div class='fit-bar'></div>
        <div class='fit-content'>
          <div class='fit-top'>
            <span class='fit-badge'>SURVEY</span>
            <span class='fit-topic'>{{@model.topic}}</span>
          </div>
          {{#if @model.questionCount}}
            <div class='fit-detail'>{{@model.questionCount}} questions</div>
          {{/if}}
        </div>
        <div class='fit-dots'>
          <svg
            width='16'
            height='16'
            viewBox='0 0 24 24'
            fill='none'
            stroke='#ca8a04'
            stroke-width='2'
          ><path d='M9 11l3 3L22 4' /><path
              d='M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'
            /></svg>
        </div>
      </div>
      <style scoped>
        .fit {
          display: flex;
          align-items: center;
          height: 100%;
          overflow: hidden;
          background: #fff;
        }
        .fit-bar {
          width: 4px;
          flex-shrink: 0;
          background: #ca8a04;
          align-self: stretch;
        }
        .fit-content {
          flex: 1;
          padding: 10px 12px;
          min-width: 0;
        }
        .fit-top {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 2px;
        }
        .fit-badge {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #ca8a04;
          flex-shrink: 0;
        }
        .fit-topic {
          font-size: 13px;
          font-weight: 700;
          color: #1a1f2e;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-detail {
          font-size: 11px;
          color: #6b7280;
        }
        .fit-dots {
          flex-shrink: 0;
          padding-right: 12px;
          display: flex;
          align-items: center;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='iso'>
        <div class='iso-accent'></div>
        <div class='iso-header'>
          <svg
            class='iso-icon'
            width='24'
            height='24'
            viewBox='0 0 24 24'
            fill='none'
            stroke='#ca8a04'
            stroke-width='2'
            stroke-linecap='round'
            stroke-linejoin='round'
          ><path d='M9 11l3 3L22 4' /><path
              d='M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'
            /></svg>
          <div>
            <div class='iso-type'>Survey</div>
            <div class='iso-title'>{{@model.topic}}</div>
          </div>
        </div>
        {{#if @model.questionCount}}
          <div class='iso-stat'>
            <span class='iso-stat-num'>{{@model.questionCount}}</span>
            <span class='iso-stat-label'>Questions</span>
          </div>
          <div class='iso-progress'>
            <div class='iso-progress-dots'>
              <span class='dot filled'></span>
              <span class='dot filled'></span>
              <span class='dot filled'></span>
              <span class='dot'></span>
              <span class='dot'></span>
              <span class='dot'></span>
              <span class='dot'></span>
              <span class='dot'></span>
            </div>
            <span class='iso-progress-label'>3 of 8 completed</span>
          </div>
        {{/if}}
        <div class='iso-cta'>
          <button type='button' class='iso-btn'>Start Survey</button>
        </div>
      </article>
      <style scoped>
        .iso {
          background: #fff;
          min-height: 100%;
        }
        .iso-accent {
          height: 4px;
          background: linear-gradient(90deg, #ca8a04, #eab308);
        }
        .iso-header {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 24px 28px 20px;
        }
        .iso-icon {
          flex-shrink: 0;
          margin-top: 2px;
        }
        .iso-type {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #ca8a04;
          margin-bottom: 4px;
        }
        .iso-title {
          font-size: 22px;
          font-weight: 800;
          color: #111827;
          line-height: 1.2;
        }
        .iso-stat {
          padding: 0 28px 16px;
          display: flex;
          align-items: baseline;
          gap: 6px;
        }
        .iso-stat-num {
          font-size: 36px;
          font-weight: 800;
          color: #ca8a04;
        }
        .iso-stat-label {
          font-size: 14px;
          color: #6b7280;
        }
        .iso-progress {
          padding: 0 28px 20px;
        }
        .iso-progress-dots {
          display: flex;
          gap: 8px;
          margin-bottom: 8px;
        }
        .dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #e5e7eb;
        }
        .dot.filled {
          background: #ca8a04;
        }
        .iso-progress-label {
          font-size: 12px;
          color: #9ca3af;
        }
        .iso-cta {
          padding: 16px 28px 28px;
          border-top: 1px solid #f3f4f6;
        }
        .iso-btn {
          width: 100%;
          padding: 12px;
          border: none;
          border-radius: 8px;
          background: #ca8a04;
          color: #fff;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
        }
        .iso-btn:hover {
          background: #a16207;
        }
      </style>
    </template>
  };
}

// ──────────── Transaction ────────────

export class ProposalCard extends CardDef {
  static displayName = 'Proposal';
  @field clientName = contains(StringField);
  @field packageName = contains(StringField);
  @field services = containsMany(ServiceLineField);
  @field totalPrice = contains(StringField);
  @field depositRequired = contains(StringField);
  @field validUntil = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: ProposalCard) {
      return this.clientName ? `Proposal for ${this.clientName}` : 'Proposal';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='prop-card'>
        <div class='prop-header'>
          <div class='prop-header-left'>
            <span class='prop-badge'>PROPOSAL</span>
            <span class='prop-client'>for {{@model.clientName}}</span>
          </div>
          <svg
            class='prop-icon'
            width='16'
            height='16'
            viewBox='0 0 24 24'
            fill='none'
            stroke='#2563eb'
            stroke-width='2'
            stroke-linecap='round'
            stroke-linejoin='round'
          ><path
              d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
            /><polyline points='14 2 14 8 20 8' /></svg>
        </div>
        {{#if @model.packageName}}<div
            class='prop-package'
          >{{@model.packageName}}</div>{{/if}}
        {{#if @model.services.length}}
          <div class='prop-items'>
            {{#each @model.services as |svc|}}
              <div class='prop-line'>
                <span class='prop-desc'>{{svc.description}}</span>
                <span class='prop-dots'></span>
                <span class='prop-amt'>{{svc.amount}}</span>
              </div>
            {{/each}}
          </div>
        {{/if}}
        <div class='prop-footer'>
          <div class='prop-total-row'>
            {{#if @model.totalPrice}}
              <div class='prop-total-item'>
                <span class='prop-total-label'>Total</span>
                <span class='prop-total-value'>{{@model.totalPrice}}</span>
              </div>
            {{/if}}
            {{#if @model.depositRequired}}
              <div class='prop-total-item'>
                <span class='prop-total-label'>Deposit</span>
                <span class='prop-total-value'>{{@model.depositRequired}}</span>
              </div>
            {{/if}}
          </div>
        </div>
        {{#if @model.validUntil}}<div class='prop-valid'>Valid until
            {{@model.validUntil}}</div>{{/if}}
      </div>
      <style scoped>
        .prop-card {
          background: #fff;
        }
        .prop-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid #eff6ff;
        }
        .prop-header-left {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .prop-badge {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #fff;
          background: #2563eb;
          padding: 2px 8px;
          border-radius: 10px;
        }
        .prop-client {
          font-size: 13px;
          font-weight: 600;
          color: #374151;
        }
        .prop-icon {
          flex-shrink: 0;
        }
        .prop-package {
          font-size: 12px;
          color: #6b7280;
          padding: 8px 16px 0;
        }
        .prop-items {
          padding: 10px 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .prop-line {
          display: flex;
          align-items: baseline;
          gap: 4px;
          font-size: 12px;
        }
        .prop-desc {
          color: #374151;
          white-space: nowrap;
        }
        .prop-dots {
          flex: 1;
          border-bottom: 1px dotted #d1d5db;
          min-width: 20px;
          margin-bottom: 3px;
        }
        .prop-amt {
          font-weight: 700;
          color: #1a1f2e;
          white-space: nowrap;
        }
        .prop-footer {
          background: #1e293b;
          padding: 10px 16px;
        }
        .prop-total-row {
          display: flex;
          justify-content: space-between;
        }
        .prop-total-item {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .prop-total-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #94a3b8;
        }
        .prop-total-value {
          font-size: 16px;
          font-weight: 800;
          color: #fff;
        }
        .prop-valid {
          font-size: 11px;
          color: #9ca3af;
          padding: 8px 16px;
          text-align: right;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fit'>
        <div class='fit-bar'></div>
        <div class='fit-content'>
          <div class='fit-top'>
            <span class='fit-badge'>PROPOSAL</span>
            <span class='fit-client'>{{@model.clientName}}</span>
          </div>
          <div class='fit-detail'>
            {{#if @model.packageName}}<span>{{@model.packageName}}</span>{{/if}}
          </div>
        </div>
        {{#if @model.totalPrice}}
          <div class='fit-amount'>{{@model.totalPrice}}</div>
        {{/if}}
      </div>
      <style scoped>
        .fit {
          display: flex;
          align-items: center;
          height: 100%;
          overflow: hidden;
          background: #fff;
        }
        .fit-bar {
          width: 4px;
          flex-shrink: 0;
          background: #2563eb;
          align-self: stretch;
        }
        .fit-content {
          flex: 1;
          padding: 10px 12px;
          min-width: 0;
        }
        .fit-top {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 2px;
        }
        .fit-badge {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #2563eb;
          flex-shrink: 0;
        }
        .fit-client {
          font-size: 13px;
          font-weight: 700;
          color: #1a1f2e;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-detail {
          font-size: 11px;
          color: #6b7280;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-amount {
          flex-shrink: 0;
          font-size: 14px;
          font-weight: 800;
          color: #2563eb;
          padding-right: 12px;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='iso'>
        <div class='iso-accent'></div>
        <div class='iso-header'>
          <div>
            <div class='iso-type'>Proposal</div>
            <div class='iso-title'>{{@model.clientName}}</div>
            {{#if @model.packageName}}<div
                class='iso-subtitle'
              >{{@model.packageName}}</div>{{/if}}
          </div>
        </div>
        {{#if @model.services.length}}
          <div class='iso-table'>
            <div class='iso-table-head'>
              <span>Service</span>
              <span>Amount</span>
            </div>
            {{#each @model.services as |svc|}}
              <div class='iso-table-row'>
                <span class='iso-table-desc'>{{svc.description}}</span>
                <span class='iso-table-amt'>{{svc.amount}}</span>
              </div>
            {{/each}}
          </div>
        {{/if}}
        <div class='iso-totals'>
          {{#if @model.totalPrice}}
            <div class='iso-total-row'>
              <span class='iso-total-label'>Total</span>
              <span class='iso-total-value'>{{@model.totalPrice}}</span>
            </div>
          {{/if}}
          {{#if @model.depositRequired}}
            <div class='iso-total-row iso-deposit'>
              <span class='iso-total-label'>Deposit Required</span>
              <span class='iso-total-value'>{{@model.depositRequired}}</span>
            </div>
          {{/if}}
        </div>
        {{#if @model.validUntil}}
          <div class='iso-footer'>Valid until {{@model.validUntil}}</div>
        {{/if}}
      </article>
      <style scoped>
        .iso {
          background: #fff;
          min-height: 100%;
        }
        .iso-accent {
          height: 4px;
          background: linear-gradient(90deg, #2563eb, #60a5fa);
        }
        .iso-header {
          padding: 24px 28px 20px;
        }
        .iso-type {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #2563eb;
          margin-bottom: 4px;
        }
        .iso-title {
          font-size: 22px;
          font-weight: 800;
          color: #111827;
          line-height: 1.2;
        }
        .iso-subtitle {
          font-size: 14px;
          color: #6b7280;
          margin-top: 4px;
        }
        .iso-table {
          padding: 0 28px 16px;
        }
        .iso-table-head {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #9ca3af;
          padding-bottom: 8px;
          border-bottom: 2px solid #eff6ff;
        }
        .iso-table-row {
          display: flex;
          justify-content: space-between;
          padding: 10px 0;
          border-bottom: 1px solid #f3f4f6;
        }
        .iso-table-desc {
          font-size: 14px;
          color: #374151;
        }
        .iso-table-amt {
          font-size: 14px;
          font-weight: 700;
          color: #1a1f2e;
        }
        .iso-totals {
          background: #1e293b;
          padding: 16px 28px;
        }
        .iso-total-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .iso-total-label {
          font-size: 13px;
          font-weight: 600;
          color: #94a3b8;
        }
        .iso-total-value {
          font-size: 20px;
          font-weight: 800;
          color: #fff;
        }
        .iso-deposit {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid #334155;
        }
        .iso-deposit .iso-total-value {
          font-size: 16px;
          color: #60a5fa;
        }
        .iso-footer {
          font-size: 12px;
          color: #9ca3af;
          padding: 12px 28px;
          text-align: right;
        }
      </style>
    </template>
  };
}

export class ContractCard extends CardDef {
  static displayName = 'Contract';
  @field partyA = contains(StringField);
  @field partyB = contains(StringField);
  @field agreementType = contains(StringField);
  @field signedBy = contains(StringField);
  @field signedDate = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: ContractCard) {
      return this.agreementType ?? 'Contract';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='con-card'>
        <div class='con-header'>
          <svg
            width='16'
            height='16'
            viewBox='0 0 24 24'
            fill='none'
            stroke='#7c3aed'
            stroke-width='2'
            stroke-linecap='round'
            stroke-linejoin='round'
          ><path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' /></svg>
          <span class='con-badge'>CONTRACT</span>
        </div>
        {{#if @model.agreementType}}<div
            class='con-type'
          >{{@model.agreementType}}</div>{{/if}}
        <div class='con-parties'>
          <div class='con-party'>
            <span class='con-party-label'>Party A</span>
            <span class='con-party-name'>{{@model.partyA}}</span>
          </div>
          <div class='con-arrow'>
            <svg width='20' height='12' viewBox='0 0 20 12'><line
                x1='0'
                y1='6'
                x2='20'
                y2='6'
                stroke='#d1d5db'
                stroke-width='1.5'
              /><polyline
                points='15,2 20,6 15,10'
                fill='none'
                stroke='#d1d5db'
                stroke-width='1.5'
              /><polyline
                points='5,2 0,6 5,10'
                fill='none'
                stroke='#d1d5db'
                stroke-width='1.5'
              /></svg>
          </div>
          <div class='con-party'>
            <span class='con-party-label'>Party B</span>
            <span class='con-party-name'>{{@model.partyB}}</span>
          </div>
        </div>
        {{#if @model.signedBy}}
          <div class='con-signed'>
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='#059669'
              stroke-width='2.5'
              stroke-linecap='round'
              stroke-linejoin='round'
            ><path d='M22 11.08V12a10 10 0 1 1-5.93-9.14' /><polyline
                points='22 4 12 14.01 9 11.01'
              /></svg>
            <span class='con-signed-text'>Signed by
              {{@model.signedBy}}{{#if @model.signedDate}}
                —
                {{@model.signedDate}}{{/if}}</span>
          </div>
        {{else}}
          <div class='con-pending'>
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='#d97706'
              stroke-width='2'
              stroke-linecap='round'
              stroke-linejoin='round'
            ><circle cx='12' cy='12' r='10' /><line
                x1='12'
                y1='8'
                x2='12'
                y2='12'
              /><line x1='12' y1='16' x2='12.01' y2='16' /></svg>
            <span class='con-pending-text'>Awaiting signature</span>
          </div>
        {{/if}}
      </div>
      <style scoped>
        .con-card {
          background: #fff;
          padding: 14px 16px;
        }
        .con-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
        }
        .con-badge {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #7c3aed;
        }
        .con-type {
          font-size: 14px;
          font-weight: 700;
          color: #1a1f2e;
          margin-bottom: 12px;
        }
        .con-parties {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          padding: 10px;
          background: #faf5ff;
          border-radius: 8px;
        }
        .con-party {
          flex: 1;
          text-align: center;
        }
        .con-party-label {
          display: block;
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #9ca3af;
          margin-bottom: 2px;
        }
        .con-party-name {
          display: block;
          font-size: 12px;
          font-weight: 600;
          color: #374151;
        }
        .con-arrow {
          flex-shrink: 0;
          display: flex;
          align-items: center;
        }
        .con-signed {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 10px;
          background: #f0fdf4;
          border-radius: 6px;
          border: 1px solid #bbf7d0;
        }
        .con-signed-text {
          font-size: 12px;
          font-weight: 600;
          color: #059669;
        }
        .con-pending {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 10px;
          background: #fffbeb;
          border-radius: 6px;
          border: 1px dashed #fcd34d;
        }
        .con-pending-text {
          font-size: 12px;
          font-weight: 600;
          color: #d97706;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fit'>
        <div class='fit-bar'></div>
        <div class='fit-content'>
          <div class='fit-top'>
            <span class='fit-badge'>CONTRACT</span>
            <span class='fit-type'>{{@model.agreementType}}</span>
          </div>
          <div class='fit-detail'>{{@model.partyA}} ↔ {{@model.partyB}}</div>
        </div>
        <div class='fit-status'>
          {{#if @model.signedBy}}
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='#059669'
              stroke-width='2.5'
            ><path d='M22 11.08V12a10 10 0 1 1-5.93-9.14' /><polyline
                points='22 4 12 14.01 9 11.01'
              /></svg>
          {{else}}
            <span class='fit-pending'>Pending</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .fit {
          display: flex;
          align-items: center;
          height: 100%;
          overflow: hidden;
          background: #fff;
        }
        .fit-bar {
          width: 4px;
          flex-shrink: 0;
          background: #7c3aed;
          align-self: stretch;
        }
        .fit-content {
          flex: 1;
          padding: 10px 12px;
          min-width: 0;
        }
        .fit-top {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 2px;
        }
        .fit-badge {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #7c3aed;
          flex-shrink: 0;
        }
        .fit-type {
          font-size: 13px;
          font-weight: 700;
          color: #1a1f2e;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-detail {
          font-size: 11px;
          color: #6b7280;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-status {
          flex-shrink: 0;
          padding-right: 12px;
          display: flex;
          align-items: center;
        }
        .fit-pending {
          font-size: 10px;
          font-weight: 700;
          color: #d97706;
          background: #fffbeb;
          padding: 2px 8px;
          border-radius: 10px;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='iso'>
        <div class='iso-accent'></div>
        <div class='iso-header'>
          <svg
            class='iso-icon'
            width='24'
            height='24'
            viewBox='0 0 24 24'
            fill='none'
            stroke='#7c3aed'
            stroke-width='2'
          ><path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' /></svg>
          <div>
            <div class='iso-type'>Contract</div>
            <div class='iso-title'>{{@model.agreementType}}</div>
          </div>
        </div>
        <div class='iso-parties'>
          <div class='iso-party'>
            <div class='iso-party-label'>Party A</div>
            <div class='iso-party-name'>{{@model.partyA}}</div>
          </div>
          <div class='iso-party-divider'>
            <svg width='24' height='14' viewBox='0 0 24 14'><line
                x1='0'
                y1='7'
                x2='24'
                y2='7'
                stroke='#d1d5db'
                stroke-width='2'
              /><polyline
                points='18,2 24,7 18,12'
                fill='none'
                stroke='#d1d5db'
                stroke-width='2'
              /><polyline
                points='6,2 0,7 6,12'
                fill='none'
                stroke='#d1d5db'
                stroke-width='2'
              /></svg>
          </div>
          <div class='iso-party'>
            <div class='iso-party-label'>Party B</div>
            <div class='iso-party-name'>{{@model.partyB}}</div>
          </div>
        </div>
        <div class='iso-status'>
          {{#if @model.signedBy}}
            <div class='iso-signed'>
              <svg
                width='18'
                height='18'
                viewBox='0 0 24 24'
                fill='none'
                stroke='#059669'
                stroke-width='2.5'
              ><path d='M22 11.08V12a10 10 0 1 1-5.93-9.14' /><polyline
                  points='22 4 12 14.01 9 11.01'
                /></svg>
              <div>
                <div class='iso-signed-title'>Signed</div>
                <div class='iso-signed-detail'>by
                  {{@model.signedBy}}{{#if @model.signedDate}}
                    on
                    {{@model.signedDate}}{{/if}}</div>
              </div>
            </div>
          {{else}}
            <div class='iso-pending'>
              <svg
                width='18'
                height='18'
                viewBox='0 0 24 24'
                fill='none'
                stroke='#d97706'
                stroke-width='2'
              ><circle cx='12' cy='12' r='10' /><line
                  x1='12'
                  y1='8'
                  x2='12'
                  y2='12'
                /><line x1='12' y1='16' x2='12.01' y2='16' /></svg>
              <div>
                <div class='iso-pending-title'>Awaiting Signature</div>
                <div class='iso-pending-detail'>This contract has not been
                  signed yet</div>
              </div>
            </div>
          {{/if}}
        </div>
      </article>
      <style scoped>
        .iso {
          background: #fff;
          min-height: 100%;
        }
        .iso-accent {
          height: 4px;
          background: linear-gradient(90deg, #7c3aed, #a78bfa);
        }
        .iso-header {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 24px 28px 20px;
        }
        .iso-icon {
          flex-shrink: 0;
          margin-top: 2px;
        }
        .iso-type {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #7c3aed;
          margin-bottom: 4px;
        }
        .iso-title {
          font-size: 22px;
          font-weight: 800;
          color: #111827;
          line-height: 1.2;
        }
        .iso-parties {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 0 28px 20px;
          padding: 16px;
          background: #faf5ff;
          border-radius: 12px;
        }
        .iso-party {
          flex: 1;
          text-align: center;
        }
        .iso-party-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #9ca3af;
          margin-bottom: 4px;
        }
        .iso-party-name {
          font-size: 16px;
          font-weight: 700;
          color: #374151;
        }
        .iso-party-divider {
          flex-shrink: 0;
          display: flex;
          align-items: center;
        }
        .iso-status {
          padding: 16px 28px 28px;
        }
        .iso-signed {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 16px;
          background: #f0fdf4;
          border-radius: 10px;
          border: 1px solid #bbf7d0;
        }
        .iso-signed-title {
          font-size: 15px;
          font-weight: 700;
          color: #059669;
        }
        .iso-signed-detail {
          font-size: 13px;
          color: #6b7280;
          margin-top: 2px;
        }
        .iso-pending {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 16px;
          background: #fffbeb;
          border-radius: 10px;
          border: 1px dashed #fcd34d;
        }
        .iso-pending-title {
          font-size: 15px;
          font-weight: 700;
          color: #d97706;
        }
        .iso-pending-detail {
          font-size: 13px;
          color: #6b7280;
          margin-top: 2px;
        }
      </style>
    </template>
  };
}

export class QuoteCard extends CardDef {
  static displayName = 'Quote';
  @field vendorName = contains(StringField);
  @field service = contains(StringField);
  @field hours = contains(StringField);
  @field rate = contains(StringField);
  @field discount = contains(StringField);
  @field total = contains(StringField);
  @field validUntil = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: QuoteCard) {
      return this.vendorName ? `Quote — ${this.vendorName}` : 'Quote';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='qt-card'>
        <div class='qt-header'>
          <div class='qt-header-left'>
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='#4f46e5'
              stroke-width='2'
              stroke-linecap='round'
              stroke-linejoin='round'
            ><line x1='12' y1='1' x2='12' y2='23' /><path
                d='M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'
              /></svg>
            <span class='qt-badge'>QUOTE</span>
          </div>
          {{#if @model.validUntil}}<span class='qt-valid'>Valid
              {{@model.validUntil}}</span>{{/if}}
        </div>
        <div class='qt-vendor'>{{@model.vendorName}}</div>
        <div class='qt-service'>{{@model.service}}</div>
        <div class='qt-breakdown'>
          {{#if @model.hours}}
            <div class='qt-row'><span class='qt-row-label'>Hours</span><span
                class='qt-row-value'
              >{{@model.hours}}</span></div>
          {{/if}}
          {{#if @model.rate}}
            <div class='qt-row'><span class='qt-row-label'>Rate</span><span
                class='qt-row-value'
              >{{@model.rate}}</span></div>
          {{/if}}
          {{#if @model.discount}}
            <div class='qt-row qt-discount'><span
                class='qt-row-label'
              >Discount</span><span
                class='qt-row-value'
              >{{@model.discount}}</span></div>
          {{/if}}
        </div>
        {{#if @model.total}}
          <div class='qt-total'>
            <span class='qt-total-label'>Total</span>
            <span class='qt-total-value'>{{@model.total}}</span>
          </div>
        {{/if}}
      </div>
      <style scoped>
        .qt-card {
          background: #fff;
        }
        .qt-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid #eef2ff;
        }
        .qt-header-left {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .qt-badge {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #4f46e5;
        }
        .qt-valid {
          font-size: 10px;
          color: #9ca3af;
        }
        .qt-vendor {
          font-size: 15px;
          font-weight: 700;
          color: #1a1f2e;
          padding: 10px 16px 2px;
        }
        .qt-service {
          font-size: 12px;
          color: #6b7280;
          padding: 0 16px 8px;
        }
        .qt-breakdown {
          padding: 0 16px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .qt-row {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          padding: 4px 0;
          border-bottom: 1px solid #f3f4f6;
        }
        .qt-row-label {
          color: #6b7280;
        }
        .qt-row-value {
          font-weight: 600;
          color: #374151;
        }
        .qt-discount .qt-row-value {
          color: #059669;
        }
        .qt-total {
          display: flex;
          justify-content: space-between;
          padding: 10px 16px;
          border-top: 2px solid #4f46e5;
          margin-top: 8px;
        }
        .qt-total-label {
          font-size: 12px;
          font-weight: 700;
          color: #374151;
        }
        .qt-total-value {
          font-size: 16px;
          font-weight: 800;
          color: #4f46e5;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fit'>
        <div class='fit-bar'></div>
        <div class='fit-content'>
          <div class='fit-top'>
            <span class='fit-badge'>QUOTE</span>
            <span class='fit-vendor'>{{@model.vendorName}}</span>
          </div>
          <div class='fit-detail'>{{@model.service}}</div>
        </div>
        {{#if @model.total}}
          <div class='fit-amount'>{{@model.total}}</div>
        {{/if}}
      </div>
      <style scoped>
        .fit {
          display: flex;
          align-items: center;
          height: 100%;
          overflow: hidden;
          background: #fff;
        }
        .fit-bar {
          width: 4px;
          flex-shrink: 0;
          background: #4f46e5;
          align-self: stretch;
        }
        .fit-content {
          flex: 1;
          padding: 10px 12px;
          min-width: 0;
        }
        .fit-top {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 2px;
        }
        .fit-badge {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #4f46e5;
          flex-shrink: 0;
        }
        .fit-vendor {
          font-size: 13px;
          font-weight: 700;
          color: #1a1f2e;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-detail {
          font-size: 11px;
          color: #6b7280;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-amount {
          flex-shrink: 0;
          font-size: 14px;
          font-weight: 800;
          color: #4f46e5;
          padding-right: 12px;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='iso'>
        <div class='iso-accent'></div>
        <div class='iso-header'>
          <div>
            <div class='iso-type'>Quote</div>
            <div class='iso-title'>{{@model.vendorName}}</div>
            {{#if @model.service}}<div
                class='iso-subtitle'
              >{{@model.service}}</div>{{/if}}
          </div>
          {{#if @model.validUntil}}<div class='iso-valid'>Valid
              {{@model.validUntil}}</div>{{/if}}
        </div>
        <div class='iso-breakdown'>
          {{#if @model.hours}}
            <div class='iso-row'><span class='iso-row-label'>Hours</span><span
                class='iso-row-value'
              >{{@model.hours}}</span></div>
          {{/if}}
          {{#if @model.rate}}
            <div class='iso-row'><span class='iso-row-label'>Rate</span><span
                class='iso-row-value'
              >{{@model.rate}}</span></div>
          {{/if}}
          {{#if @model.discount}}
            <div class='iso-row iso-row-green'><span
                class='iso-row-label'
              >Discount</span><span
                class='iso-row-value'
              >{{@model.discount}}</span></div>
          {{/if}}
        </div>
        {{#if @model.total}}
          <div class='iso-total'>
            <span class='iso-total-label'>Total</span>
            <span class='iso-total-value'>{{@model.total}}</span>
          </div>
        {{/if}}
      </article>
      <style scoped>
        .iso {
          background: #fff;
          min-height: 100%;
        }
        .iso-accent {
          height: 4px;
          background: linear-gradient(90deg, #4f46e5, #818cf8);
        }
        .iso-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 24px 28px 20px;
        }
        .iso-type {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #4f46e5;
          margin-bottom: 4px;
        }
        .iso-title {
          font-size: 22px;
          font-weight: 800;
          color: #111827;
          line-height: 1.2;
        }
        .iso-subtitle {
          font-size: 14px;
          color: #6b7280;
          margin-top: 4px;
        }
        .iso-valid {
          font-size: 11px;
          color: #9ca3af;
          padding-top: 4px;
        }
        .iso-breakdown {
          padding: 0 28px 16px;
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .iso-row {
          display: flex;
          justify-content: space-between;
          padding: 12px 0;
          border-bottom: 1px solid #f3f4f6;
        }
        .iso-row-label {
          font-size: 14px;
          color: #6b7280;
        }
        .iso-row-value {
          font-size: 14px;
          font-weight: 700;
          color: #374151;
        }
        .iso-row-green .iso-row-value {
          color: #059669;
        }
        .iso-total {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 28px;
          background: #eef2ff;
          border-top: 3px solid #4f46e5;
        }
        .iso-total-label {
          font-size: 14px;
          font-weight: 700;
          color: #374151;
        }
        .iso-total-value {
          font-size: 24px;
          font-weight: 800;
          color: #4f46e5;
        }
      </style>
    </template>
  };
}

export class InvoiceDetailCard extends CardDef {
  static displayName = 'Invoice';
  @field invoiceNumber = contains(StringField);
  @field billTo = contains(StringField);
  @field lineItems = containsMany(ServiceLineField);
  @field total = contains(StringField);
  @field dueDate = contains(StringField);
  @field paidAmount = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: InvoiceDetailCard) {
      return this.invoiceNumber ? `Invoice #${this.invoiceNumber}` : 'Invoice';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='inv-card'>
        <div class='inv-header'>
          <div class='inv-header-left'>
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='#059669'
              stroke-width='2'
              stroke-linecap='round'
              stroke-linejoin='round'
            ><rect x='1' y='4' width='22' height='16' rx='2' ry='2' /><line
                x1='1'
                y1='10'
                x2='23'
                y2='10'
              /></svg>
            <span class='inv-label'>INVOICE</span>
          </div>
          {{#if @model.invoiceNumber}}<span
              class='inv-number'
            >#{{@model.invoiceNumber}}</span>{{/if}}
        </div>
        {{#if @model.billTo}}<div
            class='inv-billto'
          >{{@model.billTo}}</div>{{/if}}
        {{#if @model.lineItems.length}}
          <div class='inv-items'>
            {{#each @model.lineItems as |li|}}
              <div class='inv-line'>
                <span class='inv-desc'>{{li.description}}</span>
                <span class='inv-dots'></span>
                <span class='inv-amt'>{{li.amount}}</span>
              </div>
            {{/each}}
          </div>
        {{/if}}
        {{#if @model.total}}
          <div class='inv-total-bar'>
            <span class='inv-total-text'>Total Due</span>
            <span class='inv-total-amt'>{{@model.total}}</span>
          </div>
        {{/if}}
        <div class='inv-footer'>
          {{#if @model.dueDate}}
            <div class='inv-due'>
              <svg
                width='12'
                height='12'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
                stroke-linecap='round'
                stroke-linejoin='round'
              ><rect x='3' y='4' width='18' height='18' rx='2' ry='2' /><line
                  x1='16'
                  y1='2'
                  x2='16'
                  y2='6'
                /><line x1='8' y1='2' x2='8' y2='6' /><line
                  x1='3'
                  y1='10'
                  x2='21'
                  y2='10'
                /></svg>
              <span>Due: {{@model.dueDate}}</span>
            </div>
          {{/if}}
          {{#if @model.paidAmount}}
            <div class='inv-paid'>
              <svg
                width='12'
                height='12'
                viewBox='0 0 24 24'
                fill='none'
                stroke='#059669'
                stroke-width='2.5'
                stroke-linecap='round'
                stroke-linejoin='round'
              ><polyline points='20 6 9 17 4 12' /></svg>
              <span>Paid: {{@model.paidAmount}}</span>
            </div>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .inv-card {
          background: #fff;
        }
        .inv-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid #ecfdf5;
        }
        .inv-header-left {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .inv-label {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #059669;
        }
        .inv-number {
          font-size: 11px;
          font-weight: 700;
          color: #059669;
          background: #ecfdf5;
          padding: 2px 8px;
          border-radius: 10px;
        }
        .inv-billto {
          font-size: 14px;
          font-weight: 700;
          color: #1a1f2e;
          padding: 10px 16px 4px;
        }
        .inv-items {
          padding: 8px 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .inv-line {
          display: flex;
          align-items: baseline;
          gap: 4px;
          font-size: 12px;
        }
        .inv-desc {
          color: #374151;
          white-space: nowrap;
        }
        .inv-dots {
          flex: 1;
          border-bottom: 1px dotted #d1d5db;
          min-width: 20px;
          margin-bottom: 3px;
        }
        .inv-amt {
          font-weight: 600;
          color: #1a1f2e;
          white-space: nowrap;
        }
        .inv-total-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 16px;
          background: #059669;
          margin-top: 4px;
        }
        .inv-total-text {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: rgba(255, 255, 255, 0.8);
        }
        .inv-total-amt {
          font-size: 18px;
          font-weight: 800;
          color: #fff;
        }
        .inv-footer {
          display: flex;
          justify-content: space-between;
          padding: 8px 16px;
        }
        .inv-due {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: #6b7280;
        }
        .inv-paid {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          font-weight: 600;
          color: #059669;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fit'>
        <div class='fit-bar'></div>
        <div class='fit-content'>
          <div class='fit-top'>
            <span class='fit-badge'>INVOICE</span>
            {{#if @model.invoiceNumber}}<span
                class='fit-num'
              >#{{@model.invoiceNumber}}</span>{{/if}}
          </div>
          <div class='fit-detail'>
            {{#if @model.billTo}}<span>{{@model.billTo}}</span>{{/if}}
            {{#if @model.dueDate}}<span class='fit-sep'>Due
                {{@model.dueDate}}</span>{{/if}}
          </div>
        </div>
        {{#if @model.total}}
          <div class='fit-amount'>{{@model.total}}</div>
        {{/if}}
      </div>
      <style scoped>
        .fit {
          display: flex;
          align-items: center;
          height: 100%;
          overflow: hidden;
          background: #fff;
        }
        .fit-bar {
          width: 4px;
          flex-shrink: 0;
          background: #059669;
          align-self: stretch;
        }
        .fit-content {
          flex: 1;
          padding: 10px 12px;
          min-width: 0;
        }
        .fit-top {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 2px;
        }
        .fit-badge {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #059669;
          flex-shrink: 0;
        }
        .fit-num {
          font-size: 12px;
          font-weight: 700;
          color: #059669;
        }
        .fit-detail {
          font-size: 11px;
          color: #6b7280;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-sep::before {
          content: ' · ';
          color: #d1d5db;
        }
        .fit-amount {
          flex-shrink: 0;
          font-size: 14px;
          font-weight: 800;
          color: #059669;
          padding-right: 12px;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='iso'>
        <div class='iso-accent'></div>
        <div class='iso-header'>
          <div>
            <div class='iso-type'>Invoice</div>
            {{#if @model.invoiceNumber}}<div
                class='iso-num'
              >#{{@model.invoiceNumber}}</div>{{/if}}
          </div>
          {{#if @model.paidAmount}}
            <div class='iso-status-paid'>Paid</div>
          {{else}}
            <div class='iso-status-due'>Outstanding</div>
          {{/if}}
        </div>
        {{#if @model.billTo}}<div class='iso-billto'><span
              class='iso-billto-label'
            >Bill to</span>{{@model.billTo}}</div>{{/if}}
        {{#if @model.lineItems.length}}
          <div class='iso-table'>
            <div class='iso-table-head'>
              <span>Description</span>
              <span>Amount</span>
            </div>
            {{#each @model.lineItems as |li|}}
              <div class='iso-table-row'>
                <span class='iso-table-desc'>{{li.description}}</span>
                <span class='iso-table-amt'>{{li.amount}}</span>
              </div>
            {{/each}}
          </div>
        {{/if}}
        {{#if @model.total}}
          <div class='iso-total'>
            <span class='iso-total-label'>Total Due</span>
            <span class='iso-total-value'>{{@model.total}}</span>
          </div>
        {{/if}}
        <div class='iso-footer'>
          {{#if @model.dueDate}}<div class='iso-due'>Due:
              {{@model.dueDate}}</div>{{/if}}
          {{#if @model.paidAmount}}<div class='iso-paid'>Paid:
              {{@model.paidAmount}}</div>{{/if}}
        </div>
      </article>
      <style scoped>
        .iso {
          background: #fff;
          min-height: 100%;
        }
        .iso-accent {
          height: 4px;
          background: linear-gradient(90deg, #059669, #34d399);
        }
        .iso-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 24px 28px 16px;
        }
        .iso-type {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #059669;
          margin-bottom: 4px;
        }
        .iso-num {
          font-size: 22px;
          font-weight: 800;
          color: #111827;
        }
        .iso-status-paid {
          font-size: 11px;
          font-weight: 700;
          color: #059669;
          background: #ecfdf5;
          padding: 4px 12px;
          border-radius: 20px;
        }
        .iso-status-due {
          font-size: 11px;
          font-weight: 700;
          color: #d97706;
          background: #fffbeb;
          padding: 4px 12px;
          border-radius: 20px;
        }
        .iso-billto {
          padding: 0 28px 16px;
          font-size: 16px;
          font-weight: 700;
          color: #374151;
        }
        .iso-billto-label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #9ca3af;
          display: block;
          margin-bottom: 2px;
        }
        .iso-table {
          padding: 0 28px 16px;
        }
        .iso-table-head {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #9ca3af;
          padding-bottom: 8px;
          border-bottom: 2px solid #ecfdf5;
        }
        .iso-table-row {
          display: flex;
          justify-content: space-between;
          padding: 10px 0;
          border-bottom: 1px solid #f3f4f6;
        }
        .iso-table-desc {
          font-size: 14px;
          color: #374151;
        }
        .iso-table-amt {
          font-size: 14px;
          font-weight: 700;
          color: #1a1f2e;
        }
        .iso-total {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 28px;
          background: #059669;
        }
        .iso-total-label {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: rgba(255, 255, 255, 0.8);
        }
        .iso-total-value {
          font-size: 24px;
          font-weight: 800;
          color: #fff;
        }
        .iso-footer {
          display: flex;
          justify-content: space-between;
          padding: 12px 28px;
        }
        .iso-due {
          font-size: 13px;
          color: #6b7280;
        }
        .iso-paid {
          font-size: 13px;
          font-weight: 700;
          color: #059669;
        }
      </style>
    </template>
  };
}

export class PaymentReceiptCard extends CardDef {
  static displayName = 'Payment Receipt';
  @field payer = contains(StringField);
  @field amount = contains(StringField);
  @field method = contains(StringField);
  @field reference = contains(StringField);
  @field timestamp = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: PaymentReceiptCard) {
      return this.payer ? `Payment — ${this.payer}` : 'Payment';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='pay-card'>
        <div class='pay-hero'>
          <div class='pay-hero-top'>
            <span class='pay-badge'>PAYMENT</span>
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='rgba(255,255,255,0.6)'
              stroke-width='2'
              stroke-linecap='round'
              stroke-linejoin='round'
            ><path d='M22 11.08V12a10 10 0 1 1-5.93-9.14' /><polyline
                points='22 4 12 14.01 9 11.01'
              /></svg>
          </div>
          <div class='pay-amount'>{{@model.amount}}</div>
          {{#if @model.payer}}<div
              class='pay-payer'
            >{{@model.payer}}</div>{{/if}}
        </div>
        <div class='pay-details'>
          {{#if @model.method}}
            <div class='pay-row'>
              <span class='pay-row-label'>Method</span>
              <span class='pay-row-value'>{{@model.method}}</span>
            </div>
          {{/if}}
          {{#if @model.reference}}
            <div class='pay-row'>
              <span class='pay-row-label'>Reference</span>
              <span class='pay-row-value pay-mono'>{{@model.reference}}</span>
            </div>
          {{/if}}
          {{#if @model.timestamp}}
            <div class='pay-row'>
              <span class='pay-row-label'>Date</span>
              <span class='pay-row-value'>{{@model.timestamp}}</span>
            </div>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .pay-card {
          background: #fff;
          overflow: hidden;
        }
        .pay-hero {
          background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%);
          padding: 14px 16px;
        }
        .pay-hero-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .pay-badge {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.7);
        }
        .pay-amount {
          font-size: 26px;
          font-weight: 800;
          color: #fff;
          letter-spacing: -0.02em;
        }
        .pay-payer {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.8);
          margin-top: 2px;
        }
        .pay-details {
          padding: 10px 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .pay-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;
          padding: 4px 0;
          border-bottom: 1px solid #f3f4f6;
        }
        .pay-row:last-child {
          border-bottom: none;
        }
        .pay-row-label {
          color: #9ca3af;
          font-weight: 500;
        }
        .pay-row-value {
          color: #374151;
          font-weight: 600;
        }
        .pay-mono {
          font-family: monospace;
          font-size: 11px;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fit'>
        <div class='fit-bar'></div>
        <div class='fit-content'>
          <div class='fit-top'>
            <span class='fit-badge'>PAYMENT</span>
            <span class='fit-payer'>{{@model.payer}}</span>
          </div>
          <div class='fit-detail'>
            {{#if @model.method}}<span>{{@model.method}}</span>{{/if}}
            {{#if @model.timestamp}}<span
                class='fit-sep'
              >{{@model.timestamp}}</span>{{/if}}
          </div>
        </div>
        {{#if @model.amount}}
          <div class='fit-amount'>{{@model.amount}}</div>
        {{/if}}
      </div>
      <style scoped>
        .fit {
          display: flex;
          align-items: center;
          height: 100%;
          overflow: hidden;
          background: #fff;
        }
        .fit-bar {
          width: 4px;
          flex-shrink: 0;
          background: #0d9488;
          align-self: stretch;
        }
        .fit-content {
          flex: 1;
          padding: 10px 12px;
          min-width: 0;
        }
        .fit-top {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 2px;
        }
        .fit-badge {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #0d9488;
          flex-shrink: 0;
        }
        .fit-payer {
          font-size: 13px;
          font-weight: 700;
          color: #1a1f2e;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-detail {
          font-size: 11px;
          color: #6b7280;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-sep::before {
          content: ' · ';
          color: #d1d5db;
        }
        .fit-amount {
          flex-shrink: 0;
          font-size: 14px;
          font-weight: 800;
          color: #0d9488;
          padding-right: 12px;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='iso'>
        <div class='iso-hero'>
          <div class='iso-hero-top'>
            <span class='iso-badge'>Payment Confirmed</span>
            <svg
              width='24'
              height='24'
              viewBox='0 0 24 24'
              fill='none'
              stroke='rgba(255,255,255,0.7)'
              stroke-width='2'
            ><path d='M22 11.08V12a10 10 0 1 1-5.93-9.14' /><polyline
                points='22 4 12 14.01 9 11.01'
              /></svg>
          </div>
          <div class='iso-amount'>{{@model.amount}}</div>
          {{#if @model.payer}}<div class='iso-payer'>from
              {{@model.payer}}</div>{{/if}}
        </div>
        <div class='iso-details'>
          {{#if @model.method}}
            <div class='iso-row'>
              <span class='iso-row-label'>Payment Method</span>
              <span class='iso-row-value'>{{@model.method}}</span>
            </div>
          {{/if}}
          {{#if @model.reference}}
            <div class='iso-row'>
              <span class='iso-row-label'>Reference</span>
              <span class='iso-row-value iso-mono'>{{@model.reference}}</span>
            </div>
          {{/if}}
          {{#if @model.timestamp}}
            <div class='iso-row'>
              <span class='iso-row-label'>Date</span>
              <span class='iso-row-value'>{{@model.timestamp}}</span>
            </div>
          {{/if}}
        </div>
      </article>
      <style scoped>
        .iso {
          background: #fff;
          min-height: 100%;
        }
        .iso-hero {
          background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%);
          padding: 28px;
        }
        .iso-hero-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .iso-badge {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: rgba(255, 255, 255, 0.8);
        }
        .iso-amount {
          font-size: 36px;
          font-weight: 800;
          color: #fff;
          letter-spacing: -0.02em;
        }
        .iso-payer {
          font-size: 15px;
          color: rgba(255, 255, 255, 0.75);
          margin-top: 4px;
        }
        .iso-details {
          padding: 20px 28px 28px;
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .iso-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 0;
          border-bottom: 1px solid #f3f4f6;
        }
        .iso-row:last-child {
          border-bottom: none;
        }
        .iso-row-label {
          font-size: 13px;
          color: #9ca3af;
        }
        .iso-row-value {
          font-size: 15px;
          font-weight: 600;
          color: #374151;
        }
        .iso-mono {
          font-family: monospace;
          font-size: 13px;
        }
      </style>
    </template>
  };
}

// ──────────── Fulfillment ────────────

export class ShippingConfirmationCard extends CardDef {
  static displayName = 'Shipping Confirmation';
  @field orderNumber = contains(StringField);
  @field carrier = contains(StringField);
  @field trackingNumber = contains(StringField);
  @field estimatedDelivery = contains(StringField);
  @field items = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: ShippingConfirmationCard) {
      return this.items ?? 'Shipping Confirmation';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='ship-card'>
        <div class='ship-header'>
          <div class='ship-carrier-row'>
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='#92400e'
              stroke-width='2'
              stroke-linecap='round'
              stroke-linejoin='round'
            ><rect x='1' y='3' width='15' height='13' /><polygon
                points='16 8 20 8 23 11 23 16 16 16 16 8'
              /><circle cx='5.5' cy='18.5' r='2.5' /><circle
                cx='18.5'
                cy='18.5'
                r='2.5'
              /></svg>
            {{#if @model.carrier}}<span
                class='ship-carrier'
              >{{@model.carrier}}</span>{{/if}}
          </div>
          <span class='ship-badge'>IN TRANSIT</span>
        </div>
        {{#if @model.items}}<div
            class='ship-items'
          >{{@model.items}}</div>{{/if}}
        <div class='ship-track'>
          <div class='ship-track-line'>
            <span class='ship-dot filled'></span>
            <span class='ship-line active'></span>
            <span class='ship-dot filled'></span>
            <span class='ship-line active'></span>
            <span class='ship-dot filled'></span>
            <span class='ship-line'></span>
            <span class='ship-dot'></span>
          </div>
          <div class='ship-track-labels'>
            <span>Printed</span>
            <span>Shipped</span>
            <span>In Transit</span>
            <span>Delivered</span>
          </div>
        </div>
        <div class='ship-meta'>
          {{#if @model.trackingNumber}}
            <div class='ship-meta-row'>
              <span class='ship-meta-label'>Tracking</span>
              <span
                class='ship-meta-value ship-mono'
              >{{@model.trackingNumber}}</span>
            </div>
          {{/if}}
          {{#if @model.estimatedDelivery}}
            <div class='ship-meta-row'>
              <span class='ship-meta-label'>ETA</span>
              <span class='ship-meta-value'>{{@model.estimatedDelivery}}</span>
            </div>
          {{/if}}
          {{#if @model.orderNumber}}
            <div class='ship-meta-row'>
              <span class='ship-meta-label'>Order</span>
              <span class='ship-meta-value'>#{{@model.orderNumber}}</span>
            </div>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .ship-card {
          background: #fff;
        }
        .ship-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid #fef3c7;
        }
        .ship-carrier-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .ship-carrier {
          font-size: 13px;
          font-weight: 700;
          color: #92400e;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .ship-badge {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #92400e;
          background: #fef3c7;
          padding: 2px 8px;
          border-radius: 10px;
        }
        .ship-items {
          font-size: 14px;
          font-weight: 600;
          color: #1a1f2e;
          padding: 10px 16px 8px;
        }
        .ship-track {
          padding: 4px 16px 12px;
        }
        .ship-track-line {
          display: flex;
          align-items: center;
          padding: 0 4px;
        }
        .ship-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #e5e7eb;
          flex-shrink: 0;
        }
        .ship-dot.filled {
          background: #92400e;
        }
        .ship-line {
          flex: 1;
          height: 2px;
          background: #e5e7eb;
        }
        .ship-line.active {
          background: #92400e;
        }
        .ship-track-labels {
          display: flex;
          justify-content: space-between;
          font-size: 9px;
          color: #9ca3af;
          margin-top: 4px;
          padding: 0 0;
        }
        .ship-meta {
          padding: 0 16px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          border-top: 1px solid #f3f4f6;
          padding-top: 8px;
        }
        .ship-meta-row {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
        }
        .ship-meta-label {
          color: #9ca3af;
        }
        .ship-meta-value {
          color: #374151;
          font-weight: 600;
        }
        .ship-mono {
          font-family: monospace;
          font-size: 10px;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fit'>
        <div class='fit-bar'></div>
        <div class='fit-content'>
          <div class='fit-top'>
            <span class='fit-badge'>SHIPPING</span>
            <span class='fit-items'>{{@model.items}}</span>
          </div>
          <div class='fit-detail'>
            {{#if @model.carrier}}<span>{{@model.carrier}}</span>{{/if}}
            {{#if @model.estimatedDelivery}}<span class='fit-sep'>ETA
                {{@model.estimatedDelivery}}</span>{{/if}}
          </div>
        </div>
        <div class='fit-track'>
          <svg
            width='16'
            height='16'
            viewBox='0 0 24 24'
            fill='none'
            stroke='#92400e'
            stroke-width='2'
          ><rect x='1' y='3' width='15' height='13' /><polygon
              points='16 8 20 8 23 11 23 16 16 16 16 8'
            /><circle cx='5.5' cy='18.5' r='2.5' /><circle
              cx='18.5'
              cy='18.5'
              r='2.5'
            /></svg>
        </div>
      </div>
      <style scoped>
        .fit {
          display: flex;
          align-items: center;
          height: 100%;
          overflow: hidden;
          background: #fff;
        }
        .fit-bar {
          width: 4px;
          flex-shrink: 0;
          background: #92400e;
          align-self: stretch;
        }
        .fit-content {
          flex: 1;
          padding: 10px 12px;
          min-width: 0;
        }
        .fit-top {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 2px;
        }
        .fit-badge {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #92400e;
          flex-shrink: 0;
        }
        .fit-items {
          font-size: 13px;
          font-weight: 700;
          color: #1a1f2e;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-detail {
          font-size: 11px;
          color: #6b7280;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-sep::before {
          content: ' · ';
          color: #d1d5db;
        }
        .fit-track {
          flex-shrink: 0;
          padding-right: 12px;
          display: flex;
          align-items: center;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='iso'>
        <div class='iso-accent'></div>
        <div class='iso-header'>
          <svg
            class='iso-icon'
            width='22'
            height='22'
            viewBox='0 0 24 24'
            fill='none'
            stroke='#92400e'
            stroke-width='2'
          ><rect x='1' y='3' width='15' height='13' /><polygon
              points='16 8 20 8 23 11 23 16 16 16 16 8'
            /><circle cx='5.5' cy='18.5' r='2.5' /><circle
              cx='18.5'
              cy='18.5'
              r='2.5'
            /></svg>
          <div>
            <div class='iso-type'>Shipping Confirmation</div>
            <div class='iso-title'>{{@model.items}}</div>
          </div>
          <span class='iso-status'>In Transit</span>
        </div>
        <div class='iso-track'>
          <div class='iso-track-line'>
            <div class='iso-step done'>
              <div class='iso-step-dot'></div>
              <div class='iso-step-label'>Printed</div>
            </div>
            <div class='iso-step-conn done'></div>
            <div class='iso-step done'>
              <div class='iso-step-dot'></div>
              <div class='iso-step-label'>Shipped</div>
            </div>
            <div class='iso-step-conn done'></div>
            <div class='iso-step active'>
              <div class='iso-step-dot'></div>
              <div class='iso-step-label'>In Transit</div>
            </div>
            <div class='iso-step-conn'></div>
            <div class='iso-step'>
              <div class='iso-step-dot'></div>
              <div class='iso-step-label'>Delivered</div>
            </div>
          </div>
        </div>
        <div class='iso-details'>
          {{#if @model.carrier}}
            <div class='iso-row'><span class='iso-row-label'>Carrier</span><span
                class='iso-row-value'
              >{{@model.carrier}}</span></div>
          {{/if}}
          {{#if @model.trackingNumber}}
            <div class='iso-row'><span class='iso-row-label'>Tracking Number</span><span
                class='iso-row-value iso-mono'
              >{{@model.trackingNumber}}</span></div>
          {{/if}}
          {{#if @model.estimatedDelivery}}
            <div class='iso-row'><span class='iso-row-label'>Estimated Delivery</span><span
                class='iso-row-value'
              >{{@model.estimatedDelivery}}</span></div>
          {{/if}}
          {{#if @model.orderNumber}}
            <div class='iso-row'><span class='iso-row-label'>Order Number</span><span
                class='iso-row-value'
              >#{{@model.orderNumber}}</span></div>
          {{/if}}
        </div>
      </article>
      <style scoped>
        .iso {
          background: #fff;
          min-height: 100%;
        }
        .iso-accent {
          height: 4px;
          background: linear-gradient(90deg, #92400e, #d97706);
        }
        .iso-header {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 24px 28px 20px;
        }
        .iso-icon {
          flex-shrink: 0;
          margin-top: 2px;
        }
        .iso-type {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #92400e;
          margin-bottom: 4px;
        }
        .iso-title {
          font-size: 22px;
          font-weight: 800;
          color: #111827;
          line-height: 1.2;
        }
        .iso-status {
          margin-left: auto;
          font-size: 11px;
          font-weight: 700;
          color: #92400e;
          background: #fef3c7;
          padding: 4px 12px;
          border-radius: 20px;
          white-space: nowrap;
        }
        .iso-track {
          padding: 0 28px 24px;
        }
        .iso-track-line {
          display: flex;
          align-items: flex-start;
        }
        .iso-step {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 0 0 auto;
        }
        .iso-step-dot {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #e5e7eb;
          margin-bottom: 6px;
        }
        .iso-step.done .iso-step-dot {
          background: #92400e;
        }
        .iso-step.active .iso-step-dot {
          background: #92400e;
          box-shadow: 0 0 0 4px rgba(146, 64, 14, 0.15);
        }
        .iso-step-label {
          font-size: 10px;
          color: #9ca3af;
          white-space: nowrap;
        }
        .iso-step.done .iso-step-label,
        .iso-step.active .iso-step-label {
          color: #92400e;
          font-weight: 600;
        }
        .iso-step-conn {
          flex: 1;
          height: 2px;
          background: #e5e7eb;
          margin-top: 7px;
          min-width: 20px;
        }
        .iso-step-conn.done {
          background: #92400e;
        }
        .iso-details {
          padding: 0 28px 28px;
          display: flex;
          flex-direction: column;
          border-top: 1px solid #f3f4f6;
        }
        .iso-row {
          display: flex;
          justify-content: space-between;
          padding: 12px 0;
          border-bottom: 1px solid #f3f4f6;
        }
        .iso-row:last-child {
          border-bottom: none;
        }
        .iso-row-label {
          font-size: 13px;
          color: #9ca3af;
        }
        .iso-row-value {
          font-size: 14px;
          font-weight: 600;
          color: #374151;
        }
        .iso-mono {
          font-family: monospace;
          font-size: 13px;
        }
      </style>
    </template>
  };
}

// ──────────── Identity ────────────

export class VendorProfileCard extends CardDef {
  static displayName = 'Vendor Profile';
  @field vendorName = contains(StringField);
  @field category = contains(StringField);
  @field specialties = contains(StringField);
  @field bio = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: VendorProfileCard) {
      return this.vendorName ?? 'Vendor Profile';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    get initials() {
      const name = this.args.model.vendorName;
      if (!name) return '?';
      return name
        .split(' ')
        .map((w: string) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
    }

    <template>
      <div class='prof-card'>
        <div class='prof-banner'></div>
        <div class='prof-body'>
          <div class='prof-avatar'>{{this.initials}}</div>
          <div class='prof-name'>{{@model.vendorName}}</div>
          {{#if @model.category}}<div
              class='prof-category'
            >{{@model.category}}</div>{{/if}}
          {{#if @model.specialties}}
            <div class='prof-tags'>
              <span class='prof-tag'>{{@model.specialties}}</span>
            </div>
          {{/if}}
          {{#if @model.bio}}<div class='prof-bio'>{{@model.bio}}</div>{{/if}}
        </div>
      </div>
      <style scoped>
        .prof-card {
          background: #fff;
          overflow: hidden;
        }
        .prof-banner {
          height: 32px;
          background: linear-gradient(135deg, #db2777 0%, #ec4899 100%);
        }
        .prof-body {
          padding: 0 16px 14px;
          position: relative;
        }
        .prof-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: #db2777;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 800;
          letter-spacing: 0.02em;
          border: 3px solid #fff;
          margin-top: -20px;
          margin-bottom: 8px;
        }
        .prof-name {
          font-size: 16px;
          font-weight: 700;
          color: #1a1f2e;
        }
        .prof-category {
          font-size: 12px;
          color: #6b7280;
          margin-top: 1px;
        }
        .prof-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 8px;
        }
        .prof-tag {
          font-size: 11px;
          font-weight: 600;
          color: #db2777;
          background: #fdf2f8;
          padding: 2px 8px;
          border-radius: 10px;
        }
        .prof-bio {
          font-size: 12px;
          color: #6b7280;
          line-height: 1.5;
          margin-top: 8px;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get initials() {
      const name = this.args.model.vendorName;
      if (!name) return '?';
      return name
        .split(' ')
        .map((w: string) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
    }

    <template>
      <div class='fit'>
        <div class='fit-avatar'>{{this.initials}}</div>
        <div class='fit-content'>
          <div class='fit-name'>{{@model.vendorName}}</div>
          <div class='fit-detail'>
            {{#if @model.category}}<span>{{@model.category}}</span>{{/if}}
          </div>
        </div>
      </div>
      <style scoped>
        .fit {
          display: flex;
          align-items: center;
          height: 100%;
          overflow: hidden;
          background: #fff;
          gap: 10px;
          padding: 0 12px;
        }
        .fit-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #db2777;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 800;
          flex-shrink: 0;
        }
        .fit-content {
          min-width: 0;
        }
        .fit-name {
          font-size: 13px;
          font-weight: 700;
          color: #1a1f2e;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-detail {
          font-size: 11px;
          color: #6b7280;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    get initials() {
      const name = this.args.model.vendorName;
      if (!name) return '?';
      return name
        .split(' ')
        .map((w: string) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
    }

    <template>
      <article class='iso'>
        <div class='iso-banner'></div>
        <div class='iso-profile'>
          <div class='iso-avatar'>{{this.initials}}</div>
          <div class='iso-name'>{{@model.vendorName}}</div>
          {{#if @model.category}}<div
              class='iso-category'
            >{{@model.category}}</div>{{/if}}
        </div>
        {{#if @model.specialties}}
          <div class='iso-section'>
            <div class='iso-section-label'>Specialties</div>
            <div class='iso-tags'>
              <span class='iso-tag'>{{@model.specialties}}</span>
            </div>
          </div>
        {{/if}}
        {{#if @model.bio}}
          <div class='iso-section'>
            <div class='iso-section-label'>About</div>
            <div class='iso-bio'>{{@model.bio}}</div>
          </div>
        {{/if}}
      </article>
      <style scoped>
        .iso {
          background: #fff;
          min-height: 100%;
        }
        .iso-banner {
          height: 80px;
          background: linear-gradient(
            135deg,
            #db2777 0%,
            #ec4899 50%,
            #f472b6 100%
          );
        }
        .iso-profile {
          padding: 0 28px 20px;
          position: relative;
        }
        .iso-avatar {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          background: #db2777;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          font-weight: 800;
          letter-spacing: 0.02em;
          border: 4px solid #fff;
          margin-top: -32px;
          margin-bottom: 12px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        .iso-name {
          font-size: 24px;
          font-weight: 800;
          color: #111827;
        }
        .iso-category {
          font-size: 14px;
          color: #6b7280;
          margin-top: 2px;
        }
        .iso-section {
          padding: 0 28px 20px;
        }
        .iso-section-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #9ca3af;
          margin-bottom: 8px;
        }
        .iso-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .iso-tag {
          font-size: 13px;
          font-weight: 600;
          color: #db2777;
          background: #fdf2f8;
          padding: 4px 12px;
          border-radius: 20px;
        }
        .iso-bio {
          font-size: 15px;
          color: #4b5563;
          line-height: 1.7;
        }
      </style>
    </template>
  };
}

export class WorkspaceBoardCard extends CardDef {
  static displayName = 'Workspace Board';
  @field workspaceName = contains(StringField);
  @field description = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: WorkspaceBoardCard) {
      return this.workspaceName ?? 'Workspace';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='board-card'>
        <div class='board-header'>
          <svg
            width='16'
            height='16'
            viewBox='0 0 24 24'
            fill='none'
            stroke='#3b82f6'
            stroke-width='2'
            stroke-linecap='round'
            stroke-linejoin='round'
          ><rect x='3' y='3' width='7' height='7' /><rect
              x='14'
              y='3'
              width='7'
              height='7'
            /><rect x='14' y='14' width='7' height='7' /><rect
              x='3'
              y='14'
              width='7'
              height='7'
            /></svg>
          <span class='board-badge'>BOARD</span>
        </div>
        <div class='board-name'>{{@model.workspaceName}}</div>
        {{#if @model.description}}<div
            class='board-desc'
          >{{@model.description}}</div>{{/if}}
        <div class='board-columns'>
          <div class='board-col'>
            <div class='board-col-header'>To Do</div>
            <div class='board-col-card'></div>
            <div class='board-col-card short'></div>
          </div>
          <div class='board-col'>
            <div class='board-col-header'>In Progress</div>
            <div class='board-col-card accent'></div>
          </div>
          <div class='board-col'>
            <div class='board-col-header'>Done</div>
            <div class='board-col-card done'></div>
            <div class='board-col-card done'></div>
            <div class='board-col-card done short'></div>
          </div>
        </div>
      </div>
      <style scoped>
        .board-card {
          background: #fff;
          padding: 14px 16px;
        }
        .board-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
        }
        .board-badge {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #3b82f6;
        }
        .board-name {
          font-size: 15px;
          font-weight: 700;
          color: #1a1f2e;
          margin-bottom: 2px;
        }
        .board-desc {
          font-size: 12px;
          color: #6b7280;
          margin-bottom: 12px;
        }
        .board-columns {
          display: flex;
          gap: 6px;
          background: #f9fafb;
          border-radius: 6px;
          padding: 8px;
        }
        .board-col {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .board-col-header {
          font-size: 8px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #9ca3af;
          margin-bottom: 2px;
        }
        .board-col-card {
          height: 12px;
          background: #e5e7eb;
          border-radius: 3px;
        }
        .board-col-card.short {
          width: 70%;
        }
        .board-col-card.accent {
          background: #3b82f6;
        }
        .board-col-card.done {
          background: #86efac;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fit'>
        <div class='fit-bar'></div>
        <div class='fit-content'>
          <div class='fit-top'>
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='#3b82f6'
              stroke-width='2'
            ><rect x='3' y='3' width='7' height='7' /><rect
                x='14'
                y='3'
                width='7'
                height='7'
              /><rect x='14' y='14' width='7' height='7' /><rect
                x='3'
                y='14'
                width='7'
                height='7'
              /></svg>
            <span class='fit-name'>{{@model.workspaceName}}</span>
          </div>
          {{#if @model.description}}
            <div class='fit-detail'>{{@model.description}}</div>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .fit {
          display: flex;
          align-items: center;
          height: 100%;
          overflow: hidden;
          background: #fff;
        }
        .fit-bar {
          width: 4px;
          flex-shrink: 0;
          background: #6b7280;
          align-self: stretch;
        }
        .fit-content {
          flex: 1;
          padding: 10px 12px;
          min-width: 0;
        }
        .fit-top {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 2px;
        }
        .fit-name {
          font-size: 13px;
          font-weight: 700;
          color: #1a1f2e;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-detail {
          font-size: 11px;
          color: #6b7280;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='iso'>
        <div class='iso-accent'></div>
        <div class='iso-header'>
          <svg
            width='24'
            height='24'
            viewBox='0 0 24 24'
            fill='none'
            stroke='#3b82f6'
            stroke-width='2'
          ><rect x='3' y='3' width='7' height='7' /><rect
              x='14'
              y='3'
              width='7'
              height='7'
            /><rect x='14' y='14' width='7' height='7' /><rect
              x='3'
              y='14'
              width='7'
              height='7'
            /></svg>
          <div>
            <div class='iso-type'>Workspace Board</div>
            <div class='iso-title'>{{@model.workspaceName}}</div>
          </div>
        </div>
        {{#if @model.description}}<div
            class='iso-desc'
          >{{@model.description}}</div>{{/if}}
        <div class='iso-board'>
          <div class='iso-col'>
            <div class='iso-col-head'>To Do</div>
            <div class='iso-col-card'></div>
            <div class='iso-col-card short'></div>
            <div class='iso-col-card'></div>
          </div>
          <div class='iso-col'>
            <div class='iso-col-head'>In Progress</div>
            <div class='iso-col-card accent'></div>
            <div class='iso-col-card accent short'></div>
          </div>
          <div class='iso-col'>
            <div class='iso-col-head'>Review</div>
            <div class='iso-col-card review'></div>
          </div>
          <div class='iso-col'>
            <div class='iso-col-head'>Done</div>
            <div class='iso-col-card done'></div>
            <div class='iso-col-card done'></div>
            <div class='iso-col-card done short'></div>
            <div class='iso-col-card done'></div>
          </div>
        </div>
      </article>
      <style scoped>
        .iso {
          background: #fff;
          min-height: 100%;
        }
        .iso-accent {
          height: 4px;
          background: linear-gradient(90deg, #6b7280, #3b82f6);
        }
        .iso-header {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 24px 28px 12px;
        }
        .iso-type {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #6b7280;
          margin-bottom: 4px;
        }
        .iso-title {
          font-size: 22px;
          font-weight: 800;
          color: #111827;
          line-height: 1.2;
        }
        .iso-desc {
          font-size: 14px;
          color: #6b7280;
          padding: 0 28px 20px;
          line-height: 1.5;
        }
        .iso-board {
          display: flex;
          gap: 10px;
          padding: 0 28px 28px;
        }
        .iso-col {
          flex: 1;
          background: #f9fafb;
          border-radius: 8px;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .iso-col-head {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #9ca3af;
          margin-bottom: 4px;
        }
        .iso-col-card {
          height: 20px;
          background: #e5e7eb;
          border-radius: 4px;
        }
        .iso-col-card.short {
          width: 75%;
        }
        .iso-col-card.accent {
          background: #3b82f6;
        }
        .iso-col-card.review {
          background: #f59e0b;
        }
        .iso-col-card.done {
          background: #86efac;
        }
      </style>
    </template>
  };
}

// touched for re-index
