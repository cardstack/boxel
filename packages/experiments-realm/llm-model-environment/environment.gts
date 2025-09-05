import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import {
  gt,
  eq,
  lt,
  add,
  subtract,
  or,
  and,
} from '@cardstack/boxel-ui/helpers';
import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Skill } from 'https://cardstack.com/base/skill';
import { includes, uniqBy } from 'lodash';

import SettingsIcon from '@cardstack/boxel-icons/settings';
import ZapIcon from '@cardstack/boxel-icons/zap';

import Model, { ModelSettingsField } from './model';

export class ShortcutSettingsField extends FieldDef {
  static displayName = 'Shortcut Settings';
  static icon = ZapIcon;

  @field name = contains(StringField);
  @field preferredModel = linksTo(() => Model);
  @field requiredSkills = linksToMany(() => Skill);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='shortcut-tile-card'>
        <div class='tile-header'>
          <div class='shortcut-name'>
            <code>/{{if @model.name @model.name 'untitled'}}</code>
          </div>
          {{#if (gt @model.requiredSkills.length 0)}}
            <div
              class='skills-count-badge'
            >{{@model.requiredSkills.length}}</div>
          {{/if}}
        </div>

        {{#if @model.preferredModel}}
          <div class='preferred-model'>
            <div class='model-connection'></div>
            <div class='model-info'>
              <div class='model-name'>{{@model.preferredModel.title}}</div>
              {{#if @model.preferredModel.modelId}}
                <div class='model-id'>{{@model.preferredModel.modelId}}</div>
              {{/if}}
            </div>
          </div>
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
            <span>No preferred model</span>
          </div>
        {{/if}}

        {{#if (gt @model.requiredSkills.length 0)}}
          <div class='skills-section'>
            <div class='skills-header'>
              <span class='skills-label'>Required Skills</span>
            </div>
            <div class='skills-list'>
              {{#each @model.requiredSkills as |skill index|}}
                {{#if (lt index 4)}}
                  <div
                    class='skill-tag
                      {{if
                        (includes skill.id "cardstack.com")
                        "base-skill"
                        "custom-skill"
                      }}'
                  >
                    {{if skill.title skill.title skill.id}}
                  </div>
                {{/if}}
              {{/each}}
              {{#if (gt @model.requiredSkills.length 4)}}
                <div class='skill-tag overflow'>+{{subtract
                    (Number @model.requiredSkills.length)
                    4
                  }}</div>
              {{/if}}
            </div>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .shortcut-tile-card {
          background: linear-gradient(
            135deg,
            oklch(0.99 0.002 280),
            oklch(1 0 0)
          );
          border: 1px solid oklch(0.88 0.008 280);
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

        .shortcut-tile-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(
            90deg,
            oklch(0.55 0.18 280),
            oklch(0.45 0.15 285)
          );
          border-radius: 0.5rem 0.5rem 0 0;
        }

        .shortcut-tile-card:hover {
          border-color: oklch(0.8 0.008 280);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
          transform: translateY(-1px);
        }

        .tile-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
        }

        .shortcut-name {
          flex: 1;
          min-width: 0;
        }

        .shortcut-name code {
          font-family: 'Fira Code', 'SF Mono', monospace;
          font-size: 0.875rem;
          font-weight: 700;
          color: oklch(0.35 0.15 280);
          background: oklch(0.96 0.03 280);
          padding: 0.375rem 0.5rem;
          border-radius: 0.375rem;
          border: 1px solid oklch(0.88 0.08 280);
          letter-spacing: 0.025em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: inline-block;
          max-width: 100%;
        }

        .skills-count-badge {
          background: linear-gradient(
            135deg,
            oklch(0.55 0.18 280),
            oklch(0.45 0.15 285)
          );
          color: white;
          font-size: 0.6875rem;
          font-weight: 700;
          padding: 0.25rem 0.5rem;
          border-radius: 0.5rem;
          line-height: 1;
          letter-spacing: 0.05em;
          box-shadow: 0 2px 4px oklch(0.55 0.18 280 / 0.25);
          flex-shrink: 0;
        }

        .preferred-model {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem;
          background: oklch(0.98 0.002 280);
          border-radius: 0.375rem;
          border: 1px solid oklch(0.92 0.005 280);
        }

        .model-connection {
          width: 1.5rem;
          height: 2px;
          background: linear-gradient(
            to right,
            oklch(0.55 0.18 280),
            oklch(0.45 0.02 220)
          );
          border-radius: 1px;
          flex-shrink: 0;
        }

        .model-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .model-name {
          font-size: 0.875rem;
          font-weight: 600;
          color: oklch(0.15 0 0);
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
          padding: 0.75rem;
          background: oklch(0.96 0.002 220);
          border: 1px dashed oklch(0.88 0.008 220);
          border-radius: 0.375rem;
          color: oklch(0.55 0.02 220);
          font-size: 0.875rem;
          font-style: italic;
        }

        .no-model-icon {
          color: oklch(0.65 0.02 220);
          flex-shrink: 0;
        }

        .skills-section {
          border-top: 1px solid oklch(0.92 0.005 280);
          padding-top: 0.75rem;
        }

        .skills-header {
          margin-bottom: 0.5rem;
        }

        .skills-label {
          font-size: 0.6875rem;
          font-weight: 600;
          color: oklch(0.45 0.02 280);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .skills-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
        }

        .skill-tag {
          font-size: 0.6875rem;
          font-weight: 600;
          padding: 0.25rem 0.5rem;
          border-radius: 0.375rem;
          line-height: 1;
          transition: all 0.15s ease;
        }

        .skill-tag.base-skill {
          background: oklch(0.45 0.02 220);
          color: white;
          box-shadow: 0 1px 2px oklch(0.45 0.02 220 / 0.2);
        }

        .skill-tag.custom-skill {
          background: oklch(0.55 0.18 250);
          color: white;
          box-shadow: 0 1px 2px oklch(0.55 0.18 250 / 0.2);
        }

        .skill-tag.overflow {
          background: oklch(0.88 0.008 280);
          color: oklch(0.45 0.02 280);
          font-weight: 700;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='shortcut-fitted'>
        <div class='fitted-container'>
          <div class='fitted-format'>
            <div class='fitted-name'>{{if
                @model.name
                @model.name
                'Shortcut'
              }}</div>
            {{#if @model.preferredModel}}
              <div class='fitted-model'>{{@model.preferredModel.title}}</div>
            {{/if}}
            {{#if (gt @model.requiredSkills.length 0)}}
              <div class='fitted-skills'>{{@model.requiredSkills.length}}
                skills</div>
            {{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        .shortcut-fitted {
          width: 100%;
          height: 100%;
        }

        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          padding: clamp(0.1875rem, 2%, 0.5rem);
          box-sizing: border-box;
        }

        .fitted-format {
          display: none;
          width: 100%;
          height: 100%;
          background: oklch(0.995 0.002 240);
          border-radius: 0.5rem;
          padding: 0.75rem;
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          position: relative;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }

        .fitted-name {
          font-size: 0.75rem;
          font-weight: 600;
          color: oklch(0.145 0 0);
          margin-bottom: 0.25rem;
          line-height: 1.2;
        }

        .fitted-model {
          font-size: 0.6875rem;
          color: oklch(0.45 0 0);
          line-height: 1.3;
        }

        .fitted-skills {
          position: absolute;
          top: 0.25rem;
          right: 0.25rem;
          font-size: 0.5rem;
          font-weight: 600;
          padding: 0.125rem 0.25rem;
          background: oklch(0.45 0.15 250);
          color: white;
          border-radius: 0.125rem;
          text-transform: uppercase;
        }

        @container (max-width: 150px) and (max-height: 169px) {
          .fitted-format {
            display: flex;
            flex-direction: column;
          }
        }

        @container (min-width: 151px) and (max-height: 169px) {
          .fitted-format {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 0.5rem;
          }
          .fitted-skills {
            position: static;
          }
        }

        @container (max-width: 399px) and (min-height: 170px) {
          .fitted-format {
            display: flex;
            flex-direction: column;
          }
        }

        @container (min-width: 400px) and (min-height: 170px) {
          .fitted-format {
            display: flex;
            flex-direction: column;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='shortcut-atom'>
        {{if @model.name @model.name 'Shortcut'}}
        {{#if (gt @model.requiredSkills.length 0)}}
          <span
            class='skills-badge
              {{if (eq @model.requiredSkills.length 1) "single" "multiple"}}'
          >
            <span class='badge-icon'>
              <svg
                width='8'
                height='8'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='3'
              >
                <polygon points='13,2 3,14 12,14 11,22 21,10 12,10'></polygon>
              </svg>
            </span>
            {{#if (gt @model.requiredSkills.length 1)}}
              <span class='badge-count'>{{@model.requiredSkills.length}}</span>
            {{/if}}
          </span>
        {{/if}}
      </span>

      <style scoped>
        .shortcut-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-family:
            -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
          font-size: 0.75rem;
          font-weight: 500;
          color: oklch(0.145 0 0);
        }

        .skills-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.1875rem;
          padding: 0.1875rem 0.3125rem;
          border-radius: 0.375rem;
          font-size: 0.5625rem;
          font-weight: 700;
          color: white;
          position: relative;
          overflow: hidden;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow:
            0 1px 2px rgba(0, 0, 0, 0.12),
            0 0 0 1px rgba(255, 255, 255, 0.1) inset;
        }

        .skills-badge.single {
          background: linear-gradient(
            135deg,
            oklch(0.55 0.28 260) 0%,
            oklch(0.45 0.22 250) 100%
          );
          padding: 0.25rem;
          border-radius: 50%;
          width: 1.125rem;
          height: 1.125rem;
          justify-content: center;
        }

        .skills-badge.multiple {
          background: linear-gradient(
            135deg,
            oklch(0.55 0.28 260) 0%,
            oklch(0.4 0.25 240) 50%,
            oklch(0.45 0.22 250) 100%
          );
          border-radius: 0.5rem;
        }

        .skills-badge::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.2) 0%,
            transparent 50%,
            rgba(0, 0, 0, 0.1) 100%
          );
          border-radius: inherit;
          pointer-events: none;
        }

        .badge-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          z-index: 1;
        }

        .badge-icon svg {
          filter: drop-shadow(0 0.5px 1px rgba(0, 0, 0, 0.3));
        }

        .badge-count {
          font-weight: 800;
          line-height: 1;
          letter-spacing: -0.01em;
          position: relative;
          z-index: 1;
          text-shadow: 0 0.5px 1px rgba(0, 0, 0, 0.3);
        }

        .skills-badge:hover {
          transform: translateY(-0.5px) scale(1.05);
          box-shadow:
            0 2px 4px rgba(0, 0, 0, 0.16),
            0 0 0 1px rgba(255, 255, 255, 0.15) inset;
        }

        .skills-badge.single:hover {
          background: linear-gradient(
            135deg,
            oklch(0.6 0.3 260) 0%,
            oklch(0.5 0.25 250) 100%
          );
        }

        .skills-badge.multiple:hover {
          background: linear-gradient(
            135deg,
            oklch(0.6 0.3 260) 0%,
            oklch(0.45 0.27 240) 50%,
            oklch(0.5 0.25 250) 100%
          );
        }

        @media (prefers-reduced-motion: reduce) {
          .skills-badge {
            transition: none;
          }

          .skills-badge:hover {
            transform: none;
          }
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='shortcut-edit'>
        <div class='name-input'>
          <div class='slash-input-wrapper'>
            <span class='slash-prefix'>/</span>
            <@fields.name />
          </div>
        </div>

        <div class='settings-row'>
          <div class='model-field'>
            <label class='field-label'>Preferred Model</label>
            <@fields.preferredModel />
          </div>

          <div class='skills-field'>
            <label class='field-label'>Required Skills</label>
            <@fields.requiredSkills />
          </div>
        </div>
      </div>

      <style scoped>
        .shortcut-edit {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
          max-width: 600px;
        }

        .slash-input-wrapper {
          display: flex;
          align-items: stretch;
          background: oklch(1 0 0);
          border: 1px solid oklch(0.88 0.01 220);
          border-radius: 0.375rem;
          overflow: hidden;
          transition: all 0.15s ease;
        }

        .slash-prefix {
          background: oklch(0.94 0.01 220);
          color: oklch(0.4 0.02 220);
          font-family: 'Fira Code', 'SF Mono', Consolas, monospace;
          font-size: 0.875rem;
          font-weight: 700;
          padding: 0.5rem 0.75rem;
          border-right: 1px solid oklch(0.88 0.01 220);
          display: flex;
          align-items: center;
          justify-content: center;
          user-select: none;
          min-width: 2.75rem;
          transition: all 0.15s ease;
        }

        .slash-input-wrapper :deep(.field-container) {
          background: transparent;
          border: none;
          border-radius: 0;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          flex: 1;
          line-height: 1.4;
        }

        .slash-input-wrapper:focus-within {
          border-color: oklch(0.55 0.18 250);
          box-shadow: 0 0 0 3px oklch(0.55 0.18 250 / 0.15);
        }

        .slash-input-wrapper:focus-within .slash-prefix {
          background: oklch(0.9 0.02 220);
          color: oklch(0.3 0.02 220);
          border-right-color: oklch(0.55 0.18 250 / 0.3);
        }

        .settings-row {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          align-items: stretch;
        }

        .model-field {
          width: 100%;
        }

        .skills-field {
          width: 100%;
        }

        .field-label {
          font-size: 0.6875rem;
          font-weight: 600;
          color: oklch(0.45 0.02 220);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.25rem;
          display: block;
        }

        .model-field :deep(.field-container),
        .skills-field :deep(.field-container) {
          background: oklch(0.98 0 0);
          border: 1px solid oklch(0.88 0.01 220);
          border-radius: 0.375rem;
          padding: 0.375rem;
          font-size: 0.8125rem;
        }

        .model-field :deep(.field-container):focus-within,
        .skills-field :deep(.field-container):focus-within,
        .name-input :deep(.field-container):focus-within {
          border-color: oklch(0.55 0.18 250);
          box-shadow: 0 0 0 3px oklch(0.55 0.18 250 / 0.1);
        }

        /* Responsive adjustments */
        @media (max-width: 500px) {
          .settings-row {
            flex-direction: column;
            gap: 0.75rem;
            align-items: stretch;
          }
        }
      </style>
    </template>
  };
}

class Fitted extends Component<typeof Environment> {
  @tracked showAllModels = false;

  @action
  toggleModelsView() {
    this.showAllModels = !this.showAllModels;
  }

  get sortedShortcuts() {
    const shortcuts = this.args?.model?.shortcutsList || [];
    return [...shortcuts].sort((a, b) => {
      const nameA = a.name || '';
      const nameB = b.name || '';
      return nameA.localeCompare(nameB);
    });
  }

  get sortedModels() {
    const models = this.args?.model?.modelsList || [];
    return [...models].sort((a, b) => {
      const titleA = a.model?.displayName || '';
      const titleB = b.model?.displayName || '';
      return titleA.localeCompare(titleB);
    });
  }

  get sortedModelSettings() {
    const settings = this.args?.model?.modelsList || [];
    return [...settings].sort((a, b) => {
      const titleA = a.model?.title || '';
      const titleB = b.model?.title || '';
      return titleA.localeCompare(titleB);
    });
  }

  <template>
    <div class='env-fitted'>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='badge-panel-header'>
            <div class='badge-header-main'>
              <div class='badge-env-title'>{{@model.title}}</div>
            </div>
            <div class='badge-header-stats'>
              <div
                class='badge-stat-number'
              >{{@model.stats.shortcuts.total}}</div>
              <div class='badge-stat-label'>shortcuts</div>
            </div>
          </div>
        </div>

        <div class='strip-format'>
          <div class='strip-panel-header'>
            <div class='strip-header-main'>
              <div class='strip-env-title'>{{@model.title}}</div>
              {{#if @model.parent}}
                <div class='strip-env-subtitle'>
                  <span class='strip-inherits-label'>Inherits from parent</span>
                </div>
              {{/if}}
            </div>
            <div class='strip-header-stats'>
              <div class='strip-stat-badge shortcuts'>
                <span
                  class='strip-stat-number'
                >{{@model.stats.shortcuts.total}}</span>
                <span class='strip-stat-label'>shortcuts</span>
              </div>
              <div class='strip-stat-badge models'>
                <span
                  class='strip-stat-number'
                >{{@model.stats.models.total}}</span>
                <span class='strip-stat-label'>models</span>
              </div>
            </div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='tile-panel-header'>
            <div class='tile-header-main'>
              <div class='tile-env-title'>{{@model.title}}</div>
              {{#if @model.parent}}
                <div class='tile-env-subtitle'>
                  <span class='tile-inherits-label'>Inherits from</span>
                  <@fields.parent @format='atom' />
                </div>
              {{/if}}
            </div>
            <div class='tile-header-stats'>
              <div class='tile-stat-badge shortcuts'>
                <div class='tile-stat-row'>
                  <span
                    class='tile-stat-number'
                  >{{@model.stats.shortcuts.total}}</span>
                  <span class='tile-stat-label'>shortcuts</span>
                </div>
                <div class='tile-stat-delta'>
                  {{#if (gt @model.stats.shortcuts.added 0)}}
                    <span
                      class='tile-delta-item added'
                    >+{{@model.stats.shortcuts.added}}</span>
                  {{/if}}
                  {{#if (gt @model.stats.shortcuts.modified 0)}}
                    <span
                      class='tile-delta-item modified'
                    >Δ{{@model.stats.shortcuts.modified}}</span>
                  {{/if}}
                </div>
              </div>
              <div class='tile-stat-badge models'>
                <div class='tile-stat-row'>
                  <span
                    class='tile-stat-number'
                  >{{@model.stats.models.total}}</span>
                  <span class='tile-stat-label'>models</span>
                </div>
                <div class='tile-stat-delta'>
                  {{#if (gt @model.stats.models.added 0)}}
                    <span
                      class='tile-delta-item added'
                    >+{{@model.stats.models.added}}</span>
                  {{/if}}
                  {{#if (gt @model.stats.models.modified 0)}}
                    <span
                      class='tile-delta-item modified'
                    >Δ{{@model.stats.models.modified}}</span>
                  {{/if}}
                  {{#if (gt @model.stats.models.disabled 0)}}
                    <span
                      class='tile-delta-item disabled'
                    >⊘{{@model.stats.models.disabled}}</span>
                  {{/if}}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class='card-format'>
          <div class='card-panel-header'>
            <div class='card-header-main'>
              <div class='card-env-title'>{{@model.title}}</div>
              {{#if @model.parent}}
                <div class='card-env-subtitle'>
                  <span class='card-inherits-label'>Inherits from</span>
                  <@fields.parent @format='atom' />
                </div>
                <div class='card-inheritance-explanation'>
                  <span class='card-inheritance-help'>Local settings override
                    parent environment</span>
                </div>
              {{/if}}
            </div>
            <div class='card-header-stats'>
              <div class='card-stat-badge shortcuts'>
                <div class='card-stat-row'>
                  <span
                    class='card-stat-number'
                  >{{@model.stats.shortcuts.total}}</span>
                  <span class='card-stat-label'>shortcuts</span>
                </div>
                <div class='card-stat-delta'>
                  {{#if (gt @model.stats.shortcuts.added 0)}}
                    <span
                      class='card-delta-item added'
                    >+{{@model.stats.shortcuts.added}}</span>
                  {{/if}}
                  {{#if (gt @model.stats.shortcuts.modified 0)}}
                    <span
                      class='card-delta-item modified'
                    >Δ{{@model.stats.shortcuts.modified}}</span>
                  {{/if}}
                  {{#if (gt @model.stats.shortcuts.disabled 0)}}
                    <span
                      class='card-delta-item disabled'
                    >⊘{{@model.stats.shortcuts.disabled}}</span>
                  {{/if}}
                </div>
              </div>
              <div class='card-stat-badge models'>
                <div class='card-stat-row'>
                  <span
                    class='card-stat-number'
                  >{{@model.stats.models.total}}</span>
                  <span class='card-stat-label'>models</span>
                </div>
                <div class='card-stat-delta'>
                  {{#if (gt @model.stats.models.added 0)}}
                    <span
                      class='card-delta-item added'
                    >+{{@model.stats.models.added}}</span>
                  {{/if}}
                  {{#if (gt @model.stats.models.modified 0)}}
                    <span
                      class='card-delta-item modified'
                    >Δ{{@model.stats.models.modified}}</span>
                  {{/if}}
                  {{#if (gt @model.stats.models.disabled 0)}}
                    <span
                      class='card-delta-item disabled'
                    >⊘{{@model.stats.models.disabled}}</span>
                  {{/if}}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .env-fitted {
        width: 100%;
        height: 100%;
      }

      .fitted-container {
        container-type: size;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        font-family: 'Inter', system-ui, sans-serif;
      }

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

      @container (max-width: 150px) and (max-height: 169px) {
        .badge-format {
          display: flex;
          align-items: center;
          justify-content: center;
        }
      }

      .badge-panel-header {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.5rem;
        background: oklch(0.98 0.002 210);

        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: center;
        text-align: center;
      }

      .badge-header-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        justify-content: center;
        align-items: center;
      }

      .badge-env-title {
        font-size: 0.75rem;
        font-weight: 700;
        color: oklch(0.15 0 0);
        line-height: 1.1;
        text-align: center;
        word-break: break-word;
      }

      .badge-header-stats {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.0625rem;
      }

      .badge-stat-number {
        font-family: 'Fira Code', monospace;
        font-size: 1rem;
        font-weight: 700;
        color: oklch(0.55 0.18 250);
        line-height: 1;
      }

      .badge-stat-label {
        font-size: 0.5625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: oklch(0.45 0.02 210);
      }

      /* Strip Format (151px+ width, ≤169px height) */
      @container (min-width: 151px) and (max-height: 169px) {
        .strip-format {
          display: flex;
          align-items: stretch;
        }
      }

      .strip-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.75rem;
        background: oklch(0.98 0.002 210);
        width: 100%;
        height: 100%;
      }

      .strip-header-main {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        flex: 1;
        min-width: 0;
      }

      .strip-env-title {
        font-size: 0.875rem;
        font-weight: 700;
        color: oklch(0.15 0 0);
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .strip-env-subtitle {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.6875rem;
        font-weight: 500;
      }

      .strip-inherits-label {
        color: oklch(0.45 0.02 210);
        white-space: nowrap;
      }

      .strip-header-stats {
        display: flex;
        gap: 0.375rem;
        flex-shrink: 0;
      }

      .strip-stat-badge {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        padding: 0.25rem 0.375rem;
        background: oklch(0.92 0.005 210);
        border-radius: 0.125rem;
        min-width: 2.5rem;
        align-items: center;
      }

      .strip-stat-number {
        font-family: 'Fira Code', monospace;
        font-size: 0.875rem;
        font-weight: 700;
        color: oklch(0.55 0.18 250);
        line-height: 1;
      }

      .strip-stat-label {
        font-size: 0.5rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: oklch(0.45 0.02 210);
      }

      /* Tile Format (≤399px width, ≥170px height) */
      @container (max-width: 399px) and (min-height: 170px) {
        .tile-format {
          display: flex;
          align-items: stretch;
        }
      }

      .tile-panel-header {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 1rem;
        background: oklch(0.98 0.002 210);
        width: 100%;
        height: 100%;
      }

      .tile-header-main {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        flex: 1;
      }

      .tile-env-title {
        font-size: 1rem;
        font-weight: 700;
        color: oklch(0.15 0 0);
        line-height: 1.2;
      }

      .tile-env-subtitle {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.75rem;
        font-weight: 500;
        flex-wrap: wrap;
      }

      .tile-inherits-label {
        color: oklch(0.45 0.02 210);
      }

      .tile-header-stats {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .tile-stat-badge {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.5rem;
        background: oklch(0.92 0.005 210);
        border-radius: 0.125rem;
      }

      .tile-stat-row {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        justify-content: space-between;
      }

      .tile-stat-number {
        font-family: 'Fira Code', monospace;
        font-size: 1rem;
        font-weight: 700;
        color: oklch(0.55 0.18 250);
        line-height: 1;
      }

      .tile-stat-label {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: oklch(0.45 0.02 210);
      }

      .tile-stat-delta {
        display: flex;
        gap: 0.1875rem;
        justify-content: flex-end;
        flex-wrap: wrap;
      }

      .tile-delta-item {
        font-family: 'Fira Code', monospace;
        font-size: 0.5625rem;
        font-weight: 700;
        padding: 0.0625rem 0.25rem;
        border-radius: 0.1875rem;
        line-height: 1;
      }

      .tile-delta-item.added {
        background: #22c55e;
        color: white;
      }

      .tile-delta-item.modified {
        background: #f59e0b;
        color: white;
      }

      .tile-delta-item.disabled {
        background: #ef4444;
        color: white;
      }

      /* Card Format (≥400px width, ≥170px height) */
      @container (min-width: 400px) and (min-height: 170px) {
        .card-format {
          display: flex;
          align-items: stretch;
        }
      }

      .card-panel-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        padding: 1.5rem;
        background: oklch(0.98 0.002 210);
        width: 100%;
        height: 100%;
      }

      .card-header-main {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        flex: 1;
        min-width: 0;
      }

      .card-env-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: oklch(0.15 0 0);
        letter-spacing: -0.025em;
        line-height: 1.2;
      }

      .card-env-subtitle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        font-weight: 500;
        flex-wrap: wrap;
      }

      .card-inherits-label {
        color: oklch(0.45 0.02 210);
      }

      .card-inheritance-explanation {
        margin-top: 0.25rem;
      }

      .card-inheritance-help {
        font-size: 0.75rem;
        color: oklch(0.55 0.02 210);
        line-height: 1.4;
        font-style: italic;
      }

      .card-header-stats {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        min-width: 10rem;
      }

      .card-stat-badge {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding: 0.75rem 1rem;
        background: oklch(0.92 0.005 210);
        border-radius: 0.125rem;
        width: 100%;
      }

      .card-stat-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        justify-content: space-between;
      }

      .card-stat-number {
        font-family: 'Fira Code', monospace;
        font-size: 1.25rem;
        font-weight: 700;
        color: oklch(0.55 0.18 250);
        line-height: 1;
      }

      .card-stat-label {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: oklch(0.45 0.02 210);
      }

      .card-stat-delta {
        display: flex;
        gap: 0.25rem;
        justify-content: flex-end;
        flex-wrap: wrap;
      }

      .card-delta-item {
        font-family: 'Fira Code', monospace;
        font-size: 0.6875rem;
        font-weight: 700;
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
        line-height: 1;
      }

      .card-delta-item.added {
        background: #22c55e;
        color: white;
        box-shadow: 0 1px 2px rgba(34, 197, 94, 0.3);
      }

      .card-delta-item.modified {
        background: #f59e0b;
        color: white;
        box-shadow: 0 1px 2px rgba(245, 158, 11, 0.3);
      }

      .card-delta-item.disabled {
        background: #ef4444;
        color: white;
        box-shadow: 0 1px 2px rgba(239, 68, 68, 0.3);
      }
    </style>
  </template>
}

class Isolated extends Component<typeof Environment> {
  @tracked showDisabledModels = false;

  @action
  toggleDisabledModels() {
    this.showDisabledModels = !this.showDisabledModels;
  }

  @action
  viewSkill(skill: Skill) {
    this.args.viewCard?.(skill, 'isolated');
  }

  get allShortcutsWithStatus() {
    const finalShortcuts = this.args.model?.shortcutsList ?? [];
    const localShortcuts = this.args.model?.shortcutSettings ?? [];
    const parentShortcuts = this.args.model?.parent?.shortcutsList ?? [];

    const parentShortcutMap = new Map(parentShortcuts.map((s) => [s.name, s]));
    const localShortcutMap = new Map(localShortcuts.map((s) => [s.name, s]));

    return finalShortcuts
      .map((shortcut) => {
        if (!shortcut.name) {
          return null;
        }
        const isLocal = localShortcutMap.has(shortcut.name);
        const isInherited = parentShortcutMap.has(shortcut.name);

        let isOverride = false;
        let isAddition = false;

        if (isLocal) {
          if (isInherited) {
            isOverride = true;
          } else {
            isAddition = true;
          }
        }

        return {
          shortcut: shortcut,
          isLocal: isLocal,
          isOverride: isOverride,
          isAddition: isAddition,
          isDisabled: false,
        };
      })
      .filter(Boolean)
      .sort((a, b) =>
        (a?.shortcut?.name || '').localeCompare(b?.shortcut?.name || ''),
      );
  }

  getModelSortKey(modelTitle: string) {
    if (!modelTitle) return '';

    const prefixes = ['OpenAI ', 'Anthropic ', 'Google ', 'DeepSeek ', 'Meta '];

    for (const prefix of prefixes) {
      if (modelTitle.startsWith(prefix)) {
        return modelTitle.substring(prefix.length);
      }
    }

    return modelTitle;
  }

  get allModelsWithStatus() {
    const finalSettings = this.args.model?.modelsList ?? [];
    const localSettings = this.args.model?.modelSettings ?? [];
    const parentSettings = this.args.model?.parent?.modelsList ?? [];

    const parentModelMap = new Map(parentSettings.map((s) => [s.model?.id, s]));
    const localModelMap = new Map(localSettings.map((s) => [s.model?.id, s]));

    return finalSettings
      .map((setting) => {
        if (!setting.model?.id) {
          return null;
        }
        const modelId = setting.model.id;
        const isLocal = localModelMap.has(modelId);
        const isInherited = parentModelMap.has(modelId);

        let isOverride = false;
        let isAddition = false;

        if (isLocal) {
          if (isInherited) {
            isOverride = true;
          } else {
            isAddition = true;
          }
        }

        return {
          model: setting.model,
          settings: setting,
          isLocal: isLocal,
          isOverride: isOverride,
          isAddition: isAddition,
          isDisabled: setting.isDisabled,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const nameA = a?.model?.title || '';
        const nameB = b?.model?.title || '';
        return nameA.localeCompare(nameB);
      });
  }

  get allDisabledModelsWithStatus() {
    const finalSettings = this.args.model?.modelsList ?? [];
    const localSettings = this.args.model?.modelSettings ?? [];
    const parentSettings = this.args.model?.parent?.modelsList ?? [];

    const parentModelMap = new Map(parentSettings.map((s) => [s.model?.id, s]));
    const localModelMap = new Map(localSettings.map((s) => [s.model?.id, s]));

    return finalSettings
      .map((setting) => {
        if (!setting.model?.id || !setting.isDisabled) {
          return null;
        }
        const modelId = setting.model.id;
        const isLocal = localModelMap.has(modelId);
        const isInherited = parentModelMap.has(modelId);
        const parentSetting = parentModelMap.get(modelId);

        const isDisabledUpstream = parentSetting?.isDisabled || false;
        const isDisabledLocally = isLocal && setting.isDisabled;

        let isOverride = false;
        let isAddition = false;

        if (isLocal) {
          if (isInherited) {
            isOverride = true;
          } else {
            isAddition = true;
          }
        }

        return {
          model: setting.model,
          settings: setting,
          isLocal: isLocal,
          isOverride: isOverride,
          isAddition: isAddition,
          isDisabled: setting.isDisabled,
          isDisabledUpstream: isDisabledUpstream,
          isDisabledLocally: isDisabledLocally,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const nameA = a?.model?.title || '';
        const nameB = b?.model?.title || '';
        return nameA.localeCompare(nameB);
      });
  }

  <template>
    <div class='shortcuts-panel'>
      <div class='panel-header'>
        <div class='header-main'>
          <div class='env-title'>{{@model.title}}</div>
          {{#if @model.parent}}
            <div class='env-subtitle'>
              <span class='inherits-label'>Inherits from</span>
              <@fields.parent @format='atom' />
            </div>
            <div class='inheritance-explanation'>
              <span class='inheritance-help'>Local settings override parent
                environment. Statistics show combined totals from inheritance
                chain.</span>
            </div>
          {{/if}}
        </div>
        <div class='header-stats'>
          <div class='stat-badge shortcuts'>
            <div class='stat-row'>
              <span class='stat-number'>{{@model.stats.shortcuts.total}}</span>
              <span class='stat-label'>shortcuts</span>
            </div>
            <div class='stat-delta'>
              {{#if (gt @model.stats.shortcuts.added 0)}}
                <span
                  class='delta-item added'
                >+{{@model.stats.shortcuts.added}}</span>
              {{/if}}
              {{#if (gt @model.stats.shortcuts.modified 0)}}
                <span
                  class='delta-item modified'
                >Δ{{@model.stats.shortcuts.modified}}</span>
              {{/if}}
              {{#if (gt @model.stats.shortcuts.disabled 0)}}
                <span
                  class='delta-item disabled'
                >⊘{{@model.stats.shortcuts.disabled}}</span>
              {{/if}}
            </div>
          </div>

          <div class='stat-badge models'>
            <div class='stat-row'>
              <span class='stat-number'>{{@model.stats.models.total}}</span>
              <span class='stat-label'>models</span>
            </div>
            <div class='stat-delta'>
              {{#if (gt @model.stats.models.added 0)}}
                <span
                  class='delta-item added'
                >+{{@model.stats.models.added}}</span>
              {{/if}}
              {{#if (gt @model.stats.models.modified 0)}}
                <span
                  class='delta-item modified'
                >Δ{{@model.stats.models.modified}}</span>
              {{/if}}
              {{#if (gt @model.stats.models.disabled 0)}}
                <span
                  class='delta-item disabled'
                >⊘{{@model.stats.models.disabled}}</span>
              {{/if}}
            </div>
          </div>
        </div>
      </div>

      <div class='shortcuts-section'>
        <div class='section-header'>
          <div class='section-title-area'>
            <h2 class='section-title'>AI Shortcuts</h2>
            <div class='section-help'>Start any message with /code in AI
              Assistant to automatically choose the preferred model and activate
              associated skills</div>
          </div>
          <div class='legend'>
            <div class='legend-item'>
              <div class='legend-indicator local'></div>
              <span>Added</span>
            </div>
            <div class='legend-item'>
              <div class='legend-indicator modified'></div>
              <span>Override</span>
            </div>
            <div class='legend-item'>
              <div class='legend-indicator disabled'></div>
              <span>Disabled</span>
            </div>
          </div>
        </div>

        {{#if (gt this.allShortcutsWithStatus.length 0)}}
          <div class='shortcuts-grid'>
            {{#each this.allShortcutsWithStatus as |item|}}
              <div
                class='shortcut-card
                  {{if item.isAddition "local-addition"}}
                  {{if item.isOverride "local-modification"}}'
              >
                <div class='card-content'>
                  <div class='shortcut-header'>
                    <div class='shortcut-name'>
                      <code>/{{item.shortcut.name}}</code>
                    </div>
                    <div class='status-indicators'>
                      {{#if item.isAddition}}
                        <div class='status-badge local'>Added</div>
                      {{else if item.isOverride}}
                        <div class='status-badge modified'>Override</div>
                      {{/if}}
                    </div>
                  </div>

                  {{#if item.shortcut.preferredModel}}
                    <div class='preferred-model'>
                      <div class='model-connection'></div>
                      <div class='model-info'>
                        <div
                          class='model-name'
                        >{{item.shortcut.preferredModel.title}}</div>
                        {{#if item.shortcut.preferredModel.modelId}}
                          <div
                            class='model-id'
                          >{{item.shortcut.preferredModel.modelId}}</div>
                        {{/if}}
                      </div>
                    </div>
                  {{else}}
                    <div class='no-model'>No preferred model set</div>
                  {{/if}}

                  {{#if (gt item.shortcut.requiredSkills.length 0)}}
                    <div class='skills-section'>
                      <div class='skills-header'>
                        <span class='skills-label'>Required Skills</span>
                        <div
                          class='skills-count'
                        >{{item.shortcut.requiredSkills.length}}</div>
                      </div>
                      <div class='skills-list'>
                        {{#each item.shortcut.requiredSkills as |skill|}}
                          <button
                            type='button'
                            class='skill-tag clickable
                              {{if
                                (includes skill.id "cardstack.com")
                                "base-skill"
                                "custom-skill"
                              }}'
                            {{on 'click' (fn this.viewSkill skill)}}
                          >{{if skill.title skill.title skill.id}}</button>
                        {{/each}}
                      </div>
                    </div>
                  {{/if}}
                </div>
              </div>
            {{/each}}
          </div>
        {{else}}
          <div class='empty-state'>
            <div class='empty-icon'>
              <svg
                width='32'
                height='32'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='1.5'
              >
                <polygon points='13,2 3,14 12,14 11,22 21,10 12,10' />
              </svg>
            </div>
            <h3>No shortcuts configured</h3>
            <p>Create your first shortcut to get started</p>
          </div>
        {{/if}}
      </div>

      <div class='models-section'>
        <div class='section-header'>
          <div class='section-title-area'>
            <h3 class='section-subtitle'>Available Models</h3>
            <div class='section-help'>These models will be available in the
              Model selection list when using AI Assistant</div>
          </div>
        </div>

        <div class='models-grid'>
          {{#each this.allModelsWithStatus as |item|}}
            {{#unless item.isDisabled}}
              <div
                class='model-card
                  {{if item.isAddition "local-addition"}}
                  {{if item.isOverride "local-modification"}}'
              >
                <div class='model-content'>
                  <div class='model-header'>
                    <div class='model-name'>{{item.model.title}}</div>
                    {{#if item.isDisabled}}
                      <div class='status-badge disabled'>Disabled</div>
                    {{else if item.isAddition}}
                      <div class='status-badge local'>Added</div>
                    {{else if item.isOverride}}
                      <div class='status-badge modified'>Override</div>
                    {{/if}}
                  </div>

                  {{#if item.model.modelId}}
                    <div class='model-id'>{{item.model.modelId}}</div>
                  {{/if}}

                  {{#if item.settings.role}}
                    <div class='model-role'>{{item.settings.role}}</div>
                  {{/if}}

                  <div class='model-usage-pills'>
                    <div
                      class='status-pill assistant
                        {{if item.settings.forAssistantUse "active"}}'
                    >
                      <div class='pill-icon'>
                        {{#if item.settings.forAssistantUse}}
                          <svg
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                          >
                            <path d='m9 12 2 2 4-4' />
                          </svg>
                        {{else}}
                          <svg
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                          >
                            <path d='m18 6-12 12M6 6l12 12' />
                          </svg>
                        {{/if}}
                      </div>
                      <span>Assistant</span>
                    </div>

                    <div
                      class='status-pill agent
                        {{if item.settings.forAgenticUse "active"}}'
                    >
                      <div class='pill-icon'>
                        {{#if item.settings.forAgenticUse}}
                          <svg
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                          >
                            <path d='m9 12 2 2 4-4' />
                          </svg>
                        {{else}}
                          <svg
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
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
            {{/unless}}
          {{/each}}
        </div>
      </div>

      {{#if (gt this.allDisabledModelsWithStatus.length 0)}}
        <div class='disabled-models-section'>
          {{#if this.showDisabledModels}}
            <div class='section-header'>
              <div class='section-title-area'>
                <h3 class='section-subtitle'>Disabled Models</h3>
                <div class='section-help'>These models are disabled and will not
                  appear in AI Assistant</div>
              </div>
            </div>
          {{/if}}

          <div class='models-controls-header'>
            <button
              type='button'
              class='toggle-disabled-button
                {{if this.showDisabledModels "active"}}'
              {{on 'click' this.toggleDisabledModels}}
            >
              <svg
                width='14'
                height='14'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
                class='toggle-icon {{if this.showDisabledModels "rotated"}}'
              >
                <path d='M6 9l6 6 6-6' />
              </svg>
              {{if this.showDisabledModels 'Hide' 'Show'}}
              Disabled Models ({{this.allDisabledModelsWithStatus.length}})
            </button>
          </div>

          {{#if this.showDisabledModels}}
            <div class='disabled-models-grid'>
              {{#each this.allDisabledModelsWithStatus as |item|}}
                <div
                  class='model-card disabled-model
                    {{if item.isAddition "local-addition"}}
                    {{if item.isOverride "local-modification"}}'
                >
                  <div class='model-content'>
                    <div class='model-header'>
                      <div class='model-name'>{{item.model.title}}</div>
                      {{#if item.isDisabledLocally}}
                        <div class='status-badge locally-disabled'>Disabled
                          Locally</div>
                      {{else if item.isDisabledUpstream}}
                        <div class='status-badge upstream-disabled'>Disabled
                          Upstream</div>
                      {{else}}
                        <div class='status-badge disabled'>Disabled</div>
                      {{/if}}
                    </div>

                    {{#if item.model.modelId}}
                      <div class='model-id'>{{item.model.modelId}}</div>
                    {{/if}}

                    {{#if item.settings.role}}
                      <div class='model-role'>{{item.settings.role}}</div>
                    {{/if}}

                    <div class='model-usage-pills'>
                      <div
                        class='status-pill assistant disabled-pill
                          {{if item.settings.forAssistantUse "active"}}'
                      >
                        <div class='pill-icon'>
                          {{#if item.settings.forAssistantUse}}
                            <svg
                              viewBox='0 0 24 24'
                              fill='none'
                              stroke='currentColor'
                            >
                              <path d='m9 12 2 2 4-4' />
                            </svg>
                          {{else}}
                            <svg
                              viewBox='0 0 24 24'
                              fill='none'
                              stroke='currentColor'
                            >
                              <path d='m18 6-12 12M6 6l12 12' />
                            </svg>
                          {{/if}}
                        </div>
                        <span>Assistant</span>
                      </div>

                      <div
                        class='status-pill agent disabled-pill
                          {{if item.settings.forAgenticUse "active"}}'
                      >
                        <div class='pill-icon'>
                          {{#if item.settings.forAgenticUse}}
                            <svg
                              viewBox='0 0 24 24'
                              fill='none'
                              stroke='currentColor'
                            >
                              <path d='m9 12 2 2 4-4' />
                            </svg>
                          {{else}}
                            <svg
                              viewBox='0 0 24 24'
                              fill='none'
                              stroke='currentColor'
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
              {{/each}}
            </div>
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .shortcuts-panel {
        min-height: 100vh;
        background: oklch(1 0 0);
        font-family: 'Inter', system-ui, sans-serif;
        color: oklch(0.15 0 0);
        padding: 2rem;
        display: flex;
        flex-direction: column;
        gap: 2rem;
      }

      .panel-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        padding: 1.5rem;
        background: oklch(0.98 0.002 210);
        border: 1px solid oklch(0.88 0.008 210);
        border-radius: 0.75rem;
      }

      .header-main {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        flex: 1;
      }

      .env-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: oklch(0.15 0 0);
        letter-spacing: -0.025em;
      }

      .env-subtitle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        font-weight: 500;
      }

      .inherits-label {
        color: oklch(0.45 0.02 210);
      }

      .header-stats {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        min-width: 10rem;
      }

      .stat-badge {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding: 0.75rem 1rem;
        background: oklch(0.92 0.005 210);
        border-radius: 0.25rem;
        width: 100%;
      }

      .stat-header-label {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: oklch(0.35 0.02 210);
        margin-bottom: 0.125rem;
      }

      .stat-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        justify-content: space-between;
      }

      .stat-number {
        font-family: 'Fira Code', monospace;
        font-size: 1.25rem;
        font-weight: 700;
        color: oklch(0.55 0.18 250);
        line-height: 1;
      }

      .stat-label {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: oklch(0.45 0.02 210);
      }

      .stat-delta {
        display: flex;
        gap: 0.25rem;
        justify-content: flex-end;
        flex-wrap: wrap;
      }

      .delta-item {
        font-family: 'Fira Code', monospace;
        font-size: 0.6875rem;
        font-weight: 700;
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
        line-height: 1;
      }

      .delta-item.added {
        background: #22c55e;
        color: white;
        box-shadow: 0 1px 2px rgba(34, 197, 94, 0.3);
      }

      .delta-item.modified {
        background: #f59e0b;
        color: white;
        box-shadow: 0 1px 2px rgba(245, 158, 11, 0.3);
      }

      .delta-item.disabled {
        background: #ef4444;
        color: white;
        box-shadow: 0 1px 2px rgba(239, 68, 68, 0.3);
      }

      /* Color Legend for Statistics */
      .stats-legend {
        display: flex;
        gap: 0.75rem;
        margin-top: 0.75rem;
        padding-top: 0.75rem;
        border-top: 1px solid oklch(0.88 0.008 210);
        justify-content: center;
        flex-wrap: wrap;
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.6875rem;
        color: oklch(0.45 0.02 210);
        font-weight: 500;
      }

      .legend-color {
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 0.125rem;
      }

      .legend-color.added {
        background: #22c55e;
      }

      .legend-color.modified {
        background: #f59e0b;
      }

      .legend-color.disabled {
        background: #ef4444;
      }

      .shortcuts-section {
        background: oklch(0.995 0.002 210);
        border: 1px solid oklch(0.88 0.008 210);
        border-radius: 0.75rem;
        padding: 2rem;
      }

      .section-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        margin-bottom: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 2px solid oklch(0.88 0.008 210);
        gap: 1rem;
      }

      .section-title-area {
        flex: 1;
      }

      .section-title {
        font-size: 1.125rem;
        font-weight: 700;
        color: oklch(0.15 0 0);
        margin: 0 0 0.25rem 0;
      }

      .section-subtitle {
        font-size: 1rem;
        font-weight: 600;
        color: oklch(0.15 0 0);
        margin: 0 0 0.25rem 0;
      }

      .section-help {
        font-size: 0.75rem;
        color: oklch(0.55 0.02 210);
        line-height: 1.4;
        font-style: italic;
        margin-top: 0.25rem;
      }

      .inheritance-explanation {
        margin-top: 0.375rem;
      }

      .inheritance-help {
        font-size: 0.75rem;
        color: oklch(0.55 0.02 210);
        line-height: 1.4;
        font-style: italic;
      }

      .models-controls {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .legend {
        display: flex;
        gap: 1rem;
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.75rem;
        color: oklch(0.45 0.02 210);
      }

      .legend-indicator {
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 0.125rem;
      }

      .legend-indicator.local {
        background: #22c55e;
      }

      .legend-indicator.modified {
        background: #f59e0b;
      }

      .legend-indicator.disabled {
        background: #ef4444;
      }

      .shortcuts-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 1rem;
      }

      .shortcut-card {
        background: oklch(1 0 0);
        border: 2px solid oklch(0.92 0.005 210);
        border-radius: 0.5rem;
        padding: 1.25rem;
        transition: all 0.2s ease;
        position: relative;
      }

      .shortcut-card:hover {
        border-color: oklch(0.88 0.008 210);
        box-shadow: 0 4px 12px oklch(0 0 0 / 0.08);
      }

      .shortcut-card.local-addition {
        border-color: #22c55e;
        border-width: 2px;
      }

      .shortcut-card.local-modification {
        border-color: #f59e0b;
        border-width: 2px;
      }

      .shortcut-card.disabled {
        border-color: #ef4444;
        border-width: 2px;
        opacity: 0.6;
      }

      .card-content {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .shortcut-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .shortcut-name {
        font-family: 'Fira Code', monospace;
        font-size: 1rem;
        font-weight: 700;
        color: oklch(0.55 0.18 250);
      }

      .shortcut-name code {
        background: oklch(0.92 0.005 210);
        padding: 0.375rem 0.625rem;
        border-radius: 0.375rem;
        border: 1px solid oklch(0.88 0.008 210);
      }

      .status-indicators {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .status-badge {
        font-size: 0.6875rem;
        font-weight: 700;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        text-transform: uppercase;
        letter-spacing: 0.025em;
      }

      .status-badge.local {
        background: #22c55e;
        color: white;
        box-shadow: 0 1px 3px rgba(34, 197, 94, 0.3);
      }

      .status-badge.modified {
        background: #f59e0b;
        color: white;
        box-shadow: 0 1px 3px rgba(245, 158, 11, 0.3);
      }

      .status-badge.disabled {
        background: #ef4444;
        color: white;
        box-shadow: 0 1px 3px rgba(239, 68, 68, 0.3);
      }

      .skills-section {
        border-top: 1px solid oklch(0.92 0.005 210);
        padding-top: 0.75rem;
        margin-top: 0.75rem;
      }

      .skills-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.5rem;
      }

      .skills-label {
        font-size: 0.6875rem;
        font-weight: 600;
        color: oklch(0.45 0.02 210);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .skills-count {
        background: oklch(0.88 0.008 210);
        color: oklch(0.45 0.02 210);
        font-size: 0.6875rem;
        font-weight: 700;
        padding: 0.1875rem 0.375rem;
        border-radius: 0.25rem;
        line-height: 1;
        min-width: 1.25rem;
        text-align: center;
      }

      .preferred-model {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem;
        background: oklch(0.98 0.002 210);
        border-radius: 0.375rem;
        border: 1px solid oklch(0.92 0.005 210);
      }

      .model-connection {
        width: 2rem;
        height: 2px;
        background: linear-gradient(
          to right,
          oklch(0.55 0.18 250),
          oklch(0.45 0.02 210)
        );
        border-radius: 1px;
      }

      .model-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .model-name {
        font-size: 0.875rem;
        font-weight: 600;
        color: oklch(0.15 0 0);
      }

      .model-id {
        font-family: 'Fira Code', monospace;
        font-size: 0.75rem;
        color: oklch(0.55 0.02 210);
        background: oklch(0.92 0.005 210);
        padding: 0.25rem 0.375rem;
        border-radius: 0.1875rem;
        display: inline-block;
        width: fit-content;
      }

      .no-model {
        font-size: 0.875rem;
        color: oklch(0.65 0.02 210);
        font-style: italic;
        padding: 0.75rem;
        background: oklch(0.96 0.002 210);
        border-radius: 0.375rem;
        text-align: center;
      }

      .skills-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
      }

      .skill-tag {
        font-size: 0.6875rem;
        font-weight: 600;
        padding: 0.25rem 0.5rem;
        border-radius: 0.375rem;
        line-height: 1;
        transition: all 0.15s ease;
        border: none;
        cursor: default;
      }

      .skill-tag.clickable {
        cursor: pointer;
      }

      .skill-tag.base-skill {
        background: #6b7280;
        color: white;
        box-shadow: 0 1px 2px rgba(107, 114, 128, 0.2);
      }

      .skill-tag.base-skill.clickable:hover {
        background: #4b5563;
        box-shadow: 0 2px 4px rgba(107, 114, 128, 0.3);
        transform: translateY(-1px);
      }

      .skill-tag.custom-skill {
        background: #3b82f6;
        color: white;
        box-shadow: 0 1px 2px rgba(59, 130, 246, 0.2);
      }

      .skill-tag.custom-skill.clickable:hover {
        background: #2563eb;
        box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
        transform: translateY(-1px);
      }

      .empty-state {
        text-align: center;
        padding: 3rem 1rem;
        color: oklch(0.45 0.02 210);
      }

      .empty-icon {
        margin: 0 auto 1rem;
        color: oklch(0.65 0.02 210);
      }

      .empty-state h3 {
        font-size: 1.125rem;
        font-weight: 600;
        margin: 0 0 0.5rem 0;
        color: oklch(0.35 0.02 210);
      }

      .empty-state p {
        margin: 0;
        font-size: 0.875rem;
      }

      .models-section {
        background: oklch(0.995 0.002 210);
        border: 1px solid oklch(0.88 0.008 210);
        border-radius: 0.75rem;
        padding: 1.5rem;
      }

      .models-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 0.75rem;
        margin-top: 1rem;
      }

      .model-card {
        background: oklch(1 0 0);
        border: 2px solid oklch(0.92 0.005 210);
        border-radius: 0.375rem;
        padding: 1rem;
        transition: all 0.15s ease;
      }

      .model-card:hover {
        border-color: oklch(0.88 0.008 210);
      }

      /* Shared styles for local modifications - applies to both shortcuts and models */
      .shortcut-card.local-addition,
      .model-card.local-addition {
        border-color: #22c55e !important;
        border-width: 2px !important;
      }

      .shortcut-card.local-addition:hover,
      .model-card.local-addition:hover {
        border-color: #16a34a !important;
      }

      .shortcut-card.local-modification,
      .model-card.local-modification {
        border-color: #f59e0b !important;
        border-width: 2px !important;
      }

      .shortcut-card.local-modification:hover,
      .model-card.local-modification:hover {
        border-color: #d97706 !important;
      }

      .shortcut-card.local-disabled,
      .model-card.local-disabled {
        border-color: #ef4444 !important;
        border-width: 2px !important;
        opacity: 0.7;
      }

      .shortcut-card.local-disabled:hover,
      .model-card.local-disabled:hover {
        border-color: #dc2626 !important;
      }

      .model-card.disabled {
        border-color: #ef4444;
        opacity: 0.6;
      }

      .model-card.disabled-model {
        border-color: #ef4444 !important;
        background: #fef2f2 !important;
        border-width: 2px !important;
      }

      .model-card.disabled-model .model-name {
        color: #dc2626 !important;
      }

      .model-card.disabled-model .model-role,
      .model-card.disabled-model .model-id {
        color: #ef4444 !important;
      }

      /* Disabled Models Section */
      .disabled-models-section {
        background: oklch(0.98 0.002 210);
        border: 1px solid oklch(0.88 0.008 210);
        border-radius: 0.75rem;
        padding: 1.5rem;
      }

      .models-controls-header {
        display: flex;
        justify-content: center;
        margin-bottom: 1.5rem;
      }

      .toggle-disabled-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: oklch(0.94 0.002 210);
        border: 1px solid oklch(0.88 0.008 210);
        border-radius: 0.375rem;
        color: oklch(0.45 0.02 210);
        cursor: pointer;
        transition: all 0.15s ease;
        font-size: 0.75rem;
        font-weight: 600;
      }

      .toggle-disabled-button:hover {
        background: oklch(0.92 0.005 210);
        border-color: oklch(0.8 0.008 210);
        color: oklch(0.35 0.02 210);
      }

      .toggle-disabled-button.active {
        background: oklch(0.65 0.02 210);
        border-color: oklch(0.55 0.02 210);
        color: white;
      }

      .toggle-icon {
        transition: transform 0.3s ease;
      }

      .toggle-icon.rotated {
        transform: rotate(180deg);
      }

      .disabled-models-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 0.75rem;
        margin-top: 1rem;
      }

      .model-card.locally-disabled {
        border-color: #dc2626 !important;
        border-width: 2px !important;
        background: #fef2f2 !important;
      }

      .model-card.upstream-disabled {
        border-color: #94a3b8 !important;
        border-width: 1px !important;
        background: #f8fafc !important;
        opacity: 0.7;
      }

      .status-badge.locally-disabled {
        background: #dc2626;
        color: white;
        border: 1px solid #b91c1c;
      }

      .status-badge.upstream-disabled {
        background: #94a3b8;
        color: white;
        border: 1px solid #64748b;
      }

      .disabled-models-summary {
        margin-top: 1rem;
        padding: 1rem;
        background: oklch(0.96 0.01 15);
        border: 1px dashed oklch(0.85 0.05 15);
        border-radius: 0.5rem;
      }

      .summary-stats {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
        justify-content: center;
      }

      .summary-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
        padding: 0.75rem 1rem;
        border-radius: 0.375rem;
        min-width: 120px;
      }

      .summary-item.locally-disabled {
        background: #fef2f2;
        border: 1px solid #fecaca;
      }

      .summary-item.upstream-disabled {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }

      .summary-item .count {
        font-size: 1.25rem;
        font-weight: 700;
        color: oklch(0.35 0.1 15);
      }

      .summary-item .label {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: oklch(0.45 0.08 15);
        text-align: center;
        line-height: 1.2;
      }

      /* Disabled Pills Styling */
      .status-pill.disabled-pill {
        opacity: 0.6;
      }

      .status-pill.disabled-pill:not(.active) {
        border-color: #d1d5db;
        background: #f3f4f6;
        color: #9ca3af;
      }

      .status-pill.disabled-pill.active {
        border-color: #d1d5db;
        background: #e5e7eb;
        color: #6b7280;
      }

      .model-content {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .model-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.5rem;
      }

      .model-name {
        font-size: 0.875rem;
        font-weight: 600;
        color: oklch(0.15 0 0);
      }

      .model-role {
        font-size: 0.75rem;
        color: oklch(0.45 0.02 210);
      }

      .model-usage {
        margin-top: 0.25rem;
      }

      .model-usage-pills {
        display: flex;
        gap: 0.375rem;
        flex-wrap: wrap;
      }

      .status-pill {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.25rem 0.5rem;
        border-radius: 0.75rem;
        font-size: 0.625rem;
        font-weight: 600;
        border: 1.5px solid;
        transition: all 0.2s ease;
      }

      .status-pill.assistant:not(.active) {
        border-color: #e5e7eb;
        background: #f9fafb;
        color: #6b7280;
      }

      .status-pill.assistant.active {
        border-color: #10b981;
        background: #10b981;
        color: white;
        box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3);
      }

      .status-pill.agent:not(.active) {
        border-color: #e5e7eb;
        background: #f9fafb;
        color: #6b7280;
      }

      .status-pill.agent.active {
        border-color: #8b5cf6;
        background: #8b5cf6;
        color: white;
        box-shadow: 0 2px 4px rgba(139, 92, 246, 0.3);
      }

      .pill-icon {
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 50%;
        background: currentColor;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.625rem;
        font-weight: 700;
      }

      .pill-icon svg {
        width: 0.625rem;
        height: 0.625rem;
        stroke-width: 2px;
      }

      .status-pill:not(.active) .pill-icon {
        background: #e5e7eb;
        color: #9ca3af;
      }

      .status-pill.active .pill-icon {
        background: rgba(255, 255, 255, 0.2);
        color: white;
      }

      /* Responsive adjustments */
      @media (max-width: 768px) {
        .shortcuts-panel {
          padding: 1rem;
          gap: 1.5rem;
        }

        .panel-header {
          flex-direction: column;
          gap: 1rem;
          padding: 1rem;
        }

        .header-stats {
          align-self: stretch;
          justify-content: space-around;
        }

        .shortcuts-grid {
          grid-template-columns: 1fr;
        }

        .models-grid {
          grid-template-columns: 1fr;
        }

        .shortcut-header {
          flex-direction: column;
          align-items: stretch;
          gap: 0.5rem;
        }

        .status-indicators {
          justify-content: flex-start;
        }
      }
    </style>
  </template>
}

class Edit extends Component<typeof Environment> {
  @action
  updateName(event: Event) {
    const target = event.target as HTMLInputElement;
    this.args.model.name = target.value;
  }

  @action
  addShortcut() {
    // Create a new shortcut setting
    const newShortcut = new ShortcutSettingsField({
      name: '',
      preferredModel: null,
      requiredSkills: [],
    });

    // Add to the shortcutSettings array
    const currentShortcuts = this.args.model.shortcutSettings || [];
    this.args.model.shortcutSettings = [...currentShortcuts, newShortcut];
  }

  @action
  addModelSetting() {
    // Create a new model setting
    const newModelSetting = new ModelSettingsField({
      model: null,
      role: '',
      forAssistantUse: true,
      forAgenticUse: true,
      isDisabled: false,
    });

    // Add to the modelSettings array
    const currentSettings = this.args.model.modelSettings || [];
    this.args.model.modelSettings = [...currentSettings, newModelSetting];
  }

  @action
  removeParent() {
    this.args.model.parent = undefined;
  }

  @action
  removeShortcut(shortcut: ShortcutSettingsField) {
    const currentShortcuts = this.args.model.shortcutSettings || [];
    this.args.model.shortcutSettings = currentShortcuts.filter(
      (s) => s !== shortcut,
    );
  }

  @action
  removeModelSetting(setting: ModelSettingsField) {
    const currentSettings = this.args.model.modelSettings || [];
    this.args.model.modelSettings = currentSettings.filter(
      (s) => s !== setting,
    );
  }

  <template>
    <div class='environment-editor'>
      <div class='title-section'>
        <div class='title-input-container'>
          <label>
            <input
              type='text'
              value={{@model.name}}
              placeholder='Enter environment name...'
              {{on 'input' this.updateName}}
              class='title-input'
            />
          </label>
        </div>

        <div class='env-stats'>
          <div class='stats-header'>
            <h2 class='stats-title'>{{@model.title}} Statistics</h2>
          </div>
          <div class='stats-grid'>
            <div class='stat-card shortcuts'>
              <div class='stat-header'>
                <div class='stat-icon'>
                  <svg
                    width='18'
                    height='18'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2.5'
                  >
                    <polygon points='13,2 3,14 12,14 11,22 21,10 12,10' />
                  </svg>
                </div>
                <div class='stat-info'>
                  <div
                    class='stat-number'
                  >{{@model.stats.shortcuts.total}}</div>
                  <div class='stat-label'>Total Shortcuts</div>
                </div>
              </div>
              <div class='stat-delta'>
                {{#if (gt @model.stats.shortcuts.added 0)}}
                  <span
                    class='delta-item added'
                  >+{{@model.stats.shortcuts.added}}</span>
                {{/if}}
                {{#if (gt @model.stats.shortcuts.modified 0)}}
                  <span
                    class='delta-item modified'
                  >Δ{{@model.stats.shortcuts.modified}}</span>
                {{/if}}
                {{#if (gt @model.stats.shortcuts.disabled 0)}}
                  <span
                    class='delta-item disabled'
                  >⊘{{@model.stats.shortcuts.disabled}}</span>
                {{/if}}
              </div>
            </div>

            <div class='stat-card models'>
              <div class='stat-header'>
                <div class='stat-icon'>
                  <svg
                    width='18'
                    height='18'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2.5'
                  >
                    <circle cx='12' cy='12' r='3' />
                    <path
                      d='m8 16 1.5-1.5M16 8l-1.5 1.5m0 5L16 16M8 8l1.5 1.5'
                    />
                    <circle cx='12' cy='12' r='10' />
                  </svg>
                </div>
                <div class='stat-info'>
                  <div class='stat-number'>{{@model.stats.models.total}}</div>
                  <div class='stat-label'>Total Models</div>
                </div>
              </div>
              <div class='stat-delta'>
                {{#if (gt @model.stats.models.added 0)}}
                  <span
                    class='delta-item added'
                  >+{{@model.stats.models.added}}</span>
                {{/if}}
                {{#if (gt @model.stats.models.modified 0)}}
                  <span
                    class='delta-item modified'
                  >Δ{{@model.stats.models.modified}}</span>
                {{/if}}
                {{#if (gt @model.stats.models.disabled 0)}}
                  <span
                    class='delta-item disabled'
                  >⊘{{@model.stats.models.disabled}}</span>
                {{/if}}
              </div>
            </div>
          </div>
        </div>
      </div>

      {{#if @model.parent}}
        <div class='parent-section'>
          <div class='section-header-row'>
            <h3 class='section-header'>Parent Environment</h3>
            <button
              type='button'
              class='unlink-button'
              {{on 'click' this.removeParent}}
              title='Unlink parent environment'
            >
              Unlink
            </button>
          </div>
          <div class='parent-embedded-container'>
            <@fields.parent @format='embedded' />
          </div>
        </div>
      {{else}}
        <div class='parent-section'>
          <h3 class='section-header'>Link Parent Environment</h3>
          <div class='parent-selector'>
            <@fields.parent />
          </div>
        </div>
      {{/if}}

      <div class='config-section'>
        <div class='section-header-row'>
          <h3 class='section-header'>Edit AI Shortcuts</h3>
          <div class='add-cta-clean'>
            <button
              type='button'
              class='add-shortcut-button'
              {{on 'click' this.addShortcut}}
            >
              <svg
                width='16'
                height='16'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2.5'
              >
                <path d='M12 5v14M5 12h14' />
              </svg>
              Add Shortcut
            </button>
          </div>
        </div>

        {{#if (gt @model.shortcutSettings.length 0)}}
          {{#let @fields.shortcutSettings as |Field|}}
            <Field @format='edit' />
          {{/let}}
        {{else}}
          <div class='empty-state'>
            <div class='empty-icon'>
              <svg
                width='24'
                height='24'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='1.5'
              >
                <polygon points='13,2 3,14 12,14 11,22 21,10 12,10' />
              </svg>
            </div>
            <p class='empty-text'>No shortcuts configured yet</p>
            <p class='empty-help'>Add your first shortcut to create AI-powered
              commands</p>
          </div>
        {{/if}}
      </div>

      <div class='config-section'>
        <div class='section-header-row'>
          <h3 class='section-header'>Model Settings</h3>
          <button
            type='button'
            class='add-button model'
            {{on 'click' this.addModelSetting}}
          >
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2.5'
            >
              <path d='M12 5v14M5 12h14' />
            </svg>
            Add Model Setting
          </button>
        </div>

        {{#if (gt @model.modelSettings.length 0)}}

          {{#let @fields.modelSettings as |Field|}}
            <Field @format='edit' />
          {{/let}}
        {{else}}<div class='empty-state'>
            <div class='empty-icon'>
              <svg
                width='24'
                height='24'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='1.5'
              >
                <circle cx='12' cy='12' r='3' />
                <path d='m8 16 1.5-1.5M16 8l-1.5 1.5m0 5L16 16M8 8l1.5 1.5' />
                <circle cx='12' cy='12' r='10' />
              </svg>
            </div>
            <p class='empty-text'>No model settings configured yet</p>
            <p class='empty-help'>Add model configurations to customize AI
              behavior</p>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .environment-editor {
        font-family: 'Inter', system-ui, sans-serif;
        background: oklch(0.985 0.002 210);
        border-radius: 0.75rem;
        border: 1px solid oklch(0.88 0.008 210);
        padding: 1.5rem;
        max-width: 800px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 2rem;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      }

      .title-section {
        padding-bottom: 1rem;
        border-bottom: 2px solid oklch(0.92 0.005 210);
      }

      .title-input {
        background: oklch(0.98 0 0);
        border: 2px solid oklch(0.88 0.008 210);
        border-radius: 0.75rem;
        padding: 1rem 1.25rem;
        font-size: 1.5rem;
        font-weight: 700;
        color: oklch(0.15 0 0);
        transition: all 0.2s ease;
        width: 100%;
        box-sizing: border-box;
        font-family: inherit;
        outline: none;
      }

      .title-input:focus {
        border-color: oklch(0.55 0.18 250);
        box-shadow: 0 0 0 3px oklch(0.55 0.18 250 / 0.15);
        background: oklch(1 0 0);
      }

      .title-input::placeholder {
        color: oklch(0.6 0.02 220);
        font-style: italic;
      }

      /* Environment Stats */
      .env-stats {
        margin-top: 1.5rem;
        padding-top: 1.5rem;
        border-top: 1px solid oklch(0.88 0.008 210);
      }

      .stats-header {
        margin-bottom: 1rem;
      }

      .stats-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: oklch(0.15 0 0);
        margin: 0;
        letter-spacing: -0.025em;
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
      }

      .stat-card {
        background: oklch(0.92 0.005 210);
        border-radius: 0.5rem;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .stat-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .stat-icon {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: oklch(1 0 0);
        flex-shrink: 0;
      }

      .stat-card.shortcuts .stat-icon {
        color: oklch(0.55 0.18 280);
      }

      .stat-card.models .stat-icon {
        color: oklch(0.55 0.15 160);
      }

      .stat-info {
        flex: 1;
      }

      .stat-number {
        font-family: 'Fira Code', monospace;
        font-size: 1.5rem;
        font-weight: 700;
        color: oklch(0.55 0.18 250); /* Consistent blue color */
        line-height: 1;
        margin-bottom: 0.125rem;
      }

      .stat-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: oklch(0.45 0.02 210);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .stat-delta {
        display: flex;
        gap: 0.25rem;
        justify-content: flex-end;
        flex-wrap: wrap;
      }

      .delta-item {
        font-family: 'Fira Code', monospace;
        font-size: 0.6875rem;
        font-weight: 700;
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
        line-height: 1;
      }

      .delta-item.added {
        background: #22c55e;
        color: white;
        box-shadow: 0 1px 2px rgba(34, 197, 94, 0.3);
      }

      .delta-item.modified {
        background: #f59e0b;
        color: white;
        box-shadow: 0 1px 2px rgba(245, 158, 11, 0.3);
      }

      .delta-item.disabled {
        background: #ef4444;
        color: white;
        box-shadow: 0 1px 2px rgba(239, 68, 68, 0.3);
      }

      /* Parent Section */
      .parent-section {
        background: oklch(0.98 0.002 210);
        border: 1px solid oklch(0.88 0.008 210);
        border-radius: 0.75rem;
        padding: 1.5rem;
        transition:
          border-color 0.2s ease,
          box-shadow 0.2s ease;
      }

      .parent-section:hover {
        border-color: var(--boxel-teal);
        border-width: 2px;
        box-shadow: 0 4px 12px rgba(54, 179, 126, 0.15);
      }

      .section-header {
        font-size: 1.125rem;
        font-weight: 700;
        color: oklch(0.15 0 0);
        margin: 0 0 1rem 0;
        letter-spacing: -0.025em;
      }

      .section-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1.5rem;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid oklch(0.88 0.008 210);
      }

      .parent-embedded-container {
        background: oklch(0.94 0.002 210);
        border: 1px solid oklch(0.88 0.008 210);
        border-radius: 0.5rem;
        overflow: hidden;
      }

      .parent-selector :deep(.field-container) {
        background: oklch(0.94 0.002 210);
        border: 1px solid oklch(0.88 0.008 210);
        border-radius: 0.5rem;
        padding: 0.75rem;
      }

      .config-section {
        background: oklch(0.995 0.002 210);
        border: 1px solid oklch(0.88 0.008 210);
        border-radius: 0.75rem;
        padding: 1.5rem;
        transition: border-color 0.2s ease;
      }

      .config-section:hover {
        border-color: var(--boxel-teal);
        border-width: 2px;
        box-shadow: 0 4px 12px rgba(54, 179, 126, 0.15);
      }

      :root {
        --boxel-teal: #36b37e;
      }

      .section-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1.5rem;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid oklch(0.88 0.008 210);
      }

      /* Add Buttons */
      .add-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.625rem 1rem;
        background: oklch(0.55 0.18 250);
        color: white;
        border: none;
        border-radius: 0.5rem;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px oklch(0.55 0.18 250 / 0.2);
      }

      .add-button:hover {
        background: oklch(0.5 0.18 250);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px oklch(0.55 0.18 250 / 0.3);
      }

      .add-button:active {
        transform: translateY(0);
      }

      .add-button.model {
        background: oklch(0.55 0.15 160);
        box-shadow: 0 2px 4px oklch(0.55 0.15 160 / 0.2);
      }

      .add-button.model:hover {
        background: oklch(0.5 0.15 160);
        box-shadow: 0 4px 8px oklch(0.55 0.15 160 / 0.3);
      }

      .add-button svg {
        transition: transform 0.2s ease;
      }

      .add-button:hover svg {
        transform: scale(1.1);
      }

      /* Add Shortcut Button - Clean CTA */
      .add-cta-clean {
        display: flex;
        align-items: center;
      }

      .add-shortcut-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.625rem 1rem;
        background: oklch(0.55 0.18 280);
        color: white;
        border: none;
        border-radius: 0.5rem;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        font-family: inherit;
      }

      .add-shortcut-button:hover {
        background: oklch(0.5 0.18 280);
        transform: translateY(-1px);
      }

      .add-shortcut-button:active {
        transform: translateY(0);
      }

      .add-shortcut-button svg {
        transition: transform 0.2s ease;
      }

      .add-shortcut-button:hover svg {
        transform: scale(1.1);
      }

      /* Unlink Button */
      .unlink-button {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.5rem 0.75rem;
        background: oklch(0.95 0.02 15);
        border: 1px solid oklch(0.88 0.008 15);
        border-radius: 0.375rem;
        color: oklch(0.65 0.12 15);
        cursor: pointer;
        transition: all 0.15s ease;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.025em;
      }

      .unlink-button:hover {
        background: oklch(0.92 0.04 15);
        border-color: oklch(0.8 0.1 15);
        color: oklch(0.55 0.15 15);
        transform: translateY(-1px);
      }

      .unlink-button:active {
        transform: translateY(0);
      }

      /* Empty States */
      .empty-state {
        text-align: center;
        padding: 3rem 1.5rem;
        color: oklch(0.45 0.02 210);
      }

      .empty-icon {
        margin: 0 auto 1rem;
        color: oklch(0.65 0.02 210);
        opacity: 0.7;
      }

      .empty-text {
        font-size: 1rem;
        font-weight: 600;
        color: oklch(0.35 0.02 210);
        margin: 0 0 0.5rem 0;
      }

      .empty-help {
        font-size: 0.875rem;
        color: oklch(0.55 0.02 210);
        margin: 0;
        font-style: italic;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .environment-editor {
          padding: 1rem;
          gap: 1.5rem;
          border-radius: 0.5rem;
        }

        .title-input-container :deep(.field-container) {
          padding: 0.75rem 1rem;
          font-size: 1.25rem;
          border-radius: 0.5rem;
        }

        .title-input-container :deep(input) {
          font-size: 1.25rem;
        }

        .parent-section,
        .config-section {
          padding: 1rem;
          border-radius: 0.5rem;
        }

        .section-header-row {
          flex-direction: column;
          align-items: stretch;
          gap: 1rem;
          text-align: center;
        }

        .add-button {
          align-self: center;
          width: fit-content;
        }

        .config-item {
          padding: 0.75rem;
        }

        .empty-state {
          padding: 2rem 1rem;
        }
      }

      @media (max-width: 480px) {
        .environment-editor {
          padding: 0.75rem;
          gap: 1rem;
        }

        .title-input-container :deep(.field-container) {
          padding: 0.625rem 0.75rem;
          font-size: 1.125rem;
        }

        .title-input-container :deep(input) {
          font-size: 1.125rem;
        }
      }
    </style>
  </template>
}

export class Environment extends CardDef {
  static displayName = 'Environment';
  static icon = SettingsIcon;

  @field name = contains(StringField);
  @field parent = linksTo(() => Environment);
  @field modelSettings = containsMany(ModelSettingsField);
  @field shortcutSettings = containsMany(ShortcutSettingsField);

  get localModelCount(): number {
    return this.#getArray(this.modelSettings).length;
  }

  get localShortcutCount(): number {
    return this.#getArray(this.shortcutSettings).length;
  }

  get inheritedModelCount(): number {
    return this.modelsList.length - this.localModelCount;
  }

  get inheritedShortcutCount(): number {
    return this.shortcutsList.length - this.localShortcutCount;
  }

  get stats() {
    const result = {
      shortcuts: { total: 0, added: 0, modified: 0, disabled: 0 },
      models: { total: 0, added: 0, modified: 0, disabled: 0 },
    };

    const localShortcuts = this.#getArray(this.shortcutSettings);
    const parentShortcutNames = new Set(
      (this.parent?.shortcutsList ?? []).map((s) => s.name),
    );
    result.shortcuts.modified = localShortcuts.filter((local) =>
      parentShortcutNames.has(local.name),
    ).length;
    result.shortcuts.added = localShortcuts.length - result.shortcuts.modified;
    result.shortcuts.total = this.shortcutsList.length;
    result.shortcuts.disabled = 0;

    const localModelSettings = this.#getArray(this.modelSettings);
    const parentModelIds = new Set(
      (this.parent?.modelsList ?? [])
        .map((item) => item.model?.id)
        .filter(Boolean),
    );
    const parentDisabledModelIds = new Set(
      (this.parent?.disabledModels ?? []).map((m) => m.model?.id),
    );

    result.models.modified = localModelSettings.filter(
      (local) =>
        parentModelIds.has(local.model?.id) &&
        !local.isDisabled &&
        !parentDisabledModelIds.has(local.model?.id),
    ).length;

    result.models.added = uniqBy(
      localModelSettings.filter(
        (local) => !parentModelIds.has(local.model?.id) && !local.isDisabled,
      ),
      'model.id',
    ).length;

    result.models.disabled = localModelSettings.filter(
      (local) => local.isDisabled && local.model?.id,
    ).length;
    result.models.total = this.modelsList.filter(
      (item) => !item.isDisabled,
    ).length;
    return result;
  }

  #getArray<T>(field: T[] | undefined): T[] {
    return Array.isArray(field) ? [...field] : [];
  }

  @field title = contains(StringField, {
    computeVia: function (this: Environment) {
      try {
        if (this.name) {
          return this.name;
        }

        const modelCount = this.modelsList.length;
        const shortcutCount = this.shortcutsList.length;

        if (modelCount === 0 && shortcutCount === 0) {
          return 'Environment Setup';
        }

        const parts: string[] = [];
        if (modelCount > 0) {
          parts.push(`${modelCount} model${modelCount > 1 ? 's' : ''}`);
        }
        if (shortcutCount > 0) {
          parts.push(
            `${shortcutCount} shortcut${shortcutCount > 1 ? 's' : ''}`,
          );
        }

        return `Environment • ${parts.join(', ')}`;
      } catch (error) {
        console.error('Environment: Error computing title', error);
        return 'Environment';
      }
    },
  });

  @field shortcutsList = containsMany(ShortcutSettingsField, {
    computeVia: function (this: Environment) {
      const shortcuts = new Map<string, ShortcutSettingsField>();
      const collect = (env: Environment | undefined) => {
        if (!env) return;
        collect(env.parent);
        this.#getArray(env.shortcutSettings).forEach((shortcut) => {
          if (shortcut?.name) {
            shortcuts.set(shortcut.name, shortcut);
          }
        });
      };
      collect(this);
      return Array.from(shortcuts.values());
    },
  });

  @field modelsList = containsMany(ModelSettingsField, {
    computeVia: function (this: Environment) {
      const settings = new Map<string, ModelSettingsField>();
      const collect = (env: Environment | undefined) => {
        if (!env) return;
        collect(env.parent);
        this.#getArray(env.modelSettings).forEach((setting) => {
          // if is disabled from parent, skip it
          const parentDisabledModelIds = new Set(
            (env?.parent?.disabledModels ?? []).map((m) => m.model?.id),
          );
          if (parentDisabledModelIds.has(setting.model?.id)) {
            return;
          }
          if (setting?.model?.id) {
            settings.set(setting.model.id, setting);
          }
        });
      };
      collect(this);
      return Array.from(settings.values());
    },
  });

  @field disabledModels = containsMany(ModelSettingsField, {
    computeVia: function (this: Environment) {
      return this.modelsList.filter((setting) => setting.isDisabled);
    },
  });

  static isolated = Isolated;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='environment-panel-embedded'>
        <div class='panel-header'>
          <div class='header-main'>
            <div class='env-title'>{{@model.title}}</div>
            {{#if @model.parent}}
              <div class='env-subtitle'>
                <span class='inherits-label'>Inherits from</span>
                <@fields.parent @format='atom' />
              </div>
            {{/if}}
          </div>
          <div class='header-stats'>
            <div class='stat-badge shortcuts'>
              <div class='stat-row'>
                <span
                  class='stat-number'
                >{{@model.stats.shortcuts.total}}</span>
                <span class='stat-label'>shortcuts</span>
              </div>
              <div class='stat-delta'>
                {{#if (gt @model.stats.shortcuts.added 0)}}
                  <span
                    class='delta-item added'
                  >+{{@model.stats.shortcuts.added}}</span>
                {{/if}}
                {{#if (gt @model.stats.shortcuts.modified 0)}}
                  <span
                    class='delta-item modified'
                  >Δ{{@model.stats.shortcuts.modified}}</span>
                {{/if}}
                {{#if (gt @model.stats.shortcuts.disabled 0)}}
                  <span
                    class='delta-item disabled'
                  >⊘{{@model.stats.shortcuts.disabled}}</span>
                {{/if}}
              </div>
            </div>

            <div class='stat-badge models'>
              <div class='stat-row'>
                <span class='stat-number'>{{@model.stats.models.total}}</span>
                <span class='stat-label'>models</span>
              </div>
              <div class='stat-delta'>
                {{#if (gt @model.stats.models.added 0)}}
                  <span
                    class='delta-item added'
                  >+{{@model.stats.models.added}}</span>
                {{/if}}
                {{#if (gt @model.stats.models.modified 0)}}
                  <span
                    class='delta-item modified'
                  >Δ{{@model.stats.models.modified}}</span>
                {{/if}}
                {{#if (gt @model.stats.models.disabled 0)}}
                  <span
                    class='delta-item disabled'
                  >⊘{{@model.stats.models.disabled}}</span>
                {{/if}}
              </div>
            </div>
          </div>
        </div>

        <div class='overview-content'>
          {{#if
            (or (gt @model.localShortcutCount 0) (gt @model.localModelCount 0))
          }}
            <div class='quick-summary'>
              <div class='summary-text'>
                This environment defines
                {{#if (gt @model.localShortcutCount 0)}}
                  <strong>{{@model.localShortcutCount}}
                    shortcut{{if
                      (gt @model.localShortcutCount 1)
                      's'
                      ''
                    }}</strong>
                {{/if}}
                {{#if
                  (and
                    (gt @model.localShortcutCount 0)
                    (gt @model.localModelCount 0)
                  )
                }}
                  and
                {{/if}}
                {{#if (gt @model.localModelCount 0)}}
                  <strong>{{@model.localModelCount}}
                    model setting{{if
                      (gt @model.localModelCount 1)
                      's'
                      ''
                    }}</strong>
                {{/if}}
              </div>

              <div class='legend'>
                <div class='legend-item'>
                  <div class='legend-indicator local'></div>
                  <span>Local additions</span>
                </div>
                {{#if @model.parent}}
                  <div class='legend-item'>
                    <div class='legend-indicator inherited'></div>
                    <span>From parent</span>
                  </div>
                {{/if}}
              </div>
            </div>
          {{else}}
            <div class='empty-overview'>
              <div class='overview-icon'>
                <svg
                  width='28'
                  height='28'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='1.5'
                >
                  <path
                    d='M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'
                  />
                </svg>
              </div>
              <div class='overview-text'>
                <p class='overview-title'>Ready for configuration</p>
                <p class='overview-subtitle'>{{#if @model.parent}}Inheriting
                    {{add
                      (Number @model.inheritedModelCount)
                      (Number @model.inheritedShortcutCount)
                    }}
                    settings from parent{{else}}Add shortcuts and model settings
                    to get started{{/if}}</p>
              </div>
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .environment-panel-embedded {
          background: oklch(0.995 0.002 210);
          font-family: 'Inter', system-ui, sans-serif;
          color: oklch(0.15 0 0);
          border-radius: 0.75rem;
          overflow: hidden;
          border: 1px solid oklch(0.88 0.008 210);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }

        .panel-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
          padding: 1.5rem;
          background: oklch(0.98 0.002 210);
          border-bottom: 1px solid oklch(0.88 0.008 210);
        }

        .header-main {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
          flex: 1;
        }

        .env-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: oklch(0.15 0 0);
          letter-spacing: -0.025em;
        }

        .env-subtitle {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .inherits-label {
          color: oklch(0.45 0.02 210);
        }

        .header-stats {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          min-width: 10rem;
        }

        .stat-badge {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
          padding: 0.75rem 1rem;
          background: oklch(0.92 0.005 210);
          border-radius: 0.25rem;
          width: 100%;
        }

        .stat-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          justify-content: space-between;
        }

        .stat-number {
          font-family: 'Fira Code', monospace;
          font-size: 1.25rem;
          font-weight: 700;
          color: oklch(0.55 0.18 250);
          line-height: 1;
        }

        .stat-label {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: oklch(0.45 0.02 210);
        }

        .stat-delta {
          display: flex;
          gap: 0.25rem;
          justify-content: flex-end;
          flex-wrap: wrap;
        }

        .delta-item {
          font-family: 'Fira Code', monospace;
          font-size: 0.6875rem;
          font-weight: 700;
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          line-height: 1;
        }

        .delta-item.added {
          background: #22c55e;
          color: white;
          box-shadow: 0 1px 2px rgba(34, 197, 94, 0.3);
        }

        .overview-content {
          padding: 1.5rem;
        }

        .quick-summary {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .summary-text {
          font-size: 0.875rem;
          color: oklch(0.25 0.02 210);
          line-height: 1.5;
        }

        .summary-text strong {
          color: oklch(0.15 0 0);
          font-weight: 600;
        }

        .legend {
          display: flex;
          gap: 1rem;
          flex-wrap: wrap;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.75rem;
          color: oklch(0.45 0.02 210);
        }

        .legend-indicator {
          width: 0.75rem;
          height: 0.75rem;
          border-radius: 0.125rem;
        }

        .legend-indicator.local {
          background: #22c55e;
        }

        .legend-indicator.inherited {
          background: #6b7280;
        }

        .empty-overview {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          background: oklch(0.98 0.002 210);
          border-radius: 0.5rem;
          border: 1px dashed oklch(0.85 0.008 210);
        }

        .overview-icon {
          color: oklch(0.55 0.02 210);
          flex-shrink: 0;
        }

        .overview-text {
          flex: 1;
        }

        .overview-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: oklch(0.25 0.02 210);
          margin: 0 0 0.25rem 0;
        }

        .overview-subtitle {
          font-size: 0.75rem;
          color: oklch(0.45 0.02 210);
          margin: 0;
          line-height: 1.4;
        }

        /* Responsive adjustments */
        @media (max-width: 768px) {
          .panel-header {
            flex-direction: column;
            gap: 1rem;
            padding: 1rem;
          }

          .header-stats {
            align-self: stretch;
            flex-direction: row;
            justify-content: space-around;
            min-width: auto;
          }

          .stat-badge {
            flex: 1;
          }

          .env-title {
            font-size: 1.25rem;
          }

          .overview-content {
            padding: 1rem;
          }

          .empty-overview {
            flex-direction: column;
            text-align: center;
            gap: 0.75rem;
          }
        }
      </style>
    </template>
  };

  static fitted = Fitted;

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='env-atom'>
        <span class='env-name'>{{if @model.name @model.name 'Env'}}</span>
        <span
          class='env-counts'
        >{{@model.modelsList.length}}m/{{@model.shortcutsList.length}}s</span>
      </span>

      <style scoped>
        .env-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 0.75rem;
          color: oklch(0.145 0 0);
        }

        .env-name {
          font-weight: 600;
          color: oklch(0.145 0 0);
        }

        .env-counts {
          color: oklch(0.45 0 0);
          font-size: 0.6875rem;
        }
      </style>
    </template>
  };

  static edit = Edit;
}
