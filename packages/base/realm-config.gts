import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
  realmURL,
} from './card-api';
import BooleanField from './boolean';
import StringField from './string';
import CardInfoTemplates from './default-templates/card-info';
import {
  cardDefComputedFields,
  findDuplicateRoutingPaths,
  getField,
  getFieldIcon,
  validateRoutingPath,
} from '@cardstack/runtime-common';
import {
  BoxelInputGroup,
  FieldContainer,
  Header,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import FileSettingsIcon from '@cardstack/boxel-icons/file-settings';
import LinkIcon from '@cardstack/boxel-icons/link';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { startCase } from 'lodash';
import type { FieldsTypeFor } from './card-api';

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
  constructor(owner: Owner, args: any) {
    super(owner, args);
    // The path input renders an empty input alongside a fixed `/`
    // accessory, so a rule with `path == null` is visually
    // indistinguishable from one with `path === '/'`. Normalize unset
    // paths to `/` on mount so the data matches what the user sees —
    // unset paths have no runtime meaning anyway, and this lets the
    // duplicate-path warning treat two visually-equal rules as the
    // conflict they really are.
    //
    // The write is deferred past the current render: assigning
    // synchronously would mutate inside the same tracked computation
    // that's already read autoSaveState.isSaving via the saving
    // indicator in the CardHeader, and Glimmer rejects read-then-write
    // on a tracked cell within one computation.
    if (this.args.model.path == null) {
      queueMicrotask(() => {
        if (this.isDestroying || this.isDestroyed) return;
        if (this.args.model.path == null) {
          this.args.model.path = '/';
        }
      });
    }
  }

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

  // The chooser is locked to the consuming realm; pass it through
  // explicitly rather than letting LinksToEditor read it from
  // `RealmURLContext`. The context is only provided by the operator-mode
  // stack item, so in code submode (where the realm config renders via
  // the playground / spec preview, outside any stack item) `this.realmURL`
  // in LinksToEditor is undefined and the chooser falls back to
  // unscoped search across every realm. The field's own `[realmURL]`
  // getter is populated by `propagateRealmContext` when the owning
  // RealmConfig card loads, so it works in either submode.
  get consumingRealm(): URL | undefined {
    return this.args.model[realmURL];
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
          <@fields.instance
            @lockConsumingRealm={{true}}
            @consumingRealm={{this.consumingRealm}}
          />
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
      /* Tighten the gap between the leading "/" accessory and the
         editable text. BoxelInputGroup's accessory + input each carry
         --boxel-input-group-padding-x on the inner-facing side, but
         overriding the var on an ancestor is shadowed by the group's
         own scoped CSS — so the actual consumer classes are
         pierced directly. */
      .path-cell :deep(.text-accessory) {
        padding-right: 0;
      }
      .path-cell :deep(.form-control) {
        padding-left: var(--boxel-sp-xxs);
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

// Custom CardDef edit template. Replicates the standard CardDef edit
// scaffold (CardInfo header, displayFields iteration, notes footer)
// so each field still renders via its own default Component — the
// only RealmConfig-specific addition is a cross-rule advisory banner
// for duplicate routing paths, injected directly above the
// hostRoutingRules row so the warning sits next to the section it
// describes. The scaffolding is kept in sync with
// default-templates/isolated-and-edit.gts.
class RealmConfigEdit extends Component<typeof RealmConfig> {
  private excludedFields: string[] = [
    'id',
    'cardInfo',
    ...cardDefComputedFields,
    'theme',
  ];

  private get cardInfoFieldDisplayNames(): string[] | undefined {
    let fieldNames = cardDefComputedFields.filter((fieldName) => {
      const field = getField(this.args.model.constructor, fieldName);
      return field?.computeVia == undefined;
    });
    return fieldNames.length ? fieldNames : undefined;
  }

  private get displayFields(): FieldsTypeFor<RealmConfig> | undefined {
    let excludedFields = this.excludedFields.filter(
      (name) => !this.cardInfoFieldDisplayNames?.includes(name),
    );
    let fields = Object.entries(this.args.fields).filter(
      ([key]) => !excludedFields.includes(key),
    );
    if (!fields.length) {
      return undefined;
    }
    return Object.fromEntries(fields) as FieldsTypeFor<RealmConfig>;
  }

  get duplicatePaths(): string[] {
    return findDuplicateRoutingPaths(this.args.model.hostRoutingRules);
  }

  // CardInfoTemplates.edit insists on a strict `CardDef` for `@model`;
  // the template arg here is `PartialFields<RealmConfig>` (every field
  // optional, including `id`), so cast to the looser shape it actually
  // exercises.
  get baseModel(): CardDef {
    return this.args.model as unknown as CardDef;
  }

  <template>
    <div class='realm-config-edit' data-test-realm-config-edit>
      <Header @hasBottomBorder={{true}} class='card-info-header'>
        <CardInfoTemplates.edit @fields={{@fields}} @model={{this.baseModel}} />
      </Header>
      {{#if this.displayFields}}
        <section class='own-display-fields'>
          {{#each-in this.displayFields as |key Field|}}
            {{#if (eq key 'hostRoutingRules')}}
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
            {{/if}}
            <FieldContainer
              @label={{startCase key}}
              @icon={{getFieldIcon @model key}}
              data-test-field={{key}}
            >
              <Field />
            </FieldContainer>
          {{/each-in}}
        </section>
      {{/if}}
      <footer class='notes-footer'>
        <FieldContainer
          @label='Notes'
          @icon={{getFieldIcon @model.cardInfo 'notes'}}
          data-test-field='cardInfo-notes'
        >
          <@fields.cardInfo.notes />
        </FieldContainer>
      </footer>
    </div>
    <style scoped>
      .realm-config-edit {
        --hr-color: rgba(0 0 0 / 10%);
        display: grid;
      }
      .card-info-header {
        --boxel-header-min-height: 9.375rem;
        --boxel-header-padding: var(--boxel-sp-xxl) var(--boxel-sp-xl)
          var(--boxel-sp-xl);
        --boxel-header-gap: var(--boxel-sp-lg);
        --boxel-header-border-color: var(--hr-color);
        align-items: flex-start;
        background-color: var(--muted, var(--boxel-100));
      }
      .own-display-fields {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
        background-color: var(--background, var(--boxel-light));
      }
      .own-display-fields + .notes-footer {
        border-top: 1px solid var(--hr-color);
      }
      .notes-footer {
        padding: var(--boxel-sp-xl);
        background-color: var(--muted, var(--boxel-100));
      }
      .warning {
        background: #fef3c7;
        color: #78350f;
        border: 1px solid #fcd34d;
        border-radius: var(--boxel-border-radius-sm, 6px);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        font-size: var(--boxel-font-size-sm);
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
            {{#each @fields.hostRoutingRules as |Rule|}}
              <li class='rule'><Rule @format='atom' /></li>
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
  static edit = RealmConfigEdit;
}
