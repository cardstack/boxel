import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
} from './card-api';
import BooleanField from './boolean';
import StringField from './string';
import {
  findDuplicateRoutingPaths,
  validateRoutingPath,
} from '@cardstack/runtime-common';
import { BoxelInputGroup } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import FileSettingsIcon from '@cardstack/boxel-icons/file-settings';
import LinkIcon from '@cardstack/boxel-icons/link';
import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import type { ComponentLike } from '@glint/template';

class RoutingRuleAtom extends Component<typeof RoutingRuleField> {
  <template>
    <span class='routing-rule-atom'>
      <span class='path'>{{if @model.path @model.path '(no path)'}}</span>
      {{#if @model.instance}}
        <span class='arrow' aria-hidden='true'>→</span>
        <@fields.instance @format='atom' />
      {{/if}}
    </span>
    <style scoped>
      .routing-rule-atom {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }
      .path {
        font-family: var(--boxel-font-family-mono, monospace);
      }
      .arrow {
        opacity: 0.6;
      }
    </style>
  </template>
}

class RoutingRuleEdit extends Component<typeof RoutingRuleField> {
  get pathWarning(): string | undefined {
    return validateRoutingPath(this.args.model.path);
  }

  // The stored path always carries a leading "/", but the input only
  // ever shows what comes after it — the "/" is rendered as a fixed
  // accessory in front of the input. Users can't backspace through it
  // because it's not part of the editable text.
  get pathInputValue(): string {
    let raw = this.args.model.path ?? '';
    return raw.startsWith('/') ? raw.slice(1) : raw;
  }

  @action
  setPathFromInput(value: string) {
    // Strip any extra leading slashes from typed/pasted input — the
    // accessory already provides exactly one.
    let trimmed = (value ?? '').replace(/^\/+/, '');
    this.args.model.path = `/${trimmed}`;
  }

  <template>
    <div class='routing-rule-edit' data-test-routing-rule-edit>
      <div class='row'>
        <div class='path-cell'>
          <BoxelInputGroup
            @value={{this.pathInputValue}}
            @onInput={{this.setPathFromInput}}
            data-test-path-input
          >
            <:before as |Accessories|>
              <Accessories.Text>/</Accessories.Text>
            </:before>
          </BoxelInputGroup>
        </div>
        <span class='arrow' aria-hidden='true'>→</span>
        <div class='instance-cell'>
          <@fields.instance @lockConsumingRealm={{true}} />
        </div>
      </div>
      {{#if this.pathWarning}}
        <div class='path-warning' role='status' data-test-path-warning>
          {{this.pathWarning}}
        </div>
      {{/if}}
    </div>
    <style scoped>
      .routing-rule-edit {
        display: grid;
        gap: var(--boxel-sp-xxs);
      }
      .row {
        display: grid;
        grid-template-columns: minmax(8rem, 14rem) auto 1fr;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .path-cell :deep(input) {
        font-family: var(--boxel-font-family-mono, monospace);
      }
      .arrow {
        color: var(--boxel-450);
        font-size: var(--boxel-font-size);
        user-select: none;
      }
      .instance-cell {
        min-width: 0;
      }
      .path-warning {
        font-size: var(--boxel-font-size-xs);
        color: #92400e;
        padding-left: var(--boxel-sp-xxs);
      }
    </style>
  </template>
}

export class RoutingRuleField extends FieldDef {
  static displayName = 'Routing Rule';
  static icon = LinkIcon;

  @field path = contains(StringField, {
    description: 'Static path within the realm, e.g. "/" or "/pricing"',
  });

  @field instance = linksTo(CardDef, {
    description:
      'Card instance to render when the realm is navigated at this path',
  });

  static atom = RoutingRuleAtom;
  static edit = RoutingRuleEdit;
}

class RealmConfigEmbedded extends Component<typeof RealmConfig> {
  <template>
    <div class='realm-config-embedded' data-test-realm-config-embedded>
      {{#if @model.iconURL}}
        <img class='icon' src={{@model.iconURL}} alt='' />
      {{else}}
        <FileSettingsIcon class='icon' />
      {{/if}}
      <span class='title'>{{@model.cardTitle}}</span>
      <span class='rule-count'>
        {{@model.hostRoutingRules.length}}
        routing
        {{if (eq @model.hostRoutingRules.length 1) 'rule' 'rules'}}
      </span>
    </div>
    <style scoped>
      .realm-config-embedded {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
      }
      .icon {
        width: var(--boxel-icon-med);
        height: var(--boxel-icon-med);
        border-radius: var(--boxel-border-radius-sm);
        flex-shrink: 0;
      }
      .title {
        font: 600 var(--boxel-font);
      }
      .rule-count {
        color: var(--boxel-450);
        font: var(--boxel-font-sm);
        margin-left: auto;
      }
    </style>
  </template>
}

// Wrap-style editor wired via the per-usage `edit:` option on the
// hostRoutingRules field. Receives `@model` (the realm config card),
// `@values` (the current rules array), and `@defaultEditor` (the
// pre-bound default ContainsManyEditor) — adds a cross-rule advisory
// banner above the standard iteration / add / remove UI, without
// reimplementing it.
class RealmConfigRoutingRulesEditor extends GlimmerComponent<{
  Args: {
    model: RealmConfig;
    values: RoutingRuleField[];
    defaultEditor: ComponentLike<{}>;
  };
  Element: HTMLElement;
}> {
  get duplicatePaths(): string[] {
    return findDuplicateRoutingPaths(this.args.values);
  }

  <template>
    {{#if this.duplicatePaths.length}}
      <div
        class='warning'
        role='status'
        data-test-duplicate-path-warning
      >
        Duplicate paths:
        {{#each this.duplicatePaths as |p i|}}
          {{#if i}}, {{/if}}<code>{{p}}</code>
        {{/each}}
      </div>
    {{/if}}
    <@defaultEditor />
    <style scoped>
      .warning {
        background: #fef3c7;
        color: #78350f;
        border: 1px solid #fcd34d;
        border-radius: var(--boxel-border-radius-sm, 6px);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        font-size: var(--boxel-font-size-sm);
        margin-bottom: var(--boxel-sp-xs);
      }
      .warning code {
        font-family: var(--boxel-font-family-mono, monospace);
        background: rgba(0, 0, 0, 0.05);
        padding: 0 4px;
        border-radius: 3px;
      }
    </style>
  </template>
}

class RealmConfigIsolated extends Component<typeof RealmConfig> {
  <template>
    <article class='realm-config-isolated' data-test-realm-config-isolated>
      <header class='header'>
        {{#if @model.iconURL}}
          <img class='icon' src={{@model.iconURL}} alt='' />
        {{else}}
          <FileSettingsIcon class='icon' />
        {{/if}}
        <h1 class='title'>{{@model.cardTitle}}</h1>
      </header>

      <section class='section'>
        <h2 class='section-title'>Host Routing Rules</h2>
        {{#if @model.hostRoutingRules.length}}
          <ul class='rules' data-test-routing-rules>
            {{#each @model.hostRoutingRules as |rule|}}
              <li class='rule'>{{rule.path}}
                {{#if rule.instance}}
                  <span class='arrow' aria-hidden='true'>→</span>
                  {{rule.instance.title}}
                {{/if}}
              </li>
            {{/each}}
          </ul>
        {{else}}
          <p class='empty' data-test-routing-rules-empty>
            No routing rules configured.
          </p>
        {{/if}}
      </section>
    </article>
    <style scoped>
      .realm-config-isolated {
        padding: var(--boxel-sp-lg);
        display: grid;
        gap: var(--boxel-sp-lg);
      }
      .header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
      }
      .icon {
        width: var(--boxel-icon-xl);
        height: var(--boxel-icon-xl);
        border-radius: var(--boxel-border-radius);
      }
      .title {
        font: 700 var(--boxel-font-lg);
        margin: 0;
      }
      .section-title {
        font: 600 var(--boxel-font);
        margin: 0 0 var(--boxel-sp-xs);
      }
      .rules {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp-xxs);
      }
      .rule {
        font-family: var(--boxel-font-family-mono, monospace);
        font-size: var(--boxel-font-size-sm);
      }
      .arrow {
        opacity: 0.6;
        margin: 0 var(--boxel-sp-xxs);
      }
      .empty {
        color: var(--boxel-450);
      }
    </style>
  </template>
}

export class RealmConfig extends CardDef {
  static displayName = 'Realm Config';
  static icon = FileSettingsIcon;

  @field backgroundURL = contains(StringField);
  @field iconURL = contains(StringField);
  @field hostRoutingRules = containsMany(RoutingRuleField, {
    edit: RealmConfigRoutingRulesEditor,
  });
  // Opt-in to keeping the full prerendered isolated HTML for the
  // realm's default CardsGrid index card. Default behaviour for this
  // card writes a small boilerplate placeholder instead — the
  // CardsGrid isolated render fans out into a fitted render per card
  // in the realm and dominates indexing wall-clock on larger realms,
  // and nothing reads its isolated HTML in production for an
  // unpublished realm. Set this to `true` when the realm's index is
  // served as published-realm SSR (the publish handler writes it
  // automatically in that case) or when an operator otherwise needs
  // the full isolated render present in the index.
  @field includePrerenderedDefaultRealmIndex = contains(BooleanField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: RealmConfig) {
      let name = this.cardInfo?.name?.trim();
      return name ? `${name} Config` : `Untitled ${RealmConfig.displayName}`;
    },
  });

  static embedded = RealmConfigEmbedded;
  static isolated = RealmConfigIsolated;
}
