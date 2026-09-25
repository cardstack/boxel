import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { FittedCard, Pill } from '@cardstack/boxel-ui/components';
import StethoscopeIcon from '@cardstack/boxel-icons/stethoscope';
import {
  bxl,
  operation,
  params,
  type OperationDeclaration,
} from '@cardstack/base/operations';

// A clinician, and the record numbers currently on their caseload.
//
// The two operations here are a transfer's other half: moving a patient to
// intensive care means the receiving clinician picks the case up and the
// releasing one puts it down, and those are changes to two more cards. They
// are declared here, on the card they change, and a batch composed on the
// patient record reaches them through `b.on(clinician)`.
export class Clinician extends CardDef {
  static displayName = 'Clinician';
  static icon = StethoscopeIcon;

  @field fullName = contains(StringField);
  @field role = contains(StringField);
  // The clinician's Matrix user id. `actor()` answers a caller's user id and
  // nothing else, so this is the field a saved search compares a caller
  // against — see `PatientRecord.myPatients`.
  @field userId = contains(StringField);
  @field activeCaseload = containsMany(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Clinician) {
      return this.fullName?.length
        ? this.fullName
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  // A precondition written declaratively. `unique` names the collection and
  // `by` says what decides whether an item is already in it — here the record
  // number itself, because the collection holds plain strings and an item is
  // compared whole.
  @operation static acceptCase = {
    base: 'transform',
    params: { mrn: StringField },
    assert: {
      unique: 'activeCaseload',
      by: params('mrn'),
      message: 'That record is already on this clinician’s caseload',
    },
    append: { to: 'activeCaseload', value: params('mrn') },
  } satisfies OperationDeclaration;

  // The same shape said as a program, because removing an item is not one of
  // the declarative clauses. `select` picks the items a predicate matches and
  // `del` removes them; the `assert` in front is what turns "there was nothing
  // to remove" into a message instead of a silent success.
  @operation static releaseCase = {
    base: 'transform',
    params: { mrn: StringField },
    transformations: bxl`
      assert(
        any(.activeCaseload[]; . == params("mrn"));
        "That record is not on this clinician’s caseload"
      );
      del(.activeCaseload[] | select(. == params("mrn")));
    `,
  } satisfies OperationDeclaration;

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='clinician'>
        <header>
          <h1>{{@model.fullName}}</h1>
          <p class='subtle'>{{@model.role}} · {{@model.userId}}</p>
        </header>
        <section>
          <h2>Caseload</h2>
          <ul class='caseload' data-test-caseload>
            {{#each @model.activeCaseload as |mrn|}}
              <li>
                <Pill @variant='secondary' data-test-caseload-entry={{mrn}}>
                  {{mrn}}
                </Pill>
              </li>
            {{else}}
              <li class='subtle'>No records assigned</li>
            {{/each}}
          </ul>
        </section>
      </article>

      <style scoped>
        .clinician {
          container-type: inline-size;
          container-name: clinician;
          padding: var(--boxel-sp-lg);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          line-height: var(--boxel-line-height-xl);
          letter-spacing: -0.01em;
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          line-height: var(--boxel-line-height-sm);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted-foreground);
        }
        .subtle {
          margin: 0;
          color: var(--muted-foreground);
        }
        .caseload {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xxs);
        }
        @container clinician (max-width: 24rem) {
          .clinician {
            padding: var(--boxel-sp);
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='clinician-embedded' data-test-clinician={{@model.userId}}>
        <StethoscopeIcon width='20' height='20' />
        <span class='name'>{{@model.fullName}}</span>
        <span class='role'>{{@model.role}}</span>
      </div>

      <style scoped>
        .clinician-embedded {
          display: grid;
          grid-template-columns: auto 1fr;
          grid-template-rows: auto auto;
          align-items: center;
          column-gap: var(--boxel-sp-xs);
          min-width: 0;
        }
        .clinician-embedded > :deep(svg) {
          grid-row: 1 / span 2;
          color: var(--muted-foreground);
        }
        .name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .role {
          color: var(--muted-foreground);
          font-size: var(--boxel-font-size-sm);
          line-height: var(--boxel-line-height-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <FittedCard @titleTag='h2' data-test-clinician={{@model.userId}}>
        <:placeholder><StethoscopeIcon width='28' height='28' /></:placeholder>
        <:eyebrow>Clinician</:eyebrow>
        <:title>{{@model.fullName}}</:title>
        <:subtitle>{{@model.role}}</:subtitle>
        <:footer>
          <span>{{@model.activeCaseload.length}} on caseload</span>
        </:footer>
      </FittedCard>
    </template>
  };
}
