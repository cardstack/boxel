import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';

import UpdateRoomSkillsCommand from '@cardstack/boxel-host/commands/update-room-skills';

import { Button, FieldContainer } from '@cardstack/boxel-ui/components';

const SKILL_OPTIONS: Array<{ id: string; title: string }> = [
  { id: 'Skill/boxel-environment', title: 'Boxel Environment' },
  { id: 'Skill/boxel-development', title: 'Boxel Development' },
  { id: 'Skill/source-code-editing', title: 'Source Code Editing' },
  { id: 'Skill/catalog-listing', title: 'Catalog Listing' },
];

function ensureTrailingSlash(url: string) {
  if (!url) {
    return '';
  }
  return url.endsWith('/') ? url : `${url}/`;
}

function defaultSkillsRealmURL() {
  if (typeof window === 'undefined') {
    return '';
  }

  let candidates = [
    (window as any).ENV,
    (window as any).__BOXEL_HOST_CONFIG__,
    (window as any).__BOXEL_ENV__,
  ];

  for (let candidate of candidates) {
    let resolved = candidate?.resolvedSkillsRealmURL;
    if (typeof resolved === 'string' && resolved.length > 0) {
      return ensureTrailingSlash(resolved);
    }
  }

  try {
    return ensureTrailingSlash(`${window.location.origin}/skills/`);
  } catch {
    return '';
  }
}

