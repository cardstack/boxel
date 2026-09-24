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
import { JsonField } from './json-field';
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
  BoxelInput,
  BoxelInputGroup,
  BoxelSelect,
  Button,
  FieldContainer,
  Header,
  IconButton,
  RadioInput,
} from '@cardstack/boxel-ui/components';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import { IconPlus, IconTrash } from '@cardstack/boxel-ui/icons';
import FileSettingsIcon from '@cardstack/boxel-icons/file-settings';
import LinkIcon from '@cardstack/boxel-icons/link';
import SettingsIcon from '@cardstack/boxel-icons/settings';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import type Owner from '@ember/owner';
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

// The JSON spelling of one setting's value, which is what the table shows and
// what the editor reads back. A string is shown bare so an id or a path reads
// as itself, and quoted wherever reading the bare form back would produce
// something else — the setting whose value is the text "3" comes back as that
// text rather than as the number. Asking `settingValue` is what makes that the
// round-trip itself rather than a rule that has to track it.
function settingText(value: unknown): string {
  if (typeof value === 'string' && settingValue(value) === value) {
    return value;
  }
  return JSON.stringify(value) ?? '';
}

// Text as JSON, or undefined when it is not JSON at all.
function parseSetting(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// The inverse of settingText. Text that parses as JSON is that value; text
// that does not is the string it already is, so an author writing a Matrix id
// or a path never has to quote it.
//
// A number JSON can parse but cannot hold is treated as text it could not
// parse, because the file is where the value ends up: `1e400` parses as
// `Infinity` and would be written as `null`, and `-0` would be written as `0`.
// Keeping those as the characters the author typed is what stops the row from
// naming a type the stored setting does not have.
function settingValue(text: string): unknown {
  let parsed = parseSetting(text.trim());
  if (parsed === undefined) {
    return text;
  }
  if (typeof parsed === 'number' && !Number.isFinite(parsed)) {
    return text;
  }
  if (Object.is(parsed, -0)) {
    return text;
  }
  return parsed;
}

// What a value will be stored as, named for the author, and only where that
// differs from the text in front of them. Typing 3 stores a number and typing
// true stores a flag — the two cases where the table would otherwise read as
// though it held the characters.
function settingTypeNote(text: string): string | undefined {
  let value = settingValue(text);
  if (typeof value === 'string') {
    return undefined;
  }
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'list' : typeof value;
}

// A row that is not a setting yet: one the author added and has not named. A
// row the realm already holds is never this, however it is named, so an
// unrelated edit cannot drop it.
function isUnnamed(row: SettingRow): boolean {
  return row.key === '' && !row.stored;
}

// One row of the settings editor while the author is in it. The map is built
// from the rows on every keystroke rather than edited in place: a key renamed
// a character at a time would otherwise walk the value across a new map entry
// per keystroke and lose it at the first collision.
interface SettingRow {
  id: number;
  key: string;
  text: string;
  // Whether the realm already holds a setting under this row. It is what tells
  // a row the author has not named yet from one whose name is genuinely the
  // empty string — a key JSON can hold and `realmConfig("")` looks up — so the
  // second survives an edit to some other row.
  stored: boolean;
}

class RealmSettingsEdit extends Component<typeof RealmSettingsField> {
  @tracked private rows: SettingRow[] = Object.entries(
    this.args.model ?? {},
  ).map(([key, value], index) => ({
    id: index,
    key,
    text: settingText(value),
    stored: true,
  }));

  private nextId = this.rows.length;

  // Bound rather than written inline: a Matrix id in an attribute string reads
  // to the template linter as a path it should have been given as a binding.
  private valuePlaceholder = '@alice:boxel.ai';

  private get displayRows() {
    return this.rows.map((row, index) => ({
      ...row,
      index,
      typeNote: settingTypeNote(row.text),
    }));
  }

  // Settings the map cannot hold as written, named so the author can see why
  // the row in front of them is not in the realm's configuration. A row with
  // no name is not a setting yet — the ordinary state of one just added — so
  // it is reported as a count rather than as a fault.
  private get unnamedRowCount(): number {
    return this.rows.filter(isUnnamed).length;
  }

  private get duplicateKeyList(): string {
    return this.duplicateKeys.join(', ');
  }

  private get duplicateKeys(): string[] {
    let seen = new Set<string>();
    let duplicates = new Set<string>();
    for (let row of this.rows) {
      if (isUnnamed(row)) {
        continue;
      }
      if (seen.has(row.key)) {
        duplicates.add(row.key);
      }
      seen.add(row.key);
    }
    return [...duplicates];
  }

  @action private setKey(index: number, key: string) {
    this.replace(index, { key });
  }

  @action private setText(index: number, text: string) {
    this.replace(index, { text });
  }

  @action private add() {
    this.rows = [
      ...this.rows,
      { id: this.nextId++, key: '', text: '', stored: false },
    ];
    this.commit();
  }

  @action private remove(index: number) {
    this.rows = this.rows.filter((_row, at) => at !== index);
    this.commit();
  }

  private replace(index: number, patch: Partial<SettingRow>) {
    this.rows = this.rows.map((row, at) =>
      at === index ? { ...row, ...patch } : row,
    );
    this.commit();
  }

  // A named row wins over an earlier one with the same name, which is what the
  // stored JSON would do with the duplicate anyway; the advisory above the
  // table is what tells the author the shadowed row is not being read.
  private commit() {
    // Built on a null prototype so every name is an own key. A plain object
    // would answer a setting named `__proto__` by invoking the prototype
    // setter — the setting would vanish, and a structured value would become
    // this map's prototype. `JSON.parse` makes that name an own property, so a
    // realm really can hold one, and it renders here until the first edit.
    // The read sides are careful about the same name, and this matches them.
    let settings: Record<string, unknown> = Object.create(null);
    for (let row of this.rows) {
      if (isUnnamed(row)) {
        continue;
      }
      // Written under the name as typed, never a tidied version of it. JSON
      // holds `" approver "` and `""` as keys distinct from `"approver"`, and
      // a program looks one up by the characters it was given — so trimming
      // here would rename a realm's setting out from under a program that
      // reads it, on an edit to some unrelated row.
      settings[row.key] = settingValue(row.text);
    }
    this.args.set(settings);
  }

  <template>
    <div class='realm-settings-edit' data-test-realm-settings-edit>
      {{#if this.displayRows.length}}
        <table class='settings'>
          <thead>
            <tr>
              <th scope='col'>Setting</th>
              <th scope='col'>Value</th>
              {{#if @canEdit}}
                <th scope='col'><span class='visually-hidden'>Remove</span></th>
              {{/if}}
            </tr>
          </thead>
          <tbody>
            {{#each this.displayRows key='id' as |row|}}
              <tr data-test-realm-setting-row={{row.index}}>
                <td class='key-cell'>
                  <BoxelInput
                    @value={{row.key}}
                    @onInput={{fn this.setKey row.index}}
                    @disabled={{not @canEdit}}
                    @placeholder='approver'
                    data-test-setting-key={{row.index}}
                  />
                </td>
                <td class='value-cell'>
                  <BoxelInput
                    @value={{row.text}}
                    @onInput={{fn this.setText row.index}}
                    @disabled={{not @canEdit}}
                    @placeholder={{this.valuePlaceholder}}
                    data-test-setting-value={{row.index}}
                  />
                  {{#if row.typeNote}}
                    <span
                      class='type-note'
                      data-test-setting-type={{row.index}}
                    >
                      stored as
                      {{row.typeNote}}
                    </span>
                  {{/if}}
                </td>
                {{#if @canEdit}}
                  <td class='remove-cell'>
                    <IconButton
                      @icon={{IconTrash}}
                      @width='18px'
                      @height='18px'
                      {{on 'click' (fn this.remove row.index)}}
                      aria-label='Remove setting'
                      data-test-remove-setting={{row.index}}
                    />
                  </td>
                {{/if}}
              </tr>
            {{/each}}
          </tbody>
        </table>
      {{else}}
        <p class='empty' data-test-realm-settings-empty>
          No settings. An operation that reads one fails, naming the realm.
        </p>
      {{/if}}
      {{#if this.duplicateKeys.length}}
        <div
          class='settings-warning'
          role='status'
          data-test-duplicate-settings
        >
          Repeated
          {{if (eq this.duplicateKeys.length 1) 'setting' 'settings'}}
          {{this.duplicateKeyList}}
          — the last row with a given name is the one the realm reads.
        </div>
      {{/if}}
      {{#if this.unnamedRowCount}}
        <div class='settings-warning' role='status' data-test-unnamed-settings>
          {{this.unnamedRowCount}}
          unnamed
          {{if (eq this.unnamedRowCount 1) 'row is' 'rows are'}}
          not stored until given a name.
        </div>
      {{/if}}
      {{#if @canEdit}}
        <Button
          @kind='secondary'
          @size='small'
          {{on 'click' this.add}}
          data-test-add-setting
        >
          <IconPlus width='12px' height='12px' role='presentation' />
          Add setting
        </Button>
      {{/if}}
    </div>
    <style scoped>
      .realm-settings-edit {
        display: grid;
        justify-items: start;
        gap: var(--boxel-sp-xs);
      }
      .settings {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      th {
        text-align: left;
        font-weight: 600;
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted-foreground);
        padding-bottom: var(--boxel-sp-xxs);
      }
      td {
        vertical-align: top;
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xxs) var(--boxel-sp-xxs) 0;
      }
      .key-cell {
        width: 34%;
      }
      .remove-cell {
        width: var(--boxel-icon-med);
        padding-right: 0;
      }
      .settings :deep(input) {
        font-family: var(--boxel-font-family-mono, monospace);
        min-width: 0;
      }
      .type-note {
        display: block;
        padding-top: var(--boxel-sp-5xs);
        padding-left: var(--boxel-sp-xxs);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        color: var(--muted-foreground);
      }
      .settings-warning {
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        color: var(--boxel-warning-foreground, var(--muted-foreground));
        padding-left: var(--boxel-sp-xxs);
      }
      .empty {
        margin: 0;
        color: var(--muted-foreground);
      }
      .visually-hidden {
        position: absolute;
        width: 0.0625rem;
        height: 0.0625rem;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
    </style>
  </template>
}

class RealmSettingsEmbedded extends Component<typeof RealmSettingsField> {
  private get entries() {
    return Object.entries(this.args.model ?? {}).map(([key, value]) => ({
      key,
      text: settingText(value),
    }));
  }

  <template>
    {{#if this.entries.length}}
      <table class='settings' data-test-realm-settings>
        <thead>
          <tr>
            <th scope='col'>Setting</th>
            <th scope='col'>Value</th>
          </tr>
        </thead>
        <tbody>
          {{#each this.entries key='key' as |entry|}}
            <tr data-test-realm-setting={{entry.key}}>
              <td class='key' data-test-setting-name>{{entry.key}}</td>
              <td class='value' data-test-setting-text>{{entry.text}}</td>
            </tr>
          {{/each}}
        </tbody>
      </table>
    {{else}}
      <p class='empty' data-test-realm-settings-empty>No settings configured.</p>
    {{/if}}
    <style scoped>
      .settings {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      th {
        text-align: left;
        font-weight: 600;
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted-foreground);
        padding-bottom: var(--boxel-sp-xxs);
        border-bottom: 1px solid var(--muted);
      }
      td {
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs) var(--boxel-sp-xxs) 0;
        border-bottom: 1px solid var(--muted);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        overflow-wrap: anywhere;
      }
      .key {
        width: 34%;
        font-weight: 600;
      }
      .value {
        font-family: var(--boxel-font-family-mono, monospace);
      }
      .empty {
        margin: 0;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

class RealmSettingsAtom extends Component<typeof RealmSettingsField> {
  private get count(): number {
    return Object.keys(this.args.model ?? {}).length;
  }

  <template>
    <span class='realm-settings-atom' data-test-realm-settings-atom>
      {{#if this.count}}
        {{this.count}}
        {{if (eq this.count 1) 'setting' 'settings'}}
      {{else}}
        No settings
      {{/if}}
    </span>
    <style scoped>
      .realm-settings-atom {
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
    </style>
  </template>
}

// The realm's own settings, as an operation reads them. A named operation is
// declared once on a card type whose cards live in many realms, so a value
// that differs per realm — who approves an escalation here, what this realm's
// threshold is, which assignee it defaults to — cannot sit in the type. It
// sits here, and a program reads it with realmConfig("approver").
//
// Values are JSON, so a setting can be a string, a number, a flag or a
// structure. Nothing indexes them: JsonField stays out of the search index,
// and the realm keeps the map out of the realmInfo it stamps on card,
// file-meta and realm-info responses — which is about not carrying settings
// on every response, not about who may see them.
//
// They are not secret. This is an ordinary card at the realm's `realm.json`,
// and that file is ordinary source, so anyone with read permission on the
// realm can read every setting here. A credential belongs somewhere the realm
// does not serve.
export class RealmSettingsField extends JsonField {
  static displayName = 'Realm Settings';
  static icon = SettingsIcon;

  static atom = RealmSettingsAtom;
  static embedded = RealmSettingsEmbedded;
  static edit = RealmSettingsEdit;
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
      .own-display-fields + .notes-footer {
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

      <section class='section'>
        <h2 class='section-title'>Settings</h2>
        <@fields.config @format='embedded' />
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
  // Opt-in for the realm's GET `_capture/` route to trigger NEW captures
  // for arbitrary capture specs. Full captureSpec power on a GET is an
  // unbounded spec space reachable with only realm read, so it is off
  // unless the realm turns it on; the gate blocks Chrome work only, never
  // serving — any capture whose canonical spec already has a MediaCache
  // ledger entry streams regardless, including one a write-holder published
  // via POST /_capture-card (which persists under the same canonical
  // identity the GET resolves). Read from the realm's indexed config at
  // request time, so editing this takes effect with the index update, no
  // restart.
  @field allowArbitraryCaptures = contains(BooleanField);

  @field config = contains(RealmSettingsField, {
    description:
      "Realm-level settings a card operation reads with realmConfig('key') — an approver's user id, a threshold, a default assignee. Values are JSON. They are not indexed for search and are not included in the realmInfo carried on card responses",
  });

  // The card that holds this realm's policy, by its id: an absolute URL or a
  // realm-prefixed id.
  //
  // The id rather than a link to the policy card, because a link is followed
  // whenever this card is read. The response for a card side-loads the cards
  // it links to, and a link into another realm is fetched under this realm's
  // own authority rather than the reader's. So every reader of this realm's
  // config would be handed the policy's rules and predicates, even when the
  // policy lives in a realm they have no permission to read, which is where a
  // policy commonly lives. An id is read by the realm and followed by nothing
  // on a read.
  @field policy = contains(StringField, {
    description:
      'The RealmPolicy card that governs this realm, by its URL or realm-prefixed id. Absent for a realm with no policy. Only the pointer lives here; the rules live on the card it names',
  });

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
