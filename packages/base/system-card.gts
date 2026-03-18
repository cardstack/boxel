import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksToMany,
  linksTo,
} from './card-api';
import BooleanField from './boolean';
import StringField from './string';
import enumField from './enum';
import { getMenuItems } from '@cardstack/runtime-common';
import { type GetMenuItemParams } from './menu-items';
import { type MenuItemOptions, MenuItem } from '@cardstack/boxel-ui/helpers';
import SetUserSystemCardCommand from '@cardstack/boxel-host/commands/set-user-system-card';
import GetUserSystemCardCommand from '@cardstack/boxel-host/commands/get-user-system-card';
import {
  BoxelButton,
  BoxelDropdown,
  Menu as BoxelMenu,
} from '@cardstack/boxel-ui/components';
import AppsIcon from '@cardstack/boxel-icons/apps';
import CopyCardToRealmCommand from '@cardstack/boxel-host/commands/copy-card';
import GetAllRealmMetasCommand from '@cardstack/boxel-host/commands/get-all-realm-metas';
import ShowCardCommand from '@cardstack/boxel-host/commands/show-card';
import { on } from '@ember/modifier';
import { restartableTask, task } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { commandData } from './resources/command-data';
import type {
  GetAllRealmMetasResult,
  RealmMetaField,
} from './command';

