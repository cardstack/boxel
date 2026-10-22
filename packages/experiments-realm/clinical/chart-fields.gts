import {
  Component,
  FieldDef,
  contains,
  field,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';
import ActivityIcon from '@cardstack/boxel-icons/activity-heartbeat';
import GaugeIcon from '@cardstack/boxel-icons/gauge';
import PillsIcon from '@cardstack/boxel-icons/pills';

// The contained values a patient record holds in bulk: a reading, a
// medication line, an arrhythmia event. They live here rather than beside the
// record so `patient-record.gts` stays about the operations.

export class VitalsReading extends FieldDef {
  static displayName = 'Vitals Reading';
  static icon = GaugeIcon;

  @field recordedAt = contains(StringField);
  @field heartRate = contains(NumberField);
  @field systolic = contains(NumberField);
  @field diastolic = contains(NumberField);
  @field recordedBy = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='reading'>
        <span class='when'>{{@model.recordedAt}}</span>
        <span class='value'>{{@model.heartRate}} bpm</span>
        <span class='value'>{{@model.systolic}}/{{@model.diastolic}}</span>
      </div>

      <style scoped>
        .reading {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
        }
        .when {
          flex: 1;
          min-width: 0;
          color: var(--muted-foreground);
          font-size: var(--boxel-font-size-sm);
          line-height: var(--boxel-line-height-sm);
        }
        .value {
          font-family: var(--font-mono, monospace);
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };
}

export class Medication extends FieldDef {
  static displayName = 'Medication';
  static icon = PillsIcon;

  @field name = contains(StringField);
  @field doseMg = contains(NumberField);
  @field frequency = contains(StringField);
  // `administered` or `held`.
  @field status = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='medication'>
        <span class='name'>{{@model.name}}</span>
        <span class='dose'>{{@model.doseMg}} mg</span>
        <span class='detail'>{{@model.frequency}} · {{@model.status}}</span>
      </div>

      <style scoped>
        .medication {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
        }
        .name {
          font-weight: 600;
        }
        .dose {
          font-family: var(--font-mono, monospace);
          font-variant-numeric: tabular-nums;
        }
        .detail {
          color: var(--muted-foreground);
          font-size: var(--boxel-font-size-sm);
          line-height: var(--boxel-line-height-sm);
        }
      </style>
    </template>
  };
}

export class RhythmEvent extends FieldDef {
  static displayName = 'Rhythm Event';
  static icon = ActivityIcon;

  @field eventId = contains(StringField);
  @field detectedAt = contains(StringField);
  @field rhythm = contains(StringField);
  // `open`, `escalated` or `resolved`.
  @field status = contains(StringField);
  @field findings = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='event'>
        <span class='id'>{{@model.eventId}}</span>
        <span class='rhythm'>{{@model.rhythm}}</span>
        <span class='detail'>{{@model.detectedAt}} · {{@model.status}}</span>
      </div>

      <style scoped>
        .event {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
        }
        .id {
          font-family: var(--font-mono, monospace);
        }
        .rhythm {
          font-weight: 600;
        }
        .detail {
          color: var(--muted-foreground);
          font-size: var(--boxel-font-size-sm);
          line-height: var(--boxel-line-height-sm);
        }
      </style>
    </template>
  };
}
