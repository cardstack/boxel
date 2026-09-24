import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  field,
} from './card-api';
import CodeRefField from './code-ref';
import PolicyPredicateField from './policy-predicate';
import StringField from './string';
import ShieldCheckIcon from '@cardstack/boxel-icons/shield-check';

// A realm's operation policy: which callers may invoke which operations on
// which card types, beyond what the realm's own read/write permissions allow.
//
// A policy only ever widens access. It is a union of grants — a caller may
// invoke an operation on a target if the realm already permits it, or if any
// rule whose `targetType` matches the target (or one of its ancestors) holds a
// grant for that operation whose `where` predicate, when present, is true.
// Rule order carries no meaning.
//
// These definitions only describe a policy; nothing in them evaluates one.

export class OperationGrant extends FieldDef {
  static displayName = 'Operation Grant';

  // The operation name as a caller invokes it — a base operation such as
  // `read` or `update`, or a name a card declares. A grant on a named
  // operation does not grant the base operation it is built on.
  @field operation = contains(StringField);
  // A BXL boolean expression over the caller and the target. Absent means
  // the grant is unconditional.
  @field where = contains(PolicyPredicateField);

  static embedded = class Embedded extends Component<typeof OperationGrant> {
    <template>
      <div class='operation-grant' data-test-operation-grant>
        <code class='operation' data-test-operation-grant-operation>
          {{@model.operation}}
        </code>
        {{#if @model.where}}
          <span class='keyword'>where</span>
          <@fields.where />
        {{else}}
          <span class='unconditional' data-test-operation-grant-unconditional>
            always
          </span>
        {{/if}}
      </div>
      <style scoped>
        .operation-grant {
          display: flex;
          align-items: baseline;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
        .operation {
          font-family: var(--boxel-monospace-font-family, monospace);
          font-weight: 600;
        }
        .keyword,
        .unconditional {
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}

export class PolicyRule extends FieldDef {
  static displayName = 'Policy Rule';

  // The card type this rule governs. It also governs that type's subtypes.
  @field targetType = contains(CodeRefField);
  @field grants = containsMany(OperationGrant);

  static embedded = class Embedded extends Component<typeof PolicyRule> {
    <template>
      <section class='policy-rule' data-test-policy-rule>
        <header class='target'>
          {{#if @model.targetType}}
            <span class='type-name' data-test-policy-rule-type-name>
              {{@model.targetType.name}}
            </span>
            <span class='type-module' data-test-policy-rule-type-module>
              {{@model.targetType.module}}
            </span>
          {{else}}
            <span class='type-name missing'>No target type</span>
          {{/if}}
        </header>
        {{#if @model.grants.length}}
          <ul class='grants'>
            {{#each @fields.grants as |Grant|}}
              <li><Grant /></li>
            {{/each}}
          </ul>
        {{else}}
          <p class='empty' data-test-policy-rule-no-grants>No grants.</p>
        {{/if}}
      </section>
      <style scoped>
        .policy-rule {
          display: grid;
          gap: var(--boxel-sp-xs);
        }
        .target {
          display: flex;
          align-items: baseline;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
        .type-name {
          font-weight: 600;
        }
        .type-name.missing,
        .type-module,
        .empty {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .type-module {
          font-family: var(--boxel-monospace-font-family, monospace);
          font-size: var(--boxel-font-size-xs);
          overflow-wrap: anywhere;
        }
        .grants {
          list-style: none;
          margin: 0;
          padding: 0 0 0 var(--boxel-sp);
          display: grid;
          gap: var(--boxel-sp-xxs);
        }
        .empty {
          margin: 0;
        }
      </style>
    </template>
  };
}

export class RealmPolicy extends CardDef {
  static displayName = 'Realm Policy';
  static icon = ShieldCheckIcon;

  @field rules = containsMany(PolicyRule);

  static isolated = class Isolated extends Component<typeof RealmPolicy> {
    <template>
      <article class='realm-policy' data-test-realm-policy-isolated>
        <header class='header'>
          <ShieldCheckIcon class='icon' />
          <h1 class='title'>{{@model.cardTitle}}</h1>
        </header>
        <section class='section'>
          <h2 class='section-title'>Rules</h2>
          {{#if @model.rules.length}}
            <ol class='rules' data-test-realm-policy-rules>
              {{#each @fields.rules as |Rule|}}
                <li class='rule'><Rule /></li>
              {{/each}}
            </ol>
          {{else}}
            <p class='empty' data-test-realm-policy-no-rules>
              This policy has no rules, so it grants nothing.
            </p>
          {{/if}}
        </section>
      </article>
      <style scoped>
        .realm-policy {
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
          width: var(--boxel-icon-lg);
          height: var(--boxel-icon-lg);
          flex-shrink: 0;
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
          gap: var(--boxel-sp);
        }
        .rule {
          padding: var(--boxel-sp-sm);
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius);
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof RealmPolicy> {
    <template>
      <div class='realm-policy' data-test-realm-policy-embedded>
        <h3 class='title'>{{@model.cardTitle}}</h3>
        {{#if @model.rules.length}}
          <ol class='rules' data-test-realm-policy-rules>
            {{#each @fields.rules as |Rule|}}
              <li class='rule'><Rule /></li>
            {{/each}}
          </ol>
        {{else}}
          <p class='empty' data-test-realm-policy-no-rules>
            This policy has no rules, so it grants nothing.
          </p>
        {{/if}}
      </div>
      <style scoped>
        .realm-policy {
          padding: var(--boxel-sp);
          display: grid;
          gap: var(--boxel-sp-sm);
        }
        .title {
          font: 600 var(--boxel-font);
          margin: 0;
        }
        .rules {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: var(--boxel-sp);
        }
        .rule {
          padding: var(--boxel-sp-sm);
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius);
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}
