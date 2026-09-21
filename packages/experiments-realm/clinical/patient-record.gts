import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import {
  Alert,
  BoxelInput,
  Button,
  FieldContainer,
  FittedCard,
  Pill,
} from '@cardstack/boxel-ui/components';
import ClipboardIcon from '@cardstack/boxel-icons/clipboard-list';
import GaugeIcon from '@cardstack/boxel-icons/gauge';
import HeartPulseIcon from '@cardstack/boxel-icons/heart-pulse';
import PillsIcon from '@cardstack/boxel-icons/pills';
import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import { FileDef } from '@cardstack/base/file-api';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';
import {
  actor,
  bxl,
  card,
  instance,
  linkTo,
  operation,
  operations,
  params,
  OperationsError,
  type OperationDeclaration,
} from '@cardstack/base/operations';

import { Medication, RhythmEvent, VitalsReading } from './chart-fields';
import { Clinician } from './clinician';
import { HospitalFacility } from './facility';

// A consult the care team asks another specialty for. It is the card
// `PatientRecord.requestConsult` mints, and it owns the link back to the
// patient — which is why that one `create` is the whole of the operation.
export class ConsultRequest extends CardDef {
  static displayName = 'Consult Request';
  static icon = ClipboardIcon;

  @field specialty = contains(StringField);
  @field question = contains(StringField);
  // `requested`, `accepted` or `withdrawn`.
  @field status = contains(StringField);
  // The caller's user id, stamped by the realm from `actor()`.
  @field requestedBy = contains(StringField);
  @field patient = linksTo(() => PatientRecord);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ConsultRequest) {
      return this.specialty?.length
        ? `${this.specialty} consult`
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='consult'>
        <header>
          <h1>{{@model.specialty}} consult</h1>
          <p class='subtle'>{{@model.status}} · requested by
            {{@model.requestedBy}}</p>
        </header>
        <p class='question'>{{@model.question}}</p>
        <section>
          <h2>Patient</h2>
          <@fields.patient @format='embedded' />
        </section>
      </article>

      <style scoped>
        .consult {
          container-type: inline-size;
          container-name: consult;
          padding: var(--boxel-sp-lg);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
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
        .question {
          margin: 0;
          font-size: var(--boxel-font-size-lg);
          line-height: var(--boxel-line-height-lg);
        }
        @container consult (max-width: 24rem) {
          .consult {
            padding: var(--boxel-sp);
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='consult-embedded' data-test-consult>
        <span class='specialty'>{{@model.specialty}}</span>
        <span class='question'>{{@model.question}}</span>
      </div>

      <style scoped>
        .consult-embedded {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          min-width: 0;
        }
        .specialty {
          font-weight: 600;
        }
        .question {
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
      <FittedCard @titleTag='h2' data-test-consult>
        <:placeholder><ClipboardIcon width='28' height='28' /></:placeholder>
        <:eyebrow>Consult</:eyebrow>
        <:title>{{@model.specialty}}</:title>
        <:subtitle>{{@model.question}}</:subtitle>
        <:footer><span>{{@model.status}}</span></:footer>
      </FittedCard>
    </template>
  };
}

// What a refusal says to the person who caused it.
//
// The realm answers a refused operation as an `OperationsError` whose `detail`
// is the sentence the declaration's own `assert` carries. That is the message
// worth showing: `message` prefixes it with the error code, which belongs in a
// log rather than on a ward round.
function refusalMessage(err: unknown): string {
  if (err instanceof OperationsError) {
    return err.detail ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

const SEVERITY_VARIANT: Record<string, 'destructive' | 'accent' | 'secondary'> =
  {
    Critical: 'destructive',
    Moderate: 'accent',
    Low: 'secondary',
  };

const EVENT_VARIANT: Record<string, 'destructive' | 'primary' | 'muted'> = {
  open: 'primary',
  escalated: 'destructive',
  resolved: 'muted',
};

class PatientRecordIsolated extends Component<typeof PatientRecord> {
  @tracked refusal: string | undefined;
  @tracked running: string | undefined;

  @tracked findings = 'Rate control started, cardiology paged';
  @tracked heartRate = 96;
  @tracked systolic = 128;
  @tracked diastolic = 74;
  @tracked consultQuestion = 'Please review the overnight rhythm strip';

  readonly doseStep = 2.5;
  readonly consultSpecialty = 'Electrophysiology';

  // The card these operations run against. `@model` is typed with every field
  // optional — a template renders a card that may still be loading — while
  // `operations()` takes the card itself, so the cast is where this template
  // says it is rendering a loaded record.
  get record(): PatientRecord {
    return this.args.model as PatientRecord;
  }

  // The typed bucket of this record's operations. The type argument is what
  // makes the members typed: `operations(card)` alone cannot read the class off
  // an instance, so it answers a bucket that takes any name and any payload.
  get ops() {
    return operations<typeof PatientRecord>(this.record);
  }

  // Whether anything is in flight. `running` carries which action it is, for a
  // per-button affordance; a button's `disabled` wants a boolean.
  get isBusy(): boolean {
    return this.running !== undefined;
  }

  get severityVariant() {
    return SEVERITY_VARIANT[this.record.severity ?? ''] ?? 'secondary';
  }

  get availableConsultants(): Clinician[] {
    let onTeam = new Set(
      (this.record.consultTeam ?? [])
        .filter(Boolean)
        .map((clinician) => clinician.id),
    );
    return (this.record.unitRoster ?? [])
      .filter(Boolean)
      .filter((clinician) => !onTeam.has(clinician.id));
  }

  get recentVitals(): VitalsReading[] {
    return (this.record.vitals ?? []).slice(-4).reverse();
  }

  eventVariant = (status: string | undefined) =>
    EVENT_VARIANT[status ?? ''] ?? 'muted';

  // Every button on this page goes through here: one place to clear the last
  // refusal, mark what is in flight, and turn a refusal into the sentence its
  // declaration wrote.
  private async run(label: string, work: () => Promise<unknown>) {
    this.refusal = undefined;
    this.running = label;
    try {
      await work();
    } catch (err) {
      this.refusal = refusalMessage(err);
    } finally {
      this.running = undefined;
    }
  }

  private auditLine(what: string): string {
    return `${new Date().toISOString()} ${this.record.mrn} ${what}`;
  }

  @action updateFindings(value: string) {
    this.findings = value;
  }

  @action updateHeartRate(value: string) {
    this.heartRate = Number(value);
  }

  @action updateSystolic(value: string) {
    this.systolic = Number(value);
  }

  @action updateDiastolic(value: string) {
    this.diastolic = Number(value);
  }

  @action updateConsultQuestion(value: string) {
    this.consultQuestion = value;
  }

  // A transform whose precondition is a program: the event has to still be
  // open, and saying so in the declaration is what makes a second press a
  // message rather than a second escalation.
  @action escalate(eventId: string) {
    this.run(`escalate:${eventId}`, () =>
      this.ops.escalateRhythmEvent({ eventId, findings: this.findings }),
    );
  }

  // An arithmetic transform: the program reads the dose the realm holds and
  // moves it by the delta the payload carries, so two clinicians titrating at
  // once compose instead of overwriting each other.
  @action titrate(medication: string, direction: number) {
    this.run(`titrate:${medication}`, () =>
      this.ops.titrateDose({
        medication,
        deltaMg: this.doseStep * direction,
      }),
    );
  }

  // An append straight into the stored JSON. A vitals log grows without bound,
  // and this is the operation that adds to one without the realm loading what
  // is already there.
  @action recordVitals() {
    this.run('record-vitals', () =>
      this.ops.recordVitals({
        recordedAt: new Date().toISOString(),
        heartRate: this.heartRate,
        systolic: this.systolic,
        diastolic: this.diastolic,
      }),
    );
  }

  // A declarative precondition: `addConsultant` refuses a clinician already on
  // the team, with the message the declaration wrote.
  @action addConsultant(clinician: Clinician) {
    this.run(`add-consultant:${clinician.id}`, () =>
      this.ops.addConsultant({ clinician: clinician.id! }),
    );
  }

  // One named `create`. The consult owns the link back to the patient, so
  // filling that link is the whole of the operation and no second entry is
  // needed.
  @action requestConsult() {
    this.run('request-consult', () =>
      this.ops.requestConsult({
        specialty: this.consultSpecialty,
        question: this.consultQuestion,
      }),
    );
  }

  // The same consult, when the record is to list it too. Two cards change, so
  // the two entries are one batch: the create's handle is the local id the link
  // entry names, and the audit line lands in the same commit. Either all three
  // land or none of them do.
  @action requestAndListConsult() {
    this.run('request-and-list-consult', () =>
      this.ops.atomic((b) => {
        let consult = b.create(ConsultRequest, {
          specialty: this.consultSpecialty,
          question: this.consultQuestion,
          status: 'requested',
        });
        b.addConsult({ consult });
        let log = this.record.auditLog;
        if (log) {
          b.on(log).appendLine({
            line: this.auditLine(`consult requested: ${this.consultSpecialty}`),
          });
        }
      }),
    );
  }

  // A transfer touches three cards that have nothing to say to each other, so
  // they are staged together in a parallel group. A failure in any one of them
  // rolls back the other two, which is why the receiving clinician can never
  // end up holding a case the record does not show.
  @action transferToIcu(receiving: Clinician) {
    let releasing = this.record.attending;
    let mrn = this.record.mrn;
    this.run(`transfer:${receiving.id}`, () =>
      this.ops.atomic((b) => {
        b.parallel((p) => {
          p.transferToIcu({
            unit: 'Intensive Care',
            reason: 'Sustained arrhythmia',
            receiving: receiving.id!,
          });
          p.on(receiving).acceptCase({ mrn });
          if (releasing) {
            p.on(releasing).releaseCase({ mrn });
          }
        });
        let log = this.record.auditLog;
        if (log) {
          b.on(log).appendLine({
            line: this.auditLine('transferred to intensive care'),
          });
        }
      }),
    );
  }

  <template>
    <article class='chart'>
      <header class='masthead'>
        <div class='identity'>
          <p class='mrn' data-test-mrn>{{@model.mrn}}</p>
          <h1 data-test-patient-name>{{@model.patientName}}</h1>
          <div class='status-row'>
            <Pill @variant='secondary' data-test-status>
              {{@model.status}}
            </Pill>
            <Pill @variant={{this.severityVariant}} data-test-severity>
              {{@model.severity}}
            </Pill>
            <Pill @variant='muted' data-test-care-unit>
              {{@model.careUnit}}
            </Pill>
          </div>
        </div>
        <div class='attribution'>
          <@fields.attending @format='embedded' />
          <@fields.facility @format='embedded' />
        </div>
      </header>

      <p class='posture' data-test-posture>
        Anyone who can write this realm can run every action on this page. These
        operations record who acted; they do not check whether that person
        should be allowed to act. Do not copy this example as a model for access
        control.
      </p>

      {{#if this.refusal}}
        <Alert @type='error' role='alert' data-test-refusal as |alert|>
          <alert.Messages @messages={{array this.refusal}} />
        </Alert>
      {{/if}}

      <div class='columns'>
        <div class='column'>
          <section class='panel'>
            <h2><HeartPulseIcon width='16' height='16' />Rhythm events</h2>
            <FieldContainer
              @label='Findings recorded with an escalation'
              @vertical={{true}}
              @fieldId='findings'
            >
              <BoxelInput
                @id='findings'
                @value={{this.findings}}
                @onInput={{this.updateFindings}}
                data-test-findings-input
              />
            </FieldContainer>
            <ul class='rows'>
              {{#each @model.rhythmEvents as |event|}}
                <li class='row' data-test-rhythm-event={{event.eventId}}>
                  <span class='row-key'>{{event.eventId}}</span>
                  <span class='row-main'>
                    <span class='row-title'>{{event.rhythm}}</span>
                    <span class='row-note'>{{event.detectedAt}}</span>
                  </span>
                  <Pill
                    @variant={{this.eventVariant event.status}}
                    data-test-rhythm-status
                  >{{event.status}}</Pill>
                  <Button
                    @kind='primary'
                    @size='small'
                    @disabled={{this.isBusy}}
                    data-test-escalate={{event.eventId}}
                    {{on 'click' (fn this.escalate event.eventId)}}
                  >Escalate</Button>
                </li>
              {{else}}
                <li class='row empty'>No rhythm events recorded</li>
              {{/each}}
            </ul>
          </section>

          <section class='panel'>
            <h2><PillsIcon width='16' height='16' />Medications</h2>
            <ul class='rows'>
              {{#each @model.medications as |medication|}}
                <li class='row' data-test-medication={{medication.name}}>
                  <span class='row-main'>
                    <span class='row-title'>{{medication.name}}</span>
                    <span class='row-note'>{{medication.frequency}} ·
                      {{medication.status}}</span>
                  </span>
                  <span class='row-value' data-test-dose>{{medication.doseMg}}
                    mg</span>
                  <span class='row-actions'>
                    <Button
                      @size='small'
                      @disabled={{this.isBusy}}
                      data-test-titrate-up={{medication.name}}
                      {{on 'click' (fn this.titrate medication.name 1)}}
                    >+{{this.doseStep}}</Button>
                    <Button
                      @size='small'
                      @disabled={{this.isBusy}}
                      data-test-titrate-down={{medication.name}}
                      {{on 'click' (fn this.titrate medication.name -1)}}
                    >−{{this.doseStep}}</Button>
                  </span>
                </li>
              {{else}}
                <li class='row empty'>No medications on the chart</li>
              {{/each}}
            </ul>
          </section>

          <section class='panel'>
            <h2><GaugeIcon width='16' height='16' />Vitals</h2>
            <div class='vitals-form'>
              <FieldContainer
                @label='Heart rate'
                @vertical={{true}}
                @fieldId='heart-rate'
              >
                <BoxelInput
                  @id='heart-rate'
                  @type='number'
                  @value={{this.heartRate}}
                  @onInput={{this.updateHeartRate}}
                  data-test-heart-rate-input
                />
              </FieldContainer>
              <FieldContainer
                @label='Systolic'
                @vertical={{true}}
                @fieldId='systolic'
              >
                <BoxelInput
                  @id='systolic'
                  @type='number'
                  @value={{this.systolic}}
                  @onInput={{this.updateSystolic}}
                  data-test-systolic-input
                />
              </FieldContainer>
              <FieldContainer
                @label='Diastolic'
                @vertical={{true}}
                @fieldId='diastolic'
              >
                <BoxelInput
                  @id='diastolic'
                  @type='number'
                  @value={{this.diastolic}}
                  @onInput={{this.updateDiastolic}}
                  data-test-diastolic-input
                />
              </FieldContainer>
              <Button
                @kind='primary'
                @size='small'
                @disabled={{this.isBusy}}
                data-test-record-vitals
                {{on 'click' this.recordVitals}}
              >Record vitals</Button>
            </div>
            <ul class='rows'>
              {{#each this.recentVitals as |reading|}}
                <li class='row' data-test-vitals-reading={{reading.recordedAt}}>
                  <span class='row-main'>
                    <span class='row-note'>{{reading.recordedAt}}</span>
                    <span class='row-note'>{{reading.recordedBy}}</span>
                  </span>
                  <span class='row-value'>{{reading.heartRate}} bpm</span>
                  <span
                    class='row-value'
                  >{{reading.systolic}}/{{reading.diastolic}}</span>
                </li>
              {{else}}
                <li class='row empty'>No readings yet</li>
              {{/each}}
            </ul>
          </section>
        </div>

        <div class='column'>
          <section class='panel'>
            <h2>Consult team</h2>
            <@fields.consultTeam @format='fitted' />
            <h3>Available on this unit</h3>
            <ul class='rows'>
              {{#each this.availableConsultants as |clinician|}}
                <li
                  class='row'
                  data-test-available-consultant={{clinician.userId}}
                >
                  <span class='row-main'>
                    <span class='row-title'>{{clinician.fullName}}</span>
                    <span class='row-note'>{{clinician.role}}</span>
                  </span>
                  <span class='row-actions'>
                    <Button
                      @size='small'
                      @disabled={{this.isBusy}}
                      data-test-add-consultant={{clinician.userId}}
                      {{on 'click' (fn this.addConsultant clinician)}}
                    >Consult</Button>
                    <Button
                      @kind='destructive'
                      @size='small'
                      @disabled={{this.isBusy}}
                      data-test-transfer-to-icu={{clinician.userId}}
                      {{on 'click' (fn this.transferToIcu clinician)}}
                    >Transfer to ICU</Button>
                  </span>
                </li>
              {{else}}
                <li class='row empty'>Everyone on this unit is already
                  consulting</li>
              {{/each}}
            </ul>
          </section>

          <section class='panel'>
            <h2><ClipboardIcon width='16' height='16' />Consults</h2>
            <FieldContainer
              @label='Question for the consulting service'
              @vertical={{true}}
              @fieldId='consult-question'
            >
              <BoxelInput
                @id='consult-question'
                @value={{this.consultQuestion}}
                @onInput={{this.updateConsultQuestion}}
                data-test-consult-question-input
              />
            </FieldContainer>
            <div class='actions'>
              <Button
                @size='small'
                @disabled={{this.isBusy}}
                data-test-request-consult
                {{on 'click' this.requestConsult}}
              >Request consult</Button>
              <Button
                @kind='primary'
                @size='small'
                @disabled={{this.isBusy}}
                data-test-request-and-list-consult
                {{on 'click' this.requestAndListConsult}}
              >Request and list it here</Button>
            </div>
            <@fields.consults @format='fitted' />
          </section>

          <section class='panel'>
            <h2>Audit log</h2>
            <p class='row-note'>Every batch above appends one line to this file
              in the same commit as the card change.</p>
            <@fields.auditLog @format='embedded' />
          </section>
        </div>
      </div>
    </article>

    <style scoped>
      .chart {
        container-type: inline-size;
        container-name: chart;
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }
      .masthead {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--boxel-sp);
        padding-bottom: var(--boxel-sp);
        border-bottom: 0.125rem solid var(--foreground);
      }
      .mrn {
        margin: 0;
        font-family: var(--font-mono, monospace);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        color: var(--muted-foreground);
      }
      .identity h1 {
        margin: 0 0 var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-xl);
        line-height: var(--boxel-line-height-xl);
        letter-spacing: -0.02em;
      }
      .status-row,
      .actions,
      .row-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
      }
      .attribution {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .posture {
        margin: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-left: 0.1875rem solid var(--primary);
        background-color: var(--muted);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .columns {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--boxel-sp-lg);
      }
      .column {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        min-width: 0;
      }
      .panel {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .panel h2 {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        margin: 0;
        padding-bottom: var(--boxel-sp-xxs);
        border-bottom: 0.0625rem solid var(--border, var(--muted));
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground);
      }
      .panel h3 {
        margin: var(--boxel-sp-xs) 0 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        color: var(--muted-foreground);
      }
      .rows {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) 0;
        border-bottom: 0.0625rem solid var(--border, var(--muted));
        min-width: 0;
      }
      .row-key {
        font-family: var(--font-mono, monospace);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        color: var(--muted-foreground);
      }
      .row-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 8rem;
      }
      .row-title {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row-note {
        margin: 0;
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .row-value {
        font-family: var(--font-mono, monospace);
        font-variant-numeric: tabular-nums;
      }
      .empty {
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .vitals-form {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--boxel-sp-xs);
      }
      @container chart (min-width: 56rem) {
        .columns {
          grid-template-columns: 3fr 2fr;
        }
      }
      @container chart (max-width: 28rem) {
        .chart {
          padding: var(--boxel-sp);
          gap: var(--boxel-sp);
        }
      }
    </style>
  </template>
}

// One patient's record, and every action a clinician takes on it.
//
// Each action is a named operation declared here as data: the realm reads the
// declaration out of its definition cache and carries it out itself, so no code
// from this module runs on the write path. The templates invoke them through
// `operations()` and render what comes back.
//
// None of this is access-controlled. See the posture note in the template and
// in this folder's README.
export class PatientRecord extends CardDef {
  static displayName = 'Patient Record';
  static icon = HeartPulseIcon;
  static prefersWideFormat = true;

  @field mrn = contains(StringField);
  @field patientName = contains(StringField);
  // `admitted` or `discharged`.
  @field status = contains(StringField);
  @field severity = contains(StringField);
  @field careUnit = contains(StringField);
  @field transferReason = contains(StringField);

  @field facility = linksTo(HospitalFacility, { searchable: true });
  // Searchable because `myPatients` compares the caller against the attending
  // clinician's user id, and a filter only reads a linked card's fields when
  // the link that reaches them says it is searchable.
  @field attending = linksTo(Clinician, { searchable: true });
  @field consultTeam = linksToMany(Clinician);
  // The clinicians rostered to this patient's unit: who is available to join
  // the consult team, and who a transfer can hand the case to.
  @field unitRoster = linksToMany(Clinician);
  @field consults = linksToMany(() => ConsultRequest);

  @field medications = containsMany(Medication);
  @field rhythmEvents = containsMany(RhythmEvent);
  @field vitals = containsMany(VitalsReading);

  // The append-only ledger the batches write a line to. It is a text file in
  // this realm; which `FileDef` type a realm file gets is decided by its
  // extension, so this is base's `TextFileDef` and the only writes it carries
  // are the base `update` and `appendLine`.
  @field auditLog = linksTo(FileDef);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: PatientRecord) {
      return this.patientName?.length
        ? this.patientName
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  // A precondition written as a program, because what has to hold is a state of
  // the record rather than the absence of a duplicate. The `assert` reads the
  // card's stored source, so it is checked against the same bytes the write is
  // staged from — which is what makes "still open" mean still open at the
  // moment of the commit.
  @operation static escalateRhythmEvent = {
    base: 'transform',
    params: { eventId: StringField, findings: StringField },
    transformations: bxl`
      assert(
        any(.rhythmEvents[]; .eventId == params("eventId") and .status == "open");
        "That rhythm event is not open, so there is nothing to escalate"
      );
      (.rhythmEvents[] | select(.eventId == params("eventId")) | .status) = "escalated";
      (.rhythmEvents[] | select(.eventId == params("eventId")) | .findings) = params("findings");
      .severity = "Critical";
    `,
  } satisfies OperationDeclaration;

  // Arithmetic against the stored value rather than a new value computed by the
  // caller: `|= . + …` reads the dose the realm holds, so two clinicians
  // titrating at the same time compose instead of the second overwriting the
  // first.
  @operation static titrateDose = {
    base: 'transform',
    params: { medication: StringField, deltaMg: NumberField },
    transformations: bxl`
      assert(
        .status == "admitted";
        "A dose is titrated only while the patient is admitted"
      );
      assert(
        any(.medications[]; .name == params("medication") and .status == "administered");
        "That medication is not being administered"
      );
      (.medications[] | select(.name == params("medication")) | .doseMg) |= . + params("deltaMg");
    `,
  } satisfies OperationDeclaration;

  // The same kind of guard said declaratively. `unique` names the collection
  // and `by` the identity that decides whether an item is already in it —
  // compared against each linked card's id, because the collection holds links.
  //
  // `snapshot: true` is required here and is not a detail: a program reads the
  // card's stored document, which holds a link's target as a reference rather
  // than as the linked card, so the ids this check compares have to be
  // gathered from the index first. That makes it a check against an index
  // snapshot — it guards the interface against an obvious double-add, not the
  // commit. Declaring it is how an author says they know that.
  @operation static addConsultant = {
    base: 'transform',
    params: { clinician: linkTo(Clinician) },
    assert: {
      unique: 'consultTeam',
      by: params('clinician'),
      snapshot: true,
      message: 'That clinician is already on this patient’s consult team',
    },
    append: { to: 'consultTeam', value: card(params('clinician')) },
  } satisfies OperationDeclaration;

  // A declarative update: the field values to write, including the link the
  // transfer hands the case to.
  @operation static transferToIcu = {
    base: 'transform',
    params: {
      unit: StringField,
      reason: StringField,
      receiving: linkTo(Clinician),
    },
    set: {
      careUnit: params('unit'),
      severity: 'Critical',
      transferReason: params('reason'),
      attending: card(params('receiving')),
    },
  } satisfies OperationDeclaration;

  // An append into the card's stored JSON, made without assembling the
  // document. A vitals log grows without bound, and this is the operation that
  // keeps adding to one from costing what reading one costs.
  @operation static recordVitals = {
    base: 'appendContainsMany',
    field: 'vitals',
    params: {
      recordedAt: StringField,
      heartRate: NumberField,
      systolic: NumberField,
      diastolic: NumberField,
    },
    item: {
      recordedAt: params('recordedAt'),
      heartRate: params('heartRate'),
      systolic: params('systolic'),
      diastolic: params('diastolic'),
      recordedBy: actor(),
    },
  } satisfies OperationDeclaration;

  // A named create, anchored on the record it is invoked from: `instance('id')`
  // is that record's identity, so the consult it mints already links back. One
  // entry is enough because the consult owns the link.
  @operation static requestConsult = {
    base: 'create',
    of: ConsultRequest,
    params: { specialty: StringField, question: StringField },
    fill: {
      specialty: params('specialty'),
      question: params('question'),
      status: 'requested',
      requestedBy: actor(),
      patient: instance('id'),
    },
  } satisfies OperationDeclaration;

  // The other half of the link, for a batch that wants the record to list the
  // consult too. `params('consult')` takes a saved card's URL or the local id
  // of one the same batch is minting.
  @operation static addConsult = {
    base: 'transform',
    params: { consult: linkTo(ConsultRequest) },
    append: { to: 'consults', value: card(params('consult')) },
  } satisfies OperationDeclaration;

  // A saved search with a payload: the unit is a declared param, and the marker
  // in the filter is what the invocation fills in.
  @operation static admittedOnUnit = {
    base: 'query',
    params: { careUnit: StringField },
    query: {
      filter: {
        on: () => PatientRecord,
        eq: { careUnit: params('careUnit'), status: 'admitted' },
      },
      sort: [{ on: () => PatientRecord, by: 'patientName', direction: 'asc' }],
    },
  } satisfies OperationDeclaration;

  // A saved search, declared beside the writes and carried out by the search
  // engine rather than by the operation endpoint. `actor()` is the caller's
  // user id, compared against the attending clinician's — which is why
  // `attending` is declared searchable above.
  @operation static myPatients = {
    base: 'query',
    query: {
      filter: {
        on: () => PatientRecord,
        eq: { 'attending.userId': actor(), status: 'admitted' },
      },
      sort: [{ on: () => PatientRecord, by: 'patientName', direction: 'asc' }],
    },
  } satisfies OperationDeclaration;

  static isolated = PatientRecordIsolated;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='record-embedded' data-test-patient={{@model.mrn}}>
        <span class='mrn'>{{@model.mrn}}</span>
        <span class='name'>{{@model.patientName}}</span>
        <span class='detail'>{{@model.careUnit}} · {{@model.severity}}</span>
      </div>

      <style scoped>
        .record-embedded {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          min-width: 0;
        }
        .mrn {
          font-family: var(--font-mono, monospace);
          letter-spacing: 0.12em;
          text-transform: uppercase;
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
          color: var(--muted-foreground);
        }
        .name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .detail {
          color: var(--muted-foreground);
          font-size: var(--boxel-font-size-sm);
          line-height: var(--boxel-line-height-sm);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <FittedCard @titleTag='h2' data-test-patient={{@model.mrn}}>
        <:placeholder><HeartPulseIcon width='28' height='28' /></:placeholder>
        <:eyebrow>{{@model.mrn}}</:eyebrow>
        <:title>{{@model.patientName}}</:title>
        <:subtitle>{{@model.careUnit}}</:subtitle>
        <:badgeRow>
          <Pill @variant='muted' @size='extra-small'>{{@model.severity}}</Pill>
        </:badgeRow>
        <:footer><span>{{@model.status}}</span></:footer>
      </FittedCard>
    </template>
  };
}