function parseSkillInput(input?: string | null) {
  if (!input) {
    return [];
  }
  return input
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeSkillId(raw: string, skillsRealmURL: string) {
  if (!raw) {
    return null;
  }

  let trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (!skillsRealmURL) {
    return trimmed;
  }

  try {
    return new URL(trimmed, skillsRealmURL).href;
  } catch {
    return trimmed;
  }
}

class Isolated extends Component<typeof UpdateRoomSkillsExample> {
  skillOptions = SKILL_OPTIONS;

  @tracked skillsRealmURL = defaultSkillsRealmURL();
  @tracked activationPresets = [] as string[];
  @tracked deactivationPresets = [] as string[];
  @tracked statusMessage = null as string | null;
  @tracked errorMessage = null as string | null;
  @tracked isExecuting = false;

  get hasCommandContext() {
    return Boolean(this.args.context?.commandContext);
  }

  get finalSkillsRealmURL() {
    return ensureTrailingSlash(this.skillsRealmURL);
  }

  get activationPreview() {
    return this.collectSkillIds('activate');
  }

  get deactivationPreview() {
    return this.collectSkillIds('deactivate');
  }

  get isApplyDisabled() {
    let roomId = this.args.model.roomId?.trim();
    return !this.hasCommandContext || this.isExecuting || !roomId;
  }

  get pendingChangesSummary() {
    let activateCount = this.activationPreview.length;
    let deactivateCount = this.deactivationPreview.length;
    if (!activateCount && !deactivateCount) {
      return 'No skill changes selected yet.';
    }
    return `Will activate ${activateCount} skill${
      activateCount === 1 ? '' : 's'
    } and disable ${deactivateCount} skill${deactivateCount === 1 ? '' : 's'}.`;
  }

  private collectSkillIds(kind: 'activate' | 'deactivate') {
    let manualInput =
      kind === 'activate'
        ? this.args.model.manualActivationTargets
        : this.args.model.manualDeactivationTargets;
    let manualIds = parseSkillInput(manualInput);
    let presetIds =
      kind === 'activate' ? this.activationPresets : this.deactivationPresets;

    let skillsRealmURL = this.finalSkillsRealmURL;
    let combined = [...presetIds, ...manualIds];
    let normalized = new Set<string>();
    for (let raw of combined) {
      let skillId = normalizeSkillId(raw, skillsRealmURL);
      if (skillId) {
        normalized.add(skillId);
      }
    }

    return [...normalized];
  }

  private removeFromPresets(skillId: string, kind: 'activate' | 'deactivate') {
    if (kind === 'activate') {
      this.activationPresets = this.activationPresets.filter(
        (id) => id !== skillId,
      );
    } else {
      this.deactivationPresets = this.deactivationPresets.filter(
        (id) => id !== skillId,
      );
    }
  }

  private addToPresets(skillId: string, kind: 'activate' | 'deactivate') {
    if (kind === 'activate') {
      if (!this.activationPresets.includes(skillId)) {
        this.activationPresets = [...this.activationPresets, skillId];
      }
    } else if (!this.deactivationPresets.includes(skillId)) {
      this.deactivationPresets = [...this.deactivationPresets, skillId];
    }
  }

  @action
  updateSkillsRealmURL(event: Event) {
    let input = event.target as HTMLInputElement | null;
    this.skillsRealmURL = ensureTrailingSlash(input?.value ?? '');
    this.clearMessages();
  }

  @action
  updateRoomId(event: Event) {
    let input = event.target as HTMLInputElement | null;
    this.args.model.roomId = input?.value ?? '';
    this.clearMessages();
  }

  @action
  updateManualList(kind: 'activate' | 'deactivate', event: Event) {
    let input = event.target as HTMLTextAreaElement | null;
    if (kind === 'activate') {
      this.args.model.manualActivationTargets = input?.value ?? '';
    } else {
      this.args.model.manualDeactivationTargets = input?.value ?? '';
    }
    this.clearMessages();
  }

  @action
  togglePreset(kind: 'activate' | 'deactivate', skillId: string) {
    if (kind === 'activate') {
      if (this.activationPresets.includes(skillId)) {
        this.removeFromPresets(skillId, 'activate');
      } else {
        this.addToPresets(skillId, 'activate');
        this.removeFromPresets(skillId, 'deactivate');
      }
    } else {
      if (this.deactivationPresets.includes(skillId)) {
        this.removeFromPresets(skillId, 'deactivate');
      } else {
        this.addToPresets(skillId, 'deactivate');
        this.removeFromPresets(skillId, 'activate');
      }
    }
    this.clearMessages();
  }

  @action
  isPresetSelected(kind: 'activate' | 'deactivate', skillId: string) {
    if (kind === 'activate') {
      return this.activationPresets.includes(skillId);
    }
    return this.deactivationPresets.includes(skillId);
  }

  private clearMessages() {
    this.statusMessage = null;
    this.errorMessage = null;
  }

  @action
  async applySkills(event?: Event) {
    event?.preventDefault();
    if (this.isApplyDisabled) {
      return;
    }

    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.errorMessage =
        'Command context is not available. Open this card inside the host app.';
      return;
    }

    let roomId = this.args.model.roomId?.trim();
    if (!roomId) {
      this.errorMessage =
        'Provide a Matrix room ID before running the command.';
      return;
    }

    let skillCardIdsToActivate = this.collectSkillIds('activate');
    let skillCardIdsToDeactivate = this.collectSkillIds('deactivate');

    if (
      skillCardIdsToActivate.length === 0 &&
      skillCardIdsToDeactivate.length === 0
    ) {
      this.errorMessage =
        'Select at least one skill to activate or deactivate.';
      return;
    }

    this.isExecuting = true;
    this.statusMessage = null;
    this.errorMessage = null;

    try {
      let command = new UpdateRoomSkillsCommand(commandContext);
      await command.execute({
        roomId,
        skillCardIdsToActivate,
        skillCardIdsToDeactivate,
      });

      this.statusMessage = `Updated ${roomId}. Activated ${
        skillCardIdsToActivate.length
      } skill${skillCardIdsToActivate.length === 1 ? '' : 's'} and disabled ${
        skillCardIdsToDeactivate.length
      } skill${skillCardIdsToDeactivate.length === 1 ? '' : 's'}.`;
    } catch (error) {
      let message =
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred while updating room skills.';
      this.errorMessage = message;
    } finally {
      this.isExecuting = false;
    }
  }

  <template>
    {{! template-lint-disable require-input-label }}
    <div class='command-demo'>
      <h1>Update Room Skills Command</h1>
      <p class='intro'>
        Use this card to experiment with
        <code>UpdateRoomSkillsCommand</code>. Provide a Matrix room ID, pick the
        skills you want to toggle, then run the command to publish the new
        configuration.
      </p>

      {{#unless this.hasCommandContext}}
        <div class='notice notice--error'>
          Command context is not available. Open this card inside the host app
          to run commands.
        </div>
      {{/unless}}

      <div class='form-grid'>
        <FieldContainer
          @label='Skills realm base URL (optional)'
          @hint='Used to expand relative skill identifiers such as "boxel-environment".'
        >
          <input
            type='text'
            value={{this.skillsRealmURL}}
            placeholder='https://example.com/skills/'
            {{on 'input' this.updateSkillsRealmURL}}
          />
        </FieldContainer>

        <FieldContainer @label='Room ID'>
          <input
            type='text'
            value={{@model.roomId}}
            placeholder='!room-id:matrix.example'
            {{on 'input' this.updateRoomId}}
          />
        </FieldContainer>

        <FieldContainer
          @label='Activate these skills'
          @hint='Comma or newline separated list.'
        >
          <textarea
            rows='3'
            value={{@model.manualActivationTargets}}
            placeholder='boxel-environment, catalog-listing'
            {{on 'input' (fn this.updateManualList 'activate')}}
          ></textarea>
        </FieldContainer>

        <FieldContainer
          @label='Disable these skills'
          @hint='Comma or newline separated list.'
        >
          <textarea
            rows='3'
            value={{@model.manualDeactivationTargets}}
            placeholder='source-code-editing'
            {{on 'input' (fn this.updateManualList 'deactivate')}}
          ></textarea>
        </FieldContainer>
      </div>

      <div class='presets'>
        <h2>Quick add core skills</h2>
        <p>
          Click
          <strong>Activate</strong>
          or
          <strong>Disable</strong>
          to add a known skill to the respective list. Selecting one side clears
          the other.
        </p>

        <div class='skill-grid'>
          {{#each this.skillOptions as |skill|}}
            <div class='skill-row'>
              <div class='skill-details'>
                <div class='skill-name'>{{skill.title}}</div>
                <div class='skill-id'>{{skill.id}}</div>
              </div>
              <div class='skill-buttons'>
                <button
                  type='button'
                  class='pill pill--activate
                    {{if
                      (this.isPresetSelected "activate" skill.id)
                      "pill--selected"
                    }}'
                  {{on 'click' (fn this.togglePreset 'activate' skill.id)}}
                >
                  Activate
                </button>
                <button
                  type='button'
                  class='pill pill--deactivate
                    {{if
                      (this.isPresetSelected "deactivate" skill.id)
                      "pill--selected"
                    }}'
                  {{on 'click' (fn this.togglePreset 'deactivate' skill.id)}}
                >
                  Disable
                </button>
              </div>
            </div>
          {{/each}}
        </div>
      </div>

      <div class='preview'>
        <h2>Preview payload</h2>
        <p class='summary'>{{this.pendingChangesSummary}}</p>

        <div class='preview-columns'>
          <div class='preview-column'>
            <h3>Will activate</h3>
            {{#if this.activationPreview.length}}
              <ul>
                {{#each this.activationPreview as |skillId|}}
                  <li>{{skillId}}</li>
                {{/each}}
              </ul>
            {{else}}
              <p>None selected.</p>
            {{/if}}
          </div>

          <div class='preview-column'>
            <h3>Will disable</h3>
            {{#if this.deactivationPreview.length}}
              <ul>
                {{#each this.deactivationPreview as |skillId|}}
                  <li>{{skillId}}</li>
                {{/each}}
              </ul>
            {{else}}
              <p>None selected.</p>
            {{/if}}
          </div>
        </div>
      </div>

      {{#if this.statusMessage}}
        <div class='notice notice--success'>{{this.statusMessage}}</div>
      {{/if}}

      {{#if this.errorMessage}}
        <div class='notice notice--error'>{{this.errorMessage}}</div>
      {{/if}}

      <Button
        class='apply-button'
        @appearance='primary'
        disabled={{this.isApplyDisabled}}
        {{on 'click' this.applySkills}}
      >
        {{if this.isExecuting 'Updating skills…' 'Run UpdateRoomSkillsCommand'}}
      </Button>
    </div>

    <style scoped>
      .command-demo {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-lg);
        max-width: 960px;
      }

      h1 {
        margin: 0;
        font-size: 1.75rem;
      }

      .intro {
        margin: 0;
        color: var(--boxel-600);
        line-height: 1.4;
      }

      .form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: var(--boxel-sp-lg);
      }

      input,
      textarea {
        width: 100%;
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-sm);
        font: inherit;
        box-sizing: border-box;
      }

      textarea {
        min-height: 90px;
        resize: vertical;
      }

      .presets {
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-lg);
        background: var(--boxel-0);
      }

      .skill-grid {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        margin-top: var(--boxel-sp);
      }

      .skill-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
      }

      .skill-details {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .skill-name {
        font-weight: 600;
      }

      .skill-id {
        font-family: monospace;
        font-size: 0.85rem;
        color: var(--boxel-600);
      }

      .skill-buttons {
        display: flex;
        gap: var(--boxel-sp-sm);
      }

      .pill {
        border: 1px solid var(--boxel-300);
        border-radius: 9999px;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        background: var(--boxel-150);
        font-size: 0.9rem;
        cursor: pointer;
      }

      .pill--activate {
        border-color: var(--boxel-green-300);
      }

      .pill--deactivate {
        border-color: var(--boxel-red-300);
      }

      .pill--selected {
        background: var(--boxel-highlight);
        border-color: var(--boxel-highlight);
      }

      .preview {
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-lg);
      }

      .summary {
        margin-top: 0;
        color: var(--boxel-600);
      }

      .preview-columns {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: var(--boxel-sp-lg);
      }

      .preview-column ul {
        margin: 0;
        padding-left: var(--boxel-sp-lg);
        font-family: monospace;
        word-break: break-all;
      }

      .notice {
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
      }

      .notice--success {
        background: var(--boxel-green-50);
        border: 1px solid var(--boxel-green-200);
      }

      .notice--error {
        background: var(--boxel-red-50);
        border: 1px solid var(--boxel-red-200);
      }

      .apply-button {
        align-self: flex-start;
      }
    </style>
  </template>
}

export class UpdateRoomSkillsExample extends CardDef {
  static displayName = 'Update Room Skills Command';

  @field roomId = contains(StringField);
  @field manualActivationTargets = contains(StringField);
  @field manualDeactivationTargets = contains(StringField);

  static isolated = Isolated;
}