const ReasoningEffortField = enumField(StringField, {
  options: [
    { value: '', label: 'None' },
    { value: 'minimal', label: 'Minimal' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra High' },
  ],
});

export class ModelConfiguration extends CardDef {
  static displayName = 'Model Configuration';

  @field modelId = contains(StringField, {
    description: 'The openrouter identifier for the LLM model',
  });

  @field toolsSupported = contains(BooleanField, {
    description: 'Whether this model configuration supports tool usage',
  });

  @field reasoningEffort = contains(ReasoningEffortField, {
    description:
      'Optional reasoning effort to pass when invoking this model',
  });

  @field inputModalities = containsMany(StringField, {
    description:
      'Input modalities supported by this model (e.g. text, image, file, audio, video)',
  });
}

export class SystemCard extends CardDef {
  static displayName = 'System Card';

  @field defaultModelConfiguration = linksTo(ModelConfiguration, {
    description:
      'Preferred model configuration to use when no specific mode default exists',
  });

  @field modelConfigurations = linksToMany(ModelConfiguration, {
    description: 'List of available model configurations for this system',
  });

  [getMenuItems](params: GetMenuItemParams): MenuItemOptions[] {
    let menuItems = super[getMenuItems](params);
    menuItems = [
      {
        label: 'Set as My System Card',
        action: async () => {
          await new SetUserSystemCardCommand(params.commandContext).execute({
            cardId: this.id,
          });
        },
        icon: AppsIcon,
        tags: ['system-card'],
      },
      ...menuItems,
    ];

    return menuItems;
  }
}

class SystemCardIsolated extends Component<typeof SystemCard> {
  @tracked activeSystemCardId: string | undefined;
  @tracked activeIsDefault = false;
  @tracked hasLoaded = false;
  @tracked isExpanded = false;
  @tracked cloningToRealmName: string | undefined;

  constructor(owner: any, args: any) {
    super(owner, args);
    this.loadActiveSystemCard.perform();
  }

  loadActiveSystemCard = restartableTask(async () => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.hasLoaded = true;
      return;
    }
    try {
      let result =
        await new GetUserSystemCardCommand(commandContext).execute();
      this.activeSystemCardId = result.cardId ?? undefined;
      this.activeIsDefault = result.isDefault ?? false;
    } finally {
      this.hasLoaded = true;
    }
  });

  get isActive(): boolean {
    return (
      this.hasLoaded &&
      !!this.args.model.id &&
      this.activeSystemCardId === this.args.model.id
    );
  }

  get isInactive(): boolean {
    return (
      this.hasLoaded &&
      !!this.activeSystemCardId &&
      this.activeSystemCardId !== this.args.model.id
    );
  }

  allRealmsInfoResource = commandData<typeof GetAllRealmMetasResult>(
    this,
    GetAllRealmMetasCommand,
  );

  get writableRealms(): { name: string; url: string; iconURL?: string }[] {
    let commandResource = this.allRealmsInfoResource;
    if (commandResource?.isSuccess && commandResource.cardResult) {
      let result = commandResource.cardResult as GetAllRealmMetasResult;
      if (result.results) {
        return result.results
          .filter((realmMeta: RealmMetaField) => realmMeta.canWrite)
          .map((realmMeta: RealmMetaField) => ({
            name: realmMeta.info.name,
            url: realmMeta.url,
            iconURL: realmMeta.info.iconURL ?? undefined,
          }));
      }
    }
    return [];
  }

  get realmMenuItems() {
    return this.writableRealms.map((realm) => {
      return new MenuItem({
        label: realm.name,
        action: () => {
          this.cloneTask.perform(realm.url, realm.name);
        },
        iconURL: realm.iconURL ?? '/default-realm-icon.png',
      });
    });
  }

  get cloneButtonLabel(): string {
    if (this.cloneTask.isRunning && this.cloningToRealmName) {
      return `Cloning to ${this.cloningToRealmName}`;
    }
    return 'Clone';
  }

  cloneTask = task(async (targetRealmUrl: string, realmName: string) => {
    this.cloningToRealmName = realmName;
    let commandContext = this.args.context?.commandContext;
    if (!commandContext || !this.args.model.id) {
      this.cloningToRealmName = undefined;
      return;
    }
    try {
      let copyResult = await new CopyCardToRealmCommand(
        commandContext,
      ).execute({
        sourceCard: this.args.model as CardDef,
        targetRealm: targetRealmUrl,
      });
      if (copyResult.newCardId) {
        await new ShowCardCommand(commandContext).execute({
          cardId: copyResult.newCardId,
          format: 'isolated',
        });
      }
    } finally {
      this.cloningToRealmName = undefined;
    }
  });

  toggleExpanded = () => {
    this.isExpanded = !this.isExpanded;
  };

  navigateToActive = async () => {
    if (this.activeSystemCardId && this.args.viewCard) {
      await this.args.viewCard(new URL(this.activeSystemCardId), 'isolated');
    }
  };

  setAsActive = () => {
    this.setAsActiveTask.perform();
  };

  setAsActiveTask = restartableTask(async () => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext || !this.args.model.id) {
      return;
    }
    await new SetUserSystemCardCommand(commandContext).execute({
      cardId: this.args.model.id,
    });
    this.activeSystemCardId = this.args.model.id;
    // Re-check default status after setting active
    let result =
      await new GetUserSystemCardCommand(commandContext).execute();
    this.activeIsDefault = result.isDefault ?? false;
    this.isExpanded = false;
  });

  restoreDefault = () => {
    this.restoreDefaultTask.perform();
  };

  restoreDefaultTask = restartableTask(async () => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      return;
    }
    await new SetUserSystemCardCommand(commandContext).execute({});
    // Reload to pick up the new active system card (the default)
    let result =
      await new GetUserSystemCardCommand(commandContext).execute();
    this.activeSystemCardId = result.cardId ?? undefined;
    this.activeIsDefault = result.isDefault ?? false;
    this.isExpanded = false;
  });

  <template>
    <div class='system-card-isolated'>
      <div class='top-bar'>
        {{#if this.hasLoaded}}
          {{#unless this.cloneTask.isRunning}}
            {{#if this.isActive}}
              <button
                class='status-badge active {{if this.isExpanded "expanded"}}'
                type='button'
                aria-expanded={{if this.isExpanded "true" "false"}}
                {{on 'click' this.toggleExpanded}}
              >
                Active System Card
                <svg class='chevron' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>
              </button>
            {{else if this.isInactive}}
              <button
                class='status-badge inactive {{if this.isExpanded "expanded"}}'
                type='button'
                aria-expanded={{if this.isExpanded "true" "false"}}
                {{on 'click' this.toggleExpanded}}
              >
                Inactive
                <svg class='chevron' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>
              </button>
            {{/if}}
          {{/unless}}
        {{/if}}

        <BoxelDropdown>
          <:trigger as |bindings|>
            <BoxelButton
              @kind='secondary'
              @size='small'
              @loading={{this.cloneTask.isRunning}}
              @disabled={{this.cloneTask.isRunning}}
              {{bindings}}
            >
              {{this.cloneButtonLabel}}
            </BoxelButton>
          </:trigger>
          <:content as |dd|>
            <BoxelMenu
              class='realm-dropdown-menu'
              @closeMenu={{dd.close}}
              @items={{this.realmMenuItems}}
            />
          </:content>
        </BoxelDropdown>
      </div>

      {{#if this.hasLoaded}}
        {{#unless this.cloneTask.isRunning}}
          {{#if this.isExpanded}}
            <div class='badge-panel-container'>
              {{#if this.isActive}}
                <div class='badge-panel'>
                  <span class='panel-label'>This system card is currently active.</span>
                  {{#unless this.activeIsDefault}}
                    <BoxelButton
                      @kind='secondary'
                      @size='small'
                      class='panel-action'
                      {{on 'click' this.restoreDefault}}
                    >
                      Restore default system card
                    </BoxelButton>
                  {{/unless}}
                </div>
              {{else if this.isInactive}}
                <div class='badge-panel'>
                  <div class='panel-row'>
                    <span class='panel-label'>Currently active:</span>
                    <BoxelButton
                      @kind='text-only'
                      @size='small'
                      class='panel-link'
                      {{on 'click' this.navigateToActive}}
                    >
                      {{this.activeSystemCardId}}
                    </BoxelButton>
                  </div>
                  <BoxelButton
                    @kind='primary-dark'
                    @size='small'
                    class='panel-action'
                    {{on 'click' this.setAsActive}}
                  >
                    Make This My System Card
                  </BoxelButton>
                </div>
              {{/if}}
            </div>
          {{/if}}
        {{/unless}}
      {{/if}}

      <div class='system-card-content'>
        <@fields.defaultModelConfiguration />
        <@fields.modelConfigurations />
      </div>
    </div>

    <style scoped>
      .system-card-isolated {
        position: relative;
        padding: var(--boxel-sp-lg);
      }

      .top-bar {
        position: absolute;
        top: var(--boxel-sp-sm);
        right: var(--boxel-sp-sm);
        z-index: 1;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }

      .status-badge {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-sm);
        border: none;
        cursor: pointer;
        transition: filter 0.15s;
      }

      .status-badge:hover {
        filter: brightness(0.95);
      }

      .status-badge.active {
        background: #d1fae5;
        color: #065f46;
      }

      .status-badge.inactive {
        background: var(--boxel-100, #f3f4f6);
        color: var(--boxel-500, #6b7280);
      }

      .status-badge.expanded {
        filter: brightness(0.95);
      }

      .chevron {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        transition: transform 0.15s;
      }

      .status-badge.expanded .chevron {
        transform: rotate(180deg);
      }

      .badge-panel {
        background: var(--boxel-light, #ffffff);
        border: 1px solid var(--boxel-200, #e8e8e8);
        border-radius: var(--boxel-border-radius-sm);
        padding: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        min-width: 240px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      }

      .panel-row {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-6xs);
      }

      .panel-label {
        font-size: var(--boxel-font-size-xs);
        color: var(--boxel-500, #6b7280);
        font-weight: 500;
      }

      .panel-link {
        text-decoration: underline;
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
        font-size: var(--boxel-font-size-xs);
        color: var(--boxel-dark, #272330);
      }

      .panel-action {
        width: 100%;
      }

      .badge-panel-container {
        position: absolute;
        top: calc(var(--boxel-sp-sm) + 30px);
        right: var(--boxel-sp-sm);
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
      }

      .realm-dropdown-menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs);
        --boxel-menu-item-gap: var(--boxel-sp-xs);
        min-width: 13rem;
        max-height: 13rem;
        overflow-y: auto;
      }

      .realm-dropdown-menu :deep(.menu-item__icon-url) {
        border-radius: var(--boxel-border-radius-xs);
      }

      .system-card-content {
        padding-top: var(--boxel-sp-sm);
      }
    </style>
  </template>
}

SystemCard.isolated = SystemCardIsolated;
