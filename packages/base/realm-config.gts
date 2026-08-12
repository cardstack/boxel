import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
  getRelationshipMembershipState,
  linksTo,
  realmURL,
} from './card-api';
import BooleanField from './boolean';
import NumberField from './number';
import StringField from './string';
import CardInfoTemplates from './default-templates/card-info';
import {
  cardDefComputedFields,
  DEFAULT_REDIRECT_STATUS,
  findDuplicateRoutingPaths,
  findRedirectCycles,
  getField,
  getFieldIcon,
  REDIRECT_STATUS_CODES,
  validateRedirectTarget,
  validateRoutingPath,
} from '@cardstack/runtime-common';
import {
  Button as BoxelButton,
  BoxelInput,
  BoxelInputGroup,
  BoxelSelect,
  FieldContainer,
  Header,
  RadioInput,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import FileSettingsIcon from '@cardstack/boxel-icons/file-settings';
import LinkIcon from '@cardstack/boxel-icons/link';
import WriteTextFileTool from '@cardstack/boxel-host/tools/write-text-file';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { startCase } from 'lodash-es';
import type { FieldsTypeFor } from './card-api';

class RoutingRuleAtom extends Component<typeof RoutingRuleField> {
  <template>
    <span class='routing-rule-atom'>
      <span class='path'>{{if @model.path @model.path '(no path)'}}</span>
      {{#if @model.redirectTo}}
        <span class='arrow' aria-hidden='true'>→</span>
        <span class='redirect-target' data-test-redirect-target>
          {{@model.redirectTo}}
        </span>
      {{else if @model.instance}}
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
      .path,
      .redirect-target {
        font-family: var(--boxel-font-family-mono, monospace);
      }
      .arrow {
        opacity: 0.6;
      }
    </style>
  </template>
}

class RoutingRuleEdit extends Component<typeof RoutingRuleField> {
  private kindItems: { id: 'card' | 'redirect'; text: string }[] = [
    { id: 'card', text: 'Render a card' },
    { id: 'redirect', text: 'Redirect' },
  ];

  private statusCodeOptions = [...REDIRECT_STATUS_CODES];

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

  // Which target editor is showing, derived from the data alone: a rule
  // carrying a `redirectTo` is a redirect rule. `setKind` seeds an empty
  // string when switching, which reads as a redirect (the field is unset
  // as `undefined`, and `StringField` has no empty value that would
  // blur the two) and so survives a reload. Deliberately not mirrored
  // into component state: field writes notify Glimmer synchronously, so
  // a copy would buy nothing and would go on shadowing the model after
  // anything but this toggle changed it.
  get kind(): 'card' | 'redirect' {
    return this.args.model.redirectTo != null ? 'redirect' : 'card';
  }

  get isRedirect(): boolean {
    return this.kind === 'redirect';
  }

  // Switching kind clears the other kind's target so a rule is never
  // ambiguous (the read path prefers `redirectTo` when both are set,
  // but only a hand-edited realm.json can get into that state).
  @action
  setKind(kind: 'card' | 'redirect') {
    if (kind === 'redirect') {
      this.args.model.instance = undefined;
      if (this.args.model.redirectTo == null) {
        this.args.model.redirectTo = '';
      }
    } else {
      this.args.model.redirectTo = undefined;
      this.args.model.statusCode = undefined;
    }
  }

  get redirectToValue(): string {
    return this.args.model.redirectTo ?? '';
  }

  @action
  setRedirectTo(value: string) {
    this.args.model.redirectTo = value ?? '';
  }

  get redirectWarning(): string | undefined {
    return validateRedirectTarget(this.args.model.redirectTo);
  }

  get selectedStatusCode(): number {
    return this.args.model.statusCode ?? DEFAULT_REDIRECT_STATUS;
  }

  @action
  setStatusCode(code: number | null) {
    if (code == null) {
      return;
    }
    this.args.model.statusCode = code;
  }

  @action
  statusCodeLabel(code: number): string {
    return code === 301 ? '301 · permanent' : '302 · temporary';
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
      <div class='kind-toggle' data-test-routing-rule-kind>
        {{! RadioInput names the group after itself when @name is absent,
            which is what keeps each rule's pair of radios independent. }}
        <RadioInput
          @items={{this.kindItems}}
          @groupDescription='Routing rule target'
          @checkedId={{this.kind}}
          @spacing='compact'
          @hideBorder={{true}}
          as |item|
        >
          <item.component @onChange={{fn this.setKind item.data.id}}>
            {{item.data.text}}
          </item.component>
        </RadioInput>
      </div>
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
        {{#if this.isRedirect}}
          <div class='redirect-cell'>
            <BoxelInput
              @value={{this.redirectToValue}}
              @onInput={{this.setRedirectTo}}
              @placeholder='/path or https://example.com/page'
              data-test-redirect-input
            />
            <div class='status-code-cell'>
              <BoxelSelect
                @options={{this.statusCodeOptions}}
                @selected={{this.selectedStatusCode}}
                @onChange={{this.setStatusCode}}
                data-test-status-code-select
                as |code|
              >
                {{this.statusCodeLabel code}}
              </BoxelSelect>
            </div>
          </div>
        {{else}}
          <div class='instance-cell'>
            <@fields.instance
              @lockConsumingRealm={{true}}
              @consumingRealm={{this.consumingRealm}}
            />
          </div>
        {{/if}}
      </div>
      {{#if this.pathWarning}}
        <div class='path-warning' role='status' data-test-path-warning>
          {{this.pathWarning}}
        </div>
      {{/if}}
      {{#if this.redirectWarning}}
        <div class='path-warning' role='status' data-test-redirect-warning>
          {{this.redirectWarning}}
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
        /* Match the mono input text so the fixed leading "/" reads as part
           of the same path string rather than a separate label. */
        font-family: var(--boxel-font-family-mono, monospace);
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
      /* The target cell shares a 1fr track with the path input and the
         card can render quite narrow (operator-mode stack item), so the
         status picker stacks BELOW the target input rather than beside
         it — side-by-side, their combined minimum width overflows the
         rule container. min-width: 0 (cell and input) lets the track
         shrink the URL input instead of pushing the row wider. */
      .redirect-cell {
        display: grid;
        gap: var(--boxel-sp-xxs);
        min-width: 0;
      }
      .redirect-cell :deep(input) {
        font-family: var(--boxel-font-family-mono, monospace);
        min-width: 0;
      }
      .status-code-cell {
        justify-self: start;
        min-width: 9rem;
        max-width: 100%;
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

  @field redirectTo = contains(StringField, {
    description:
      'Redirect target — a path in this realm (e.g. "/terms") or an external http(s) URL. When set, the path redirects instead of rendering a card',
  });

  @field statusCode = contains(NumberField, {
    description:
      'HTTP status for a redirect rule: 301 (permanent) or 302 (temporary, the default)',
  });

  static atom = RoutingRuleAtom;
  static edit = RoutingRuleEdit;
}

// ---------------------------------------------------------------------------
// The import map, authored.
//
// `deck-multi-package-design.md` §3 puts the authoring surface for a realm's
// import map on this card, and the map itself in a plain file:
//
//   > The card is a convenience, never a dependency. An agent can write
//   > `importmap.json` directly, and the protocol is satisfied. A broken card
//   > def or a slow index cannot stop module resolution.
//
// So these fields are INTENT and the file is TRUTH. Saving this card does not
// change what any module resolves to; writing the file does, which is why
// materializing is an explicit action with a visible preview rather than a
// side effect of typing. The reasons the design gives for materializing at
// save time rather than computing at read time: the server must never run
// realm JS to resolve its own routes, a snapshot must carry its literal map,
// and the map is a default — evaluated once and then plain data — not a
// computed.
//
// Deliberately NOT computed fields. A computed preview would be indexed, and
// indexing is exactly what the read path cannot depend on. The preview below
// is a component getter, built by the same function that builds the bytes, so
// the two cannot drift.
// ---------------------------------------------------------------------------

class ImportPinAtom extends Component<typeof ImportPinField> {
  <template>
    <span class='pin'>
      <code>{{if @model.specifier @model.specifier '(no specifier)'}}</code>
      <span class='arrow' aria-hidden='true'>→</span>
      <code>{{if @model.target @model.target '(unset)'}}</code>
    </span>
    <style scoped>
      .pin {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        font-family: var(--boxel-font-family-mono, monospace);
        font-size: var(--boxel-font-size-sm);
      }
      .arrow {
        opacity: 0.6;
      }
    </style>
  </template>
}

export class ImportPinField extends FieldDef {
  static displayName = 'Import Pin';

  @field specifier = contains(StringField, {
    description:
      'What the source writes, e.g. "three" or a trailing-slash prefix like "@ui/"',
  });

  @field target = contains(StringField, {
    description:
      'What answers to it — a URL, or a path relative to the realm root',
  });

  static atom = ImportPinAtom;
}

class ImportScopeAtom extends Component<typeof ImportScopeField> {
  <template>
    <span class='scope'>
      <code>{{if @model.prefix @model.prefix '(no prefix)'}}</code>
      <span class='count'>{{@model.pins.length}} pinned</span>
    </span>
    <style scoped>
      .scope {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      code {
        font-family: var(--boxel-font-family-mono, monospace);
        font-size: var(--boxel-font-size-sm);
      }
      .count {
        color: var(--boxel-450);
        font-size: var(--boxel-font-size-xs);
      }
    </style>
  </template>
}

export class ImportScopeField extends FieldDef {
  static displayName = 'Import Scope';

  @field prefix = contains(StringField, {
    description:
      'The importer prefix these pins apply to, e.g. "legacy-viewer/". Only modules under it see them.',
  });

  @field pins = containsMany(ImportPinField);

  static atom = ImportScopeAtom;
}

interface ImportMapDocument {
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
}

// The one place the map is built. Both the preview and the bytes come through
// here — a preview assembled separately from what gets written is how a
// control ends up claiming a version the realm is not using.
//
// Entries missing either half are skipped rather than written as empty
// strings: a row half-typed in the editor is not yet a pin, and writing
// `"": ""` would be a resolution rule that matches everything.
function buildImportMap(model: {
  imports?: (Partial<ImportPinField> | undefined)[];
  scopes?: (Partial<ImportScopeField> | undefined)[];
}): ImportMapDocument {
  let imports: Record<string, string> = {};
  for (let pin of model.imports ?? []) {
    if (pin?.specifier && pin?.target) {
      imports[pin.specifier] = pin.target;
    }
  }
  let scopes: Record<string, Record<string, string>> = {};
  for (let scope of model.scopes ?? []) {
    if (!scope?.prefix) {
      continue;
    }
    let table: Record<string, string> = {};
    for (let pin of scope.pins ?? []) {
      if (pin?.specifier && pin?.target) {
        table[pin.specifier] = pin.target;
      }
    }
    scopes[scope.prefix] = table;
  }
  return { imports, scopes };
}

// A specifier listed twice in one table. JSON cannot hold both, so the last
// one silently wins — which reads as "my pin does nothing" much later, in
// whichever module happened to import it.
function duplicateSpecifiers(
  pins: (Partial<ImportPinField> | undefined)[] | undefined,
): string[] {
  let seen = new Set<string>();
  let duplicates = new Set<string>();
  for (let pin of pins ?? []) {
    let specifier = pin?.specifier;
    if (!specifier) {
      continue;
    }
    if (seen.has(specifier)) {
      duplicates.add(specifier);
    }
    seen.add(specifier);
  }
  return [...duplicates];
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

  // What `importmap.json` will contain if it is written now. Built by the
  // same function that builds the bytes, so what is shown is what lands.
  get importMapPreview(): string {
    return JSON.stringify(buildImportMap(this.args.model), null, 2);
  }

  get aliasCollisions(): string[] {
    let collisions = duplicateSpecifiers(this.args.model.imports);
    for (let scope of this.args.model.scopes ?? []) {
      for (let specifier of duplicateSpecifiers(scope?.pins)) {
        collisions.push(`${scope?.prefix ?? '(no prefix)'} · ${specifier}`);
      }
    }
    return collisions;
  }

  @tracked private materializeError: string | undefined;
  @tracked private materializedAt: string | undefined;

  // The explicit write. Not wired to save: editing this card is a statement
  // of intent, and changing what every module in the realm resolves to is a
  // separate decision that should take a deliberate click.
  private materialize = restartableTask(async () => {
    let commandContext = this.args.context?.commandContext;
    let realm = this.args.model[realmURL]?.href;
    if (!commandContext || !realm) {
      this.materializeError =
        'No writable realm in context, so there is nowhere to write the map.';
      return;
    }
    this.materializeError = undefined;
    try {
      await new WriteTextFileTool(commandContext).execute({
        realm,
        path: 'importmap.json',
        content: `${this.importMapPreview}\n`,
        overwrite: true,
      });
      this.materializedAt = new Date().toLocaleTimeString();
    } catch (e: any) {
      this.materializeError = String(e?.message ?? e);
      this.materializedAt = undefined;
    }
  });

  private writeImportMap = () => {
    this.materialize.perform();
  };

  // Redirect rules that chain back on themselves. The realm drops these
  // when it reads the config — a served loop would bounce visitors until
  // the browser gave up — so the path silently stops routing until the
  // owner breaks the ring.
  get redirectLoopPaths(): string[] {
    return findRedirectCycles(this.args.model.hostRoutingRules);
  }

  // Routing rules whose linked target card no longer exists. The
  // `instance` linksTo resolves to a terminal broken-link state once the
  // editor has tried to load it ('not-found' for a 404, 'error' for an
  // upstream failure). Surfacing these lets the owner repair the rule
  // before publishing — a dangling target otherwise degrades that routed
  // path to a 404 placeholder on the published site.
  get danglingRoutingRulePaths(): string[] {
    let rules = this.args.model.hostRoutingRules ?? [];
    let paths: string[] = [];
    for (let rule of rules) {
      if (!rule) {
        continue;
      }
      let slot = getRelationshipMembershipState(
        rule as unknown as CardDef,
        'instance',
      ).membership?.[0];
      if (slot?.kind === 'not-found' || slot?.kind === 'error') {
        paths.push(rule.path ?? '(no path)');
      }
    }
    return paths;
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
              {{#if this.danglingRoutingRulePaths.length}}
                <div
                  class='warning'
                  role='status'
                  data-test-dangling-routing-warning
                >
                  These paths point to a card that no longer exists:
                  {{#each this.danglingRoutingRulePaths as |p i|}}
                    {{#if i}}, {{/if}}<code>{{p}}</code>
                  {{/each}}
                </div>
              {{/if}}
              {{#if this.redirectLoopPaths.length}}
                <div
                  class='warning'
                  role='status'
                  data-test-redirect-loop-warning
                >
                  These redirects loop back on themselves and will not be
                  applied:
                  {{#each this.redirectLoopPaths as |p i|}}
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
      <section class='import-map' data-test-import-map-materialize>
        <h3>importmap.json</h3>
        <p class='explain'>
          The fields above are what you want. This file is what the loader
          reads. Writing it is what changes resolution for every card in this
          realm — until then nothing has moved.
        </p>
        {{#if this.aliasCollisions.length}}
          <div class='warning' role='status' data-test-alias-collision-warning>
            Listed more than once, so only the last would survive:
            {{#each this.aliasCollisions as |c i|}}
              {{#if i}}, {{/if}}<code>{{c}}</code>
            {{/each}}
          </div>
        {{/if}}
        <pre class='preview' data-test-import-map-preview>{{this.importMapPreview}}</pre>
        <div class='actions'>
          <BoxelButton
            @kind='primary'
            @disabled={{this.materialize.isRunning}}
            {{on 'click' this.writeImportMap}}
            data-test-write-import-map
          >
            {{if this.materialize.isRunning 'Writing…' 'Write importmap.json'}}
          </BoxelButton>
          {{#if this.materializedAt}}
            <span class='written' data-test-import-map-written>
              written at
              {{this.materializedAt}}
            </span>
          {{/if}}
        </div>
        {{#if this.materializeError}}
          <div class='warning' role='status' data-test-import-map-error>
            {{this.materializeError}}
          </div>
        {{/if}}
      </section>
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
        --realm-config-padding: var(--boxel-sp-xl);
        --realm-config-hr-color: rgba(0 0 0 / 10%);
        display: grid;
      }
      .card-info-header {
        --boxel-header-min-height: 9.375rem;
        --boxel-header-padding: var(--realm-config-padding);
        --boxel-header-gap: var(--boxel-sp-lg);
        --boxel-header-border-color: var(--realm-config-hr-color);
        background-color: var(--muted);
      }
      .own-display-fields {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--realm-config-padding);
        background-color: var(--background);
      }
      .own-display-fields + .import-map {
        border-top: 1px solid var(--realm-config-hr-color);
      }
      .import-map {
        display: grid;
        gap: var(--boxel-sp-xs);
        padding: var(--realm-config-padding);
        background-color: var(--background);
      }
      .import-map h3 {
        margin: 0;
        font: 600 var(--boxel-font);
        font-family: var(--boxel-font-family-mono, monospace);
      }
      .explain {
        margin: 0;
        color: var(--boxel-450);
        font-size: var(--boxel-font-size-sm);
      }
      .preview {
        margin: 0;
        padding: var(--boxel-sp-xs);
        background: rgba(0, 0, 0, 0.04);
        border-radius: var(--boxel-border-radius-sm, 6px);
        font-family: var(--boxel-font-family-mono, monospace);
        font-size: var(--boxel-font-size-sm);
        overflow-x: auto;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .written {
        color: var(--boxel-450);
        font-size: var(--boxel-font-size-xs);
      }
      .import-map + .notes-footer {
        border-top: 1px solid var(--realm-config-hr-color);
      }
      .notes-footer {
        padding: var(--realm-config-padding);
        background-color: var(--muted);
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

  // Intent, not truth — see the block comment above `ImportPinField`. These
  // describe the map the owner wants; `importmap.json` is what the loader
  // reads, and it only changes when the owner writes it.
  @field imports = containsMany(ImportPinField);
  @field scopes = containsMany(ImportScopeField);
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
