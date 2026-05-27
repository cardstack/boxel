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
import { eq } from '@cardstack/boxel-ui/helpers';
import FileSettingsIcon from '@cardstack/boxel-icons/file-settings';
import LinkIcon from '@cardstack/boxel-icons/link';

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
  <template>
    <div class='routing-rule-edit' data-test-routing-rule-edit>
      <label class='field'>
        <span class='label'>Path</span>
        <@fields.path />
      </label>
      <label class='field'>
        <span class='label'>Instance</span>
        <@fields.instance @lockConsumingRealm={{true}} />
      </label>
    </div>
    <style scoped>
      .routing-rule-edit {
        display: grid;
        gap: var(--boxel-sp-sm);
      }
      .field {
        display: grid;
        gap: var(--boxel-sp-xxs);
      }
      .label {
        font: 600 var(--boxel-font-sm);
        color: var(--boxel-450);
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
  @field hostRoutingRules = containsMany(RoutingRuleField);
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
