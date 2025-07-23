import {
  CardDef,
  FieldDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { eq } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { action } from '@ember/object';

import BooleanField from 'https://cardstack.com/base/boolean';

import BrainIcon from '@cardstack/boxel-icons/brain';

class ModelSettingsFieldEdit extends Component<typeof ModelSettingsField> {
  @action
  updateRole(event: Event) {
    const target = event.target as HTMLInputElement;
    this.args.model.role = target.value;
  }

  @action
  toggleAssistantUse() {
    this.args.model.forAssistantUse = !this.args.model.forAssistantUse;
  }

  @action
  toggleAgenticUse() {
    this.args.model.forAgenticUse = !this.args.model.forAgenticUse;
  }

  @action
  toggleDisabled() {
    this.args.model.isDisabled = !this.args.model.isDisabled;
  }

  <template>
    <div class='model-settings-edit'>
      <div class='model-select'>
        <@fields.model />
      </div>

      <div class='role-row'>
        <label>
          <input
            type='text'
            value={{@model.role}}
            placeholder='Enter role description...'
            {{on 'input' this.updateRole}}
            class='role-text-input'
          />
        </label>

        <div class='pills-container'>
          <div class='pills-left'>
            <button
              type='button'
              class='pill-toggle assistant
                {{if @model.forAssistantUse "active"}}'
              {{on 'click' this.toggleAssistantUse}}
              aria-label='Toggle AI Assistant usage'
            >
              <div class='pill-symbol-box'>
                <svg
                  class='pill-symbol'
                  width='12'
                  height='12'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2.5'
                >
                  <path d='m9 12 2 2 4-4' />
                </svg>
              </div>
              <span class='pill-label'>Assistant</span>
            </button>

            <button
              type='button'
              class='pill-toggle agent {{if @model.forAgenticUse "active"}}'
              {{on 'click' this.toggleAgenticUse}}
              aria-label='Toggle Agent usage'
            >
              <div class='pill-symbol-box'>
                <svg
                  class='pill-symbol'
                  width='12'
                  height='12'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2.5'
                >
                  <path d='m9 12 2 2 4-4' />
                </svg>
              </div>
              <span class='pill-label'>Agent</span>
            </button>
          </div>

          <div class='pills-right'>
            <button
              type='button'
              class='pill-toggle disabled {{if @model.isDisabled "active"}}'
              {{on 'click' this.toggleDisabled}}
              title='When disabled, model is not available in AI Assistant'
              aria-label='Toggle model disabled state'
            >
              <div class='pill-symbol-box'>
                <svg
                  class='pill-symbol'
                  width='12'
                  height='12'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2.5'
                >
                  <circle cx='12' cy='12' r='10' />
                  <path d='m4.9 4.9 14.2 14.2' />
                </svg>
              </div>
              <span class='pill-label'>Disabled</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .model-settings-edit {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        max-width: 600px;
      }

      .model-select :deep(.field-container) {
        background: oklch(0.98 0 0);
        border: 1px solid oklch(0.88 0.01 220);
        border-radius: 0.5rem;
        padding: 0.5rem;
        font-size: 0.875rem;
      }

      .role-row {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .role-text-input {
        width: 100%;
        background: oklch(0.98 0 0);
        border: 1px solid oklch(0.88 0.01 220);
        border-radius: 0.5rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
        font-family: inherit;
        color: oklch(0.15 0 0);
        transition: all 0.15s ease;
        box-sizing: border-box;
      }

      .role-text-input:focus {
        outline: none;
        border-color: oklch(0.55 0.18 250);
        box-shadow: 0 0 0 3px oklch(0.55 0.18 250 / 0.1);
      }

      .role-text-input::placeholder {
        color: oklch(0.6 0.02 220);
        font-style: italic;
      }

      .pills-container {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
      }

      .pills-left {
        display: flex;
        gap: 0.375rem;
        align-items: center;
      }

      .pills-right {
        display: flex;
        gap: 0.375rem;
        align-items: center;
      }

      .pill-toggle {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.375rem;
        padding: 0.375rem 0.625rem;
        border: 1.5px solid oklch(0.88 0.01 220);
        border-radius: 1.25rem;
        background: oklch(0.98 0 0);
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        cursor: pointer;
        user-select: none;
        font-size: 0.75rem;
        font-weight: 600;
        color: oklch(0.35 0.02 220);
        min-height: 2rem;
      }

      .pill-toggle:hover:not(.active) {
        border-color: oklch(0.75 0.05 220);
        background: oklch(0.95 0 0);
        transform: translateY(-1px);
      }

      .pill-toggle:active {
        transform: translateY(0);
      }

      .pill-symbol-box {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        background: oklch(0.92 0.002 220);
        border: 1px solid oklch(0.85 0.01 220);
        border-radius: 50%;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        flex-shrink: 0;
      }

      .pill-symbol {
        width: 0.875rem;
        height: 0.875rem;
        stroke-width: 2.5px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        opacity: 0;
        transform: scale(0.8) rotate(-90deg);
        color: oklch(0.6 0.02 220);
      }

      .pill-label {
        transition: all 0.25s ease;
        font-weight: 600;
      }

      /* Base state symbols (when inactive) */
      .pill-toggle:not(.active) .pill-symbol-box {
        background: oklch(0.92 0.002 220);
        border-color: oklch(0.85 0.01 220);
      }

      .pill-toggle:not(.active) .pill-symbol {
        opacity: 0;
        transform: scale(0.6) rotate(-45deg);
      }

      /* Active state styling with symbol animations */
      .pill-toggle.active {
        border-color: var(--active-border);
        background: var(--active-bg);
        box-shadow: var(--active-shadow);
        transform: translateY(-1px);
      }

      .pill-toggle.active .pill-label {
        color: var(--active-text);
      }

      .pill-toggle.active .pill-symbol-box {
        background: var(--symbol-bg);
        border-color: var(--symbol-border);
        box-shadow: var(--symbol-shadow);
      }

      .pill-toggle.active .pill-symbol {
        opacity: 1;
        transform: scale(1) rotate(0deg);
        color: var(--symbol-color);
      }

      .pill-toggle.active:hover {
        transform: translateY(-2px);
        box-shadow: var(--active-shadow-hover);
      }

      .pill-toggle.active:hover .pill-symbol-box {
        transform: scale(1.1);
      }

      /* Assistant pill styles - Check mark */
      .pill-toggle.assistant {
        --active-border: oklch(0.55 0.15 160);
        --active-bg: oklch(0.96 0.03 160);
        --active-text: oklch(0.45 0.12 160);
        --active-shadow: 0 2px 8px oklch(0.55 0.15 160 / 0.25);
        --active-shadow-hover: 0 4px 12px oklch(0.55 0.15 160 / 0.35);
        --symbol-bg: oklch(0.55 0.15 160);
        --symbol-border: oklch(0.45 0.12 160);
        --symbol-color: white;
        --symbol-shadow: 0 2px 4px oklch(0.55 0.15 160 / 0.4);
      }

      /* Agent pill styles - Check mark */
      .pill-toggle.agent {
        --active-border: oklch(0.55 0.18 280);
        --active-bg: oklch(0.96 0.03 280);
        --active-text: oklch(0.45 0.15 280);
        --active-shadow: 0 2px 8px oklch(0.55 0.18 280 / 0.25);
        --active-shadow-hover: 0 4px 12px oklch(0.55 0.18 280 / 0.35);
        --symbol-bg: oklch(0.55 0.18 280);
        --symbol-border: oklch(0.45 0.15 280);
        --symbol-color: white;
        --symbol-shadow: 0 2px 4px oklch(0.55 0.18 280 / 0.4);
      }

      /* Disabled pill styles - Circle slash with tooltip */
      .pill-toggle.disabled {
        --active-border: oklch(0.65 0.12 15);
        --active-bg: oklch(0.96 0.02 15);
        --active-text: oklch(0.55 0.1 15);
        --active-shadow: 0 2px 8px oklch(0.65 0.12 15 / 0.25);
        --active-shadow-hover: 0 4px 12px oklch(0.65 0.12 15 / 0.35);
        --symbol-bg: oklch(0.65 0.12 15);
        --symbol-border: oklch(0.55 0.1 15);
        --symbol-color: white;
        --symbol-shadow: 0 2px 4px oklch(0.65 0.12 15 / 0.4);
      }

      /* Tooltip styling for disabled button */
      .pill-toggle.disabled[title] {
        position: relative;
      }

      .pill-toggle.disabled[title]:hover::after {
        content: attr(title);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: 0.5rem;
        padding: 0.375rem 0.75rem;
        background: oklch(0.15 0 0);
        color: white;
        font-size: 0.6875rem;
        font-weight: 500;
        white-space: nowrap;
        border-radius: 0.375rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 100;
        pointer-events: none;
        opacity: 0;
        animation: tooltipFadeIn 0.2s ease-out forwards;
      }

      .pill-toggle.disabled[title]:hover::before {
        content: '';
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: 0.25rem;
        border: 0.25rem solid transparent;
        border-top-color: oklch(0.15 0 0);
        z-index: 100;
        pointer-events: none;
        opacity: 0;
        animation: tooltipFadeIn 0.2s ease-out forwards;
      }

      @keyframes tooltipFadeIn {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(0.25rem);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }

      /* Different symbol for disabled when active */
      .pill-toggle.disabled.active .pill-symbol {
        animation: disabledPulse 2s ease-in-out infinite;
      }

      @keyframes disabledPulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
      }

      /* Focus states for accessibility */
      .pill-toggle:focus {
        outline: 2px solid oklch(0.55 0.18 250);
        outline-offset: 2px;
      }

      .pill-toggle:focus .pill-symbol-box {
        outline: 1px solid oklch(0.55 0.18 250 / 0.3);
        outline-offset: 1px;
      }

      /* Responsive adjustments */
      @media (max-width: 500px) {
        .pills-container {
          flex-direction: column;
          align-items: stretch;
          gap: 0.5rem;
        }

        .pills-left,
        .pills-right {
          justify-content: center;
        }

        .role-row {
          gap: 0.75rem;
        }
      }

      @media (max-width: 400px) {
        .pill-toggle {
          padding: 0.3125rem 0.5rem;
          font-size: 0.6875rem;
          gap: 0.25rem;
        }

        .pill-symbol-box {
          width: 1rem;
          height: 1rem;
        }

        .pill-symbol {
          width: 10px;
          height: 10px;
        }
      }

      /* Activation animation */
      @keyframes pillActivate {
        0% {
          transform: translateY(-1px) scale(1);
        }
        50% {
          transform: translateY(-2px) scale(1.05);
        }
        100% {
          transform: translateY(-1px) scale(1);
        }
      }

      @keyframes symbolEnter {
        0% {
          transform: scale(0.4) rotate(-180deg);
          opacity: 0;
        }
        60% {
          transform: scale(1.2) rotate(10deg);
          opacity: 0.8;
        }
        100% {
          transform: scale(1) rotate(0deg);
          opacity: 1;
        }
      }

      .pill-toggle.active {
        animation: pillActivate 0.3s ease-out;
      }

      .pill-toggle.active .pill-symbol {
        animation: symbolEnter 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
      }

      /* Hover state enhancements */
      .pill-toggle:hover .pill-symbol-box {
        background: oklch(0.88 0.004 220);
        border-color: oklch(0.8 0.02 220);
        transform: scale(1.05);
      }

      .pill-toggle:hover:not(.active) .pill-symbol {
        opacity: 0.3;
        transform: scale(0.8) rotate(-15deg);
      }
    </style>
  </template>
}

export class ModelSettingsField extends FieldDef {
  static displayName = 'Model Settings';
  static icon = BrainIcon;

  @field model = linksTo(() => Model);
  @field role = contains(StringField);
  @field forAssistantUse = contains(BooleanField);
  @field forAgenticUse = contains(BooleanField);
  @field isDisabled = contains(BooleanField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='model-settings-tile-card'>
        <div class='tile-header'>
          <div class='model-section'>
            {{#if @model.model}}
              <div class='model-name'>{{@model.model.title}}</div>
              {{#if @model.model.modelId}}
                <div class='model-id'>{{@model.model.modelId}}</div>
              {{/if}}
            {{else}}
              <div class='no-model-assigned'>
                <svg
                  class='no-model-icon'
                  width='16'
                  height='16'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='12' cy='12' r='3' />
                  <path d='m8 16 1.5-1.5M16 8l-1.5 1.5m0 5L16 16M8 8l1.5 1.5' />
                  <circle cx='12' cy='12' r='10' />
                </svg>
                <span>No model assigned</span>
              </div>
            {{/if}}
          </div>

          <div class='status-indicators'>
            {{#if @model.isDisabled}}
              <div class='status-badge disabled'>
                <svg
                  width='12'
                  height='12'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='12' cy='12' r='10' />
                  <path d='m4.9 4.9 14.2 14.2' />
                </svg>
                Disabled
              </div>
            {{/if}}
          </div>
        </div>

        {{#if @model.role}}
          <div class='role-section'>
            <div class='role-label'>Role</div>
            <div class='role-value'>{{@model.role}}</div>
          </div>
        {{/if}}

        <div class='usage-section'>
          <div class='usage-label'>Usage</div>
          <div class='usage-pills'>
            <div
              class='usage-pill assistant
                {{if @model.forAssistantUse "active"}}'
            >
              <div class='pill-icon'>
                {{#if @model.forAssistantUse}}
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2.5'
                  >
                    <path d='m9 12 2 2 4-4' />
                  </svg>
                {{else}}
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='m18 6-12 12M6 6l12 12' />
                  </svg>
                {{/if}}
              </div>
              <span>Assistant</span>
            </div>

            <div class='usage-pill agent {{if @model.forAgenticUse "active"}}'>
              <div class='pill-icon'>
                {{#if @model.forAgenticUse}}
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2.5'
                  >
                    <path d='m9 12 2 2 4-4' />
                  </svg>
                {{else}}
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='m18 6-12 12M6 6l12 12' />
                  </svg>
                {{/if}}
              </div>
              <span>Agent</span>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .model-settings-tile-card {
          background: linear-gradient(
            135deg,
            oklch(0.99 0.002 160),
            oklch(1 0 0)
          );
          border: 1px solid oklch(0.88 0.008 160);
          border-radius: 0.5rem;
          padding: 1rem;
          transition: all 0.15s ease;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
          font-family: 'Inter', system-ui, sans-serif;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          min-height: 0;
        }

        .model-settings-tile-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(
            90deg,
            oklch(0.55 0.15 160),
            oklch(0.45 0.12 165)
          );
          border-radius: 0.5rem 0.5rem 0 0;
        }

        .model-settings-tile-card:hover {
          border-color: oklch(0.8 0.008 160);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
          transform: translateY(-1px);
        }

        .tile-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.75rem;
        }

        .model-section {
          flex: 1;
          min-width: 0;
        }

        .model-name {
          font-size: 0.875rem;
          font-weight: 700;
          color: oklch(0.15 0 0);
          line-height: 1.3;
          margin-bottom: 0.25rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .model-id {
          font-family: 'Fira Code', 'SF Mono', monospace;
          font-size: 0.75rem;
          color: oklch(0.45 0.02 220);
          background: oklch(0.94 0.005 220);
          padding: 0.125rem 0.375rem;
          border-radius: 0.1875rem;
          display: inline-block;
          width: fit-content;
          max-width: 100%;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .no-model-assigned {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: oklch(0.55 0.02 220);
          font-size: 0.875rem;
          font-style: italic;
        }

        .no-model-icon {
          color: oklch(0.65 0.02 220);
          flex-shrink: 0;
        }

        .status-indicators {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          align-items: flex-end;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.6875rem;
          font-weight: 600;
          padding: 0.25rem 0.5rem;
          border-radius: 0.375rem;
          line-height: 1;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .status-badge.disabled {
          background: oklch(0.65 0.12 15);
          color: white;
          box-shadow: 0 1px 3px oklch(0.65 0.12 15 / 0.3);
        }

        .role-section,
        .usage-section {
          border-top: 1px solid oklch(0.92 0.005 160);
          padding-top: 0.75rem;
        }

        .role-label,
        .usage-label {
          font-size: 0.6875rem;
          font-weight: 600;
          color: oklch(0.45 0.02 160);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.5rem;
        }

        .role-value {
          font-size: 0.875rem;
          font-weight: 500;
          color: oklch(0.25 0.02 160);
          line-height: 1.3;
          padding: 0.5rem 0.75rem;
          background: oklch(0.98 0.002 160);
          border-radius: 0.375rem;
          border: 1px solid oklch(0.92 0.005 160);
        }

        .usage-pills {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .usage-pill {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.375rem 0.75rem;
          border-radius: 0.75rem;
          font-size: 0.75rem;
          font-weight: 600;
          transition: all 0.15s ease;
          border: 1.5px solid;
        }

        .usage-pill:not(.active) {
          border-color: oklch(0.85 0.008 160);
          background: oklch(0.96 0.002 160);
          color: oklch(0.55 0.02 160);
        }

        .usage-pill.assistant.active {
          border-color: oklch(0.55 0.15 160);
          background: oklch(0.55 0.15 160);
          color: white;
          box-shadow: 0 2px 4px oklch(0.55 0.15 160 / 0.3);
        }

        .usage-pill.agent.active {
          border-color: oklch(0.55 0.18 280);
          background: oklch(0.55 0.18 280);
          color: white;
          box-shadow: 0 2px 4px oklch(0.55 0.18 280 / 0.3);
        }

        .pill-icon {
          width: 1rem;
          height: 1rem;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .pill-icon svg {
          width: 0.625rem;
          height: 0.625rem;
          stroke-width: 2px;
        }

        .usage-pill:not(.active) .pill-icon {
          background: oklch(0.88 0.008 160);
          color: oklch(0.55 0.02 160);
        }

        .usage-pill.active .pill-icon {
          background: rgba(255, 255, 255, 0.25);
          color: white;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='model-atom'>
        {{if @model.role @model.role 'Role'}}
        {{#if @model.forAssistantUse}}<span class='ai-dot'>●</span>{{/if}}
      </span>

      <style scoped>
        .model-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 0.75rem;
          font-weight: 500;
          color: oklch(0.145 0 0);
        }

        .ai-dot {
          color: oklch(0.55 0.15 160);
          font-size: 0.5rem;
        }
      </style>
    </template>
  };

  static edit = ModelSettingsFieldEdit;
}

class Isolated extends Component<typeof Model> {
  @action
  copyModelId() {
    if (this.args.model?.modelId && navigator.clipboard) {
      navigator.clipboard.writeText(this.args.model.modelId);
    }
  }

  get parsedModelInfo() {
    const title = this.args.model?.title || '';
    const modelId = this.args.model?.modelId || '';
    const displayName = this.args.model?.displayName || '';

    const providerPatterns = [
      {
        pattern:
          /^(OpenAI|Anthropic|Google|DeepSeek|Meta|X\\.AI|Nvidia)\\s+(.+)/i,
        extraction: true,
      },
      {
        pattern: /^(Claude|GPT|Gemini|LLaMA|Llama|Grok)\\s*(.*)$/i,
        provider: 'AI Provider',
        extraction: false,
      },
    ];

    for (const {
      pattern,
      provider: defaultProvider,
      extraction,
    } of providerPatterns) {
      const match = title.match(pattern);
      if (match) {
        if (extraction) {
          return {
            provider: match[1],
            model: match[2],
            tagline: displayName && displayName !== title ? displayName : null,
          };
        } else {
          return {
            provider: defaultProvider || 'AI Provider',
            model: title,
            tagline: displayName && displayName !== title ? displayName : null,
          };
        }
      }
    }

    if (modelId.includes('/')) {
      const [provider, model] = modelId.split('/', 2);
      return {
        provider: provider.charAt(0).toUpperCase() + provider.slice(1),
        model: model || title,
        tagline: displayName && displayName !== title ? displayName : null,
      };
    }

    return {
      provider: 'AI Provider',
      model: title || 'Unnamed Model',
      tagline: displayName && displayName !== title ? displayName : null,
    };
  }

  <template>
    <div class='model-showcase'>
      <div class='hero-section'>
        <div class='hero-content'>
          <div class='model-header'>
            <div class='model-icon'>
              <svg
                width='32'
                height='32'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='3' />
                <path d='m8 16 1.5-1.5M16 8l-1.5 1.5m0 5L16 16M8 8l1.5 1.5' />
                <circle cx='12' cy='12' r='10' />
              </svg>
            </div>
            <div class='model-identity'>
              <div
                class='model-provider'
              >{{this.parsedModelInfo.provider}}</div>
              <h1 class='model-name'>{{this.parsedModelInfo.model}}</h1>
              {{#if this.parsedModelInfo.tagline}}
                <div
                  class='model-tagline'
                >{{this.parsedModelInfo.tagline}}</div>
              {{/if}}
            </div>
          </div>

          {{#if @model.modelId}}
            <div class='model-id-section'>
              <label class='id-label'>Model ID</label>
              <button
                type='button'
                class='model-id-display'
                {{on 'click' this.copyModelId}}
                title='Click to copy model ID'
              >
                <code class='model-id'>{{@model.modelId}}</code>
                <svg
                  class='copy-icon'
                  width='16'
                  height='16'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <rect width='14' height='14' x='8' y='8' rx='2' ry='2' />
                  <path
                    d='M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'
                  />
                </svg>
              </button>
            </div>
          {{/if}}

          {{#if @model.displayName}}
            <div class='display-name-section'>
              <label class='display-label'>Display Name</label>
              <div class='display-name'>{{@model.displayName}}</div>
            </div>
          {{/if}}

          {{#if @model.modelName}}
            <div class='model-name-section'>
              <label class='model-name-label'>Model Name</label>
              <div class='model-name-value'>{{@model.modelName}}</div>
            </div>
          {{/if}}
        </div>

        <div class='status-panel'>
          <div class='info-indicator'>
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <path d='m12 16-4-4 4-4M16 12H8' />
            </svg>
          </div>
        </div>
      </div>

      <div class='model-info-section'>
        <h2 class='section-title'>
          <svg
            width='20'
            height='20'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <circle cx='12' cy='12' r='3' />
            <path d='m8 16 1.5-1.5M16 8l-1.5 1.5m0 5L16 16M8 8l1.5 1.5' />
            <circle cx='12' cy='12' r='10' />
          </svg>
          Model Information
        </h2>
        <div class='info-grid'>
          {{#if @model.title}}
            <div class='info-item'>
              <div class='info-label'>Title</div>
              <div class='info-value'>{{@model.title}}</div>
            </div>
          {{/if}}

          {{#if @model.modelId}}
            <div class='info-item'>
              <div class='info-label'>Model Identifier</div>
              <div class='info-value code'>{{@model.modelId}}</div>
            </div>
          {{/if}}

          {{#if @model.modelName}}
            <div class='info-item'>
              <div class='info-label'>Model Name</div>
              <div class='info-value'>{{@model.modelName}}</div>
            </div>
          {{/if}}

          {{#if @model.displayName}}
            <div class='info-item'>
              <div class='info-label'>Display Name</div>
              <div class='info-value'>{{@model.displayName}}</div>
            </div>
          {{/if}}

          <div class='info-item'>
            <div class='info-label'>Provider</div>
            <div class='info-value'>{{this.parsedModelInfo.provider}}</div>
          </div>
        </div>
      </div>

    </div>

    <style scoped>
      .model-showcase {
        min-height: 100vh;
        background: oklch(1 0 0);
        font-family: 'Inter', system-ui, sans-serif;
        color: oklch(0.15 0 0);
        padding: 2rem;
        display: flex;
        flex-direction: column;
        gap: 2rem;
        max-width: 1000px;
        margin: 0 auto;
      }

      .hero-section {
        background: linear-gradient(
          135deg,
          oklch(0.98 0.01 250) 0%,
          oklch(0.99 0.005 220) 100%
        );
        border: 1px solid oklch(0.88 0.008 250);
        border-radius: 1rem;
        padding: 2rem;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 2rem;
        position: relative;
        overflow: hidden;
      }

      .hero-section::before {
        content: '';
        position: absolute;
        top: -50%;
        right: -50%;
        width: 100%;
        height: 100%;
        background: radial-gradient(
          circle,
          oklch(0.55 0.18 250 / 0.08) 0%,
          transparent 70%
        );
        pointer-events: none;
      }

      .hero-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        position: relative;
        z-index: 1;
      }

      .model-header {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
      }

      .model-icon {
        width: 4rem;
        height: 4rem;
        background: linear-gradient(
          135deg,
          oklch(0.55 0.18 250),
          oklch(0.45 0.15 260)
        );
        border-radius: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        flex-shrink: 0;
        box-shadow: 0 8px 25px oklch(0.55 0.18 250 / 0.25);
      }

      .model-identity {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .model-provider {
        font-size: 0.875rem;
        font-weight: 700;
        color: oklch(0.45 0.08 250);
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }

      .model-name {
        font-size: 2.5rem;
        font-weight: 800;
        color: oklch(0.15 0 0);
        margin: 0;
        line-height: 1;
        letter-spacing: -0.025em;
      }

      .model-tagline {
        font-size: 1.125rem;
        color: oklch(0.35 0.02 220);
        font-weight: 500;
        margin-top: 0.5rem;
      }

      .model-id-section,
      .display-name-section,
      .model-name-section {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .id-label,
      .display-label,
      .model-name-label {
        font-size: 0.75rem;
        font-weight: 700;
        color: oklch(0.45 0.02 220);
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }

      .model-id-display {
        background: oklch(0.94 0.005 220);
        border: 1px solid oklch(0.88 0.008 220);
        border-radius: 0.5rem;
        padding: 0.75rem 1rem;
        transition: all 0.15s ease;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: fit-content;
      }

      .model-id-display:hover {
        background: oklch(0.9 0.008 220);
        border-color: oklch(0.8 0.01 220);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px oklch(0 0 0 / 0.1);
      }

      .model-id {
        font-family: 'Fira Code', 'SF Mono', monospace;
        font-size: 0.875rem;
        color: oklch(0.25 0.02 220);
        letter-spacing: 0.025em;
        background: none;
        border: none;
      }

      .copy-icon {
        color: oklch(0.55 0.02 220);
        opacity: 0.7;
        transition: opacity 0.15s ease;
      }

      .model-id-display:hover .copy-icon {
        opacity: 1;
      }

      .display-name,
      .model-name-value {
        font-size: 1rem;
        color: oklch(0.25 0.02 220);
        font-weight: 600;
        padding: 0.75rem 1rem;
        background: oklch(0.96 0.002 220);
        border-radius: 0.5rem;
        border: 1px solid oklch(0.88 0.008 220);
      }

      .status-panel {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        align-items: flex-end;
        position: relative;
        z-index: 1;
      }

      .info-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        background: oklch(0.92 0.005 220);
        border: 1px solid oklch(0.85 0.008 220);
        border-radius: 50%;
        color: oklch(0.55 0.02 220);
        transition: all 0.15s ease;
      }

      .info-indicator:hover {
        background: oklch(0.88 0.008 220);
        color: oklch(0.45 0.02 220);
      }

      .model-info-section,
      .actions-section {
        background: oklch(0.995 0.002 230);
        border: 1px solid oklch(0.88 0.008 230);
        border-radius: 0.75rem;
        padding: 1.5rem;
      }

      .section-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: oklch(0.15 0 0);
        margin: 0 0 1rem 0;
        letter-spacing: -0.025em;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .section-title svg {
        color: oklch(0.55 0.18 250);
      }

      .info-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 1rem;
      }

      .info-item {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.75rem;
        background: oklch(1 0 0);
        border-radius: 0.375rem;
        border: 1px solid oklch(0.92 0.005 210);
      }

      .info-label {
        font-size: 0.75rem;
        font-weight: 700;
        color: oklch(0.45 0.02 210);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .info-value {
        font-size: 0.875rem;
        font-weight: 600;
        color: oklch(0.25 0.02 210);
      }

      .info-value.code {
        font-family: 'Fira Code', 'SF Mono', monospace;
        background: oklch(0.96 0.002 220);
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        letter-spacing: 0.025em;
        color: oklch(0.35 0.02 220);
      }

      .actions-grid {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .action-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1.25rem;
        border-radius: 0.5rem;
        font-size: 0.875rem;
        font-weight: 600;
        transition: all 0.15s ease;
        cursor: pointer;
        border: 2px solid;
        font-family: inherit;
      }

      .action-button.primary {
        background: oklch(0.55 0.18 250);
        border-color: oklch(0.55 0.18 250);
        color: white;
      }

      .action-button.primary:hover {
        background: oklch(0.5 0.18 250);
        border-color: oklch(0.5 0.18 250);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px oklch(0.55 0.18 250 / 0.3);
      }

      .action-button.secondary {
        background: oklch(1 0 0);
        border-color: oklch(0.88 0.008 250);
        color: oklch(0.25 0.02 250);
      }

      .action-button.secondary:hover {
        background: oklch(0.96 0.005 250);
        border-color: oklch(0.8 0.01 250);
        transform: translateY(-2px);
        box-shadow: 0 2px 8px oklch(0 0 0 / 0.1);
      }

      @media (max-width: 768px) {
        .model-showcase {
          padding: 1rem;
          gap: 1.5rem;
        }

        .hero-section {
          flex-direction: column;
          gap: 1.5rem;
          padding: 1.5rem;
          text-align: center;
        }

        .model-header {
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 1rem;
        }

        .model-name {
          font-size: 2rem;
        }

        .status-panel {
          align-items: center;
          width: 100%;
        }

        .info-grid {
          grid-template-columns: 1fr;
        }

        .actions-grid {
          flex-direction: column;
          align-items: stretch;
        }

        .action-button {
          justify-content: center;
        }
      }
    </style>
  </template>
}

export class Model extends CardDef {
  static displayName = 'Model';
  static icon = BrainIcon;

  @field modelId = contains(StringField);
  @field modelName = contains(StringField);
  @field displayName = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: Model) {
      try {
        const modelName = this.modelName ?? this.displayName ?? 'Unnamed Model';
        return modelName;
      } catch (error) {
        console.error('Model: Error computing title', error);
        return 'Model';
      }
    },
  });

  // Custom Embedded Format - Modern Card Design with Theme Consistency
  static embedded = class Embedded extends Component<typeof this> {
    // Parse provider from title/modelId for display consistency
    get providerInfo() {
      const title = this.args.model?.title || '';
      const modelId = this.args.model?.modelId || '';

      // Extract provider from title patterns
      const providerPatterns = [
        {
          pattern:
            /^(OpenAI|Anthropic|Google|DeepSeek|Meta|X\\.AI|Nvidia)\\s+(.+)/i,
          extraction: true,
        },
      ];

      for (const { pattern, extraction } of providerPatterns) {
        const match = title.match(pattern);
        if (match && extraction) {
          return { provider: match[1], model: match[2] };
        }
      }

      // Fallback: Try to extract from modelId
      if (modelId.includes('/')) {
        const [provider, model] = modelId.split('/', 2);
        return {
          provider: provider.charAt(0).toUpperCase() + provider.slice(1),
          model: model || title,
        };
      }

      return { provider: null, model: title || 'Model' };
    }

    <template>
      <div class='model-card'>
        <div class='card-header'>
          <div class='model-icon'>
            <svg
              width='20'
              height='20'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='3' />
              <path d='m8 16 1.5-1.5M16 8l-1.5 1.5m0 5L16 16M8 8l1.5 1.5' />
              <circle cx='12' cy='12' r='10' />
            </svg>
          </div>
          <div class='model-content'>
            {{#if this.providerInfo.provider}}
              <div class='model-provider'>{{this.providerInfo.provider}}</div>
            {{/if}}
            <div class='model-name'>{{this.providerInfo.model}}</div>
            {{#if @model.modelId}}
              <div class='model-id'>{{@model.modelId}}</div>
            {{/if}}
            {{#if @model.displayName}}
              {{#unless (eq @model.displayName @model.title)}}
                <div class='model-tagline'>{{@model.displayName}}</div>
              {{/unless}}
            {{/if}}
          </div>
          <div class='model-status'>
            <div class='info-indicator'>
              <svg
                width='12'
                height='12'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <path d='m12 16-4-4 4-4M16 12H8' />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .model-card {
          background: linear-gradient(
            135deg,
            oklch(0.99 0.002 230),
            oklch(1 0 0)
          );
          border: 1px solid oklch(0.88 0.008 230);
          border-radius: 0.5rem;
          padding: 1rem;
          transition: all 0.15s ease;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
          font-family: 'Inter', system-ui, sans-serif;
          position: relative;
          overflow: hidden;
        }

        .model-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(
            90deg,
            oklch(0.55 0.18 250),
            oklch(0.45 0.15 260)
          );
          opacity: 0.8;
        }

        .model-card:hover {
          border-color: oklch(0.8 0.008 230);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
          transform: translateY(-1px);
        }

        .card-header {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
        }

        .model-icon {
          width: 2.5rem;
          height: 2.5rem;
          background: linear-gradient(
            135deg,
            oklch(0.55 0.18 250),
            oklch(0.45 0.15 260)
          );
          border-radius: 0.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          flex-shrink: 0;
          box-shadow: 0 2px 8px oklch(0.55 0.18 250 / 0.25);
        }

        .model-content {
          flex: 1;
          min-width: 0;
        }

        .model-provider {
          font-size: 0.6875rem;
          font-weight: 700;
          color: oklch(0.45 0.08 250);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.125rem;
        }

        .model-name {
          font-weight: 700;
          font-size: 0.875rem;
          color: oklch(0.15 0 0);
          line-height: 1.3;
          margin-bottom: 0.25rem;
        }

        .model-id {
          font-size: 0.75rem;
          color: oklch(0.45 0.02 220);
          font-family: 'Fira Code', 'SF Mono', monospace;
          background: oklch(0.94 0.005 220);
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          display: inline-block;
          letter-spacing: 0.025em;
          margin-bottom: 0.25rem;
        }

        .model-tagline {
          font-size: 0.75rem;
          color: oklch(0.35 0.02 220);
          font-weight: 500;
          line-height: 1.3;
        }

        .model-status {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
        }

        .info-indicator {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 1.5rem;
          height: 1.5rem;
          background: oklch(0.94 0.005 220);
          border: 1px solid oklch(0.88 0.008 220);
          border-radius: 50%;
          color: oklch(0.55 0.02 220);
          transition: all 0.15s ease;
        }

        .info-indicator:hover {
          background: oklch(0.9 0.008 220);
          color: oklch(0.45 0.02 220);
          transform: scale(1.1);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get fittedDisplayInfo() {
      const title = this.args.model?.title || '';
      const modelId = this.args.model?.modelId || '';

      // Extract provider from title patterns
      const providerPatterns = [
        {
          pattern:
            /^(OpenAI|Anthropic|Google|DeepSeek|Meta|X\\.AI|Nvidia)\\s+(.+)/i,
          extraction: true,
        },
      ];

      for (const { pattern, extraction } of providerPatterns) {
        const match = title.match(pattern);
        if (match && extraction) {
          return {
            provider: match[1],
            model: match[2],
            compactProvider: match[1].substring(0, 2).toUpperCase(), // First 2 letters
          };
        }
      }

      // Fallback: Try to extract from modelId
      if (modelId.includes('/')) {
        const [provider, model] = modelId.split('/', 2);
        const cleanProvider =
          provider.charAt(0).toUpperCase() + provider.slice(1);
        return {
          provider: cleanProvider,
          model: model || title,
          compactProvider: cleanProvider.substring(0, 2).toUpperCase(),
        };
      }

      return {
        provider: null,
        model: title || 'Model',
        compactProvider: 'AI',
      };
    }

    <template>
      <div class='model-fitted'>
        <div class='fitted-container'>
          <div class='badge-format'>
            <div class='badge-content'>
              <div
                class='badge-provider'
              >{{this.fittedDisplayInfo.compactProvider}}</div>
              <div class='badge-name'>{{this.fittedDisplayInfo.model}}</div>
              <div class='badge-indicator'></div>
            </div>
          </div>

          <div class='strip-format'>
            <div class='strip-content'>
              <div class='strip-header'>
                <div class='strip-provider'>{{if
                    this.fittedDisplayInfo.provider
                    this.fittedDisplayInfo.provider
                    'AI Model'
                  }}</div>
                <div class='status-dot'></div>
              </div>
              <div class='strip-name'>{{this.fittedDisplayInfo.model}}</div>
              {{#if @model.modelId}}
                <div class='strip-id'>{{@model.modelId}}</div>
              {{/if}}
            </div>
          </div>

          <div class='tile-format'>
            <div class='tile-content'>
              <div class='tile-icon'>
                <svg
                  width='20'
                  height='20'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='12' cy='12' r='3' />
                  <path d='m8 16 1.5-1.5M16 8l-1.5 1.5m0 5L16 16M8 8l1.5 1.5' />
                  <circle cx='12' cy='12' r='10' />
                </svg>
              </div>
              <div class='tile-info'>
                {{#if this.fittedDisplayInfo.provider}}
                  <div
                    class='tile-provider'
                  >{{this.fittedDisplayInfo.provider}}</div>
                {{/if}}
                <div class='tile-name'>{{this.fittedDisplayInfo.model}}</div>
                {{#if @model.modelId}}
                  <div class='tile-id'>{{@model.modelId}}</div>
                {{/if}}
              </div>
              <div class='tile-status'>
                <div class='tile-indicator'></div>
              </div>
            </div>
          </div>

          <div class='card-format'>
            <div class='card-content'>
              <div class='card-header'>
                <div class='card-icon'>
                  <svg
                    width='24'
                    height='24'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <circle cx='12' cy='12' r='3' />
                    <path
                      d='m8 16 1.5-1.5M16 8l-1.5 1.5m0 5L16 16M8 8l1.5 1.5'
                    />
                    <circle cx='12' cy='12' r='10' />
                  </svg>
                </div>
                <div class='card-identity'>
                  {{#if this.fittedDisplayInfo.provider}}
                    <div
                      class='card-provider'
                    >{{this.fittedDisplayInfo.provider}}</div>
                  {{/if}}
                  <div class='card-name'>{{this.fittedDisplayInfo.model}}</div>
                  {{#if @model.displayName}}
                    {{#unless (eq @model.displayName @model.title)}}
                      <div class='card-tagline'>{{@model.displayName}}</div>
                    {{/unless}}
                  {{/if}}
                </div>
                <div class='card-status'>
                  <div class='card-indicator'></div>
                </div>
              </div>
              {{#if @model.modelId}}
                <div class='card-model-id'>
                  <div class='model-id-label'>Model ID</div>
                  <div class='model-id-value'>{{@model.modelId}}</div>
                </div>
              {{/if}}
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .model-fitted {
          width: 100%;
          height: 100%;
        }

        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          font-family: 'Inter', system-ui, sans-serif;
          padding: clamp(0.1875rem, 2%, 0.5rem);
        }

        /* Hide all formats by default */
        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          position: relative;
          overflow: hidden;
        }

        /* Badge Format (≤150px width, ≤169px height) */
        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
            align-items: center;
            justify-content: center;
          }
        }

        .badge-content {
          background: linear-gradient(
            135deg,
            oklch(0.55 0.18 250),
            oklch(0.45 0.15 260)
          );
          color: white;
          text-align: center;
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          position: relative;
          min-height: 40px;
          padding: 0.375rem;
          box-sizing: border-box;
        }

        .badge-provider {
          font-size: 0.5rem;
          font-weight: 700;
          opacity: 0.9;
          letter-spacing: 0.05em;
          line-height: 1;
          text-transform: uppercase;
          margin-bottom: 0.125rem;
        }

        .badge-name {
          font-size: 0.625rem;
          font-weight: 700;
          line-height: 1.1;
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }

        .badge-indicator {
          position: absolute;
          top: 0.25rem;
          right: 0.25rem;
          width: 0.375rem;
          height: 0.375rem;
          background: rgba(255, 255, 255, 0.9);
          border-radius: 50%;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }

        /* Strip Format (151px+ width, ≤169px height) */
        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
            align-items: center;
          }
        }

        .strip-content {
          background: linear-gradient(
            135deg,
            oklch(0.99 0.002 230),
            oklch(1 0 0)
          );
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
          padding: 0.5rem;
          box-sizing: border-box;
        }

        .strip-content::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(
            90deg,
            oklch(0.55 0.18 250),
            oklch(0.45 0.15 260)
          );
        }

        .strip-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .strip-provider {
          font-size: 0.5625rem;
          font-weight: 700;
          color: oklch(0.45 0.08 250);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .status-dot {
          width: 0.375rem;
          height: 0.375rem;
          background: oklch(0.55 0.15 160);
          border-radius: 50%;
          box-shadow: 0 0 4px oklch(0.55 0.15 160 / 0.5);
        }

        .strip-name {
          font-size: 0.6875rem;
          font-weight: 700;
          color: oklch(0.15 0 0);
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-id {
          font-size: 0.5rem;
          color: oklch(0.45 0.02 220);
          font-family: 'Fira Code', 'SF Mono', monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Tile Format (≤399px width, ≥170px height) */
        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            align-items: stretch;
          }
        }

        .tile-content {
          background: linear-gradient(
            135deg,
            oklch(0.99 0.002 230),
            oklch(1 0 0)
          );
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          position: relative;
        }

        .tile-content::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(
            90deg,
            oklch(0.55 0.18 250),
            oklch(0.45 0.15 260)
          );
          border-radius: 0.5rem 0.5rem 0 0;
        }

        .tile-icon {
          width: 2rem;
          height: 2rem;
          background: linear-gradient(
            135deg,
            oklch(0.55 0.18 250),
            oklch(0.45 0.15 260)
          );
          border-radius: 0.375rem;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          align-self: center;
          box-shadow: 0 2px 8px oklch(0.55 0.18 250 / 0.25);
        }

        .tile-info {
          flex: 1;
          text-align: center;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.25rem;
        }

        .tile-provider {
          font-size: 0.6875rem;
          font-weight: 700;
          color: oklch(0.45 0.08 250);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .tile-name {
          font-size: 0.875rem;
          font-weight: 700;
          color: oklch(0.15 0 0);
          line-height: 1.2;
          word-break: break-word;
        }

        .tile-id {
          font-size: 0.6875rem;
          color: oklch(0.45 0.02 220);
          font-family: 'Fira Code', 'SF Mono', monospace;
          background: oklch(0.94 0.005 220);
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
          align-self: center;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tile-status {
          align-self: center;
          margin-top: auto;
        }

        .tile-indicator {
          width: 0.5rem;
          height: 0.5rem;
          background: oklch(0.55 0.15 160);
          border-radius: 50%;
          box-shadow: 0 0 8px oklch(0.55 0.15 160 / 0.5);
        }

        /* Card Format (≥400px width, ≥170px height) */
        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            align-items: stretch;
          }
        }

        .card-content {
          background: linear-gradient(
            135deg,
            oklch(0.99 0.002 230),
            oklch(1 0 0)
          );
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          position: relative;
        }

        .card-header {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
        }

        .card-icon {
          width: 2.5rem;
          height: 2.5rem;
          background: linear-gradient(
            135deg,
            oklch(0.55 0.18 250),
            oklch(0.45 0.15 260)
          );
          border-radius: 0.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          flex-shrink: 0;
          box-shadow: 0 4px 12px oklch(0.55 0.18 250 / 0.25);
        }

        .card-identity {
          flex: 1;
          min-width: 0;
        }

        .card-provider {
          font-size: 0.75rem;
          font-weight: 700;
          color: oklch(0.45 0.08 250);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.125rem;
        }

        .card-name {
          font-size: 1rem;
          font-weight: 700;
          color: oklch(0.15 0 0);
          line-height: 1.2;
          margin-bottom: 0.25rem;
        }

        .card-tagline {
          font-size: 0.75rem;
          color: oklch(0.35 0.02 220);
          font-weight: 500;
          line-height: 1.3;
        }

        .card-status {
          display: flex;
          align-items: center;
        }

        .card-indicator {
          width: 0.625rem;
          height: 0.625rem;
          background: oklch(0.55 0.15 160);
          border-radius: 50%;
          box-shadow: 0 0 8px oklch(0.55 0.15 160 / 0.5);
        }

        .card-model-id {
          margin-top: auto;
          padding: 0.5rem;
          background: oklch(0.96 0.002 220);
          border-radius: 0.375rem;
          border: 1px solid oklch(0.92 0.005 220);
        }

        .model-id-label {
          font-size: 0.6875rem;
          font-weight: 700;
          color: oklch(0.45 0.02 220);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.25rem;
        }

        .model-id-value {
          font-size: 0.75rem;
          color: oklch(0.25 0.02 220);
          font-family: 'Fira Code', 'SF Mono', monospace;
          font-weight: 600;
          word-break: break-all;
        }
      </style>
    </template>
  };

  // Custom Isolated Format - Clean Model Display (Only Real Data)
  static isolated = Isolated;

  // Custom Atom Format - Consistent Design
  static atom = class Atom extends Component<typeof this> {
    // Parse provider for atom display
    get atomInfo() {
      const title = this.args.model?.title || '';
      const modelId = this.args.model?.modelId || '';

      // Extract provider from title patterns
      const providerPatterns = [
        {
          pattern:
            /^(OpenAI|Anthropic|Google|DeepSeek|Meta|X\\.AI|Nvidia)\\s+(.+)/i,
          extraction: true,
        },
      ];

      for (const { pattern, extraction } of providerPatterns) {
        const match = title.match(pattern);
        if (match && extraction) {
          return { provider: match[1], model: match[2] };
        }
      }

      // Fallback: Try to extract from modelId
      if (modelId.includes('/')) {
        const [provider, model] = modelId.split('/', 2);
        return {
          provider: provider.charAt(0).toUpperCase() + provider.slice(1),
          model: model || title,
        };
      }

      return { provider: null, model: title || 'Model' };
    }

    <template>
      <span class='model-atom'>
        <span class='atom-icon'>
          <svg
            width='12'
            height='12'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2.5'
          >
            <circle cx='12' cy='12' r='3' />
            <path d='m8 16 1.5-1.5M16 8l-1.5 1.5m0 5L16 16M8 8l1.5 1.5' />
            <circle cx='12' cy='12' r='10' />
          </svg>
        </span>
        <span class='atom-content'>
          {{#if this.atomInfo.provider}}
            <span class='atom-provider'>{{this.atomInfo.provider}}</span>
          {{/if}}
          <span class='atom-name'>{{this.atomInfo.model}}</span>
        </span>
        <span class='atom-indicator'></span>
      </span>

      <style scoped>
        .model-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 0.75rem;
          color: oklch(0.15 0 0);
          background: linear-gradient(
            135deg,
            oklch(0.98 0.002 230),
            oklch(1 0 0)
          );
          border: 1px solid oklch(0.88 0.008 230);
          border-radius: 0.375rem;
          padding: 0.25rem 0.5rem;
          transition: all 0.15s ease;
          position: relative;
          overflow: hidden;
        }

        .model-atom::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: linear-gradient(
            90deg,
            oklch(0.55 0.18 250),
            oklch(0.45 0.15 260)
          );
        }

        .model-atom:hover {
          border-color: oklch(0.8 0.008 230);
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }

        .atom-icon {
          width: 1rem;
          height: 1rem;
          background: linear-gradient(
            135deg,
            oklch(0.55 0.18 250),
            oklch(0.45 0.15 260)
          );
          border-radius: 0.125rem;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          flex-shrink: 0;
          box-shadow: 0 1px 3px oklch(0.55 0.18 250 / 0.3);
        }

        .atom-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
        }

        .atom-provider {
          font-size: 0.5625rem;
          font-weight: 700;
          color: oklch(0.45 0.08 250);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          line-height: 1;
        }

        .atom-name {
          font-weight: 600;
          color: oklch(0.15 0 0);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 8rem;
          line-height: 1.2;
        }

        .atom-indicator {
          width: 0.375rem;
          height: 0.375rem;
          background: oklch(0.55 0.15 160);
          border-radius: 50%;
          flex-shrink: 0;
          box-shadow: 0 0 4px oklch(0.55 0.15 160 / 0.5);
        }
      </style>
    </template>
  };
}

export default Model;
