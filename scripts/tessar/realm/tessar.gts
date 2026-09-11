import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  StringField,
  NumberField,
} from '@cardstack/base/card-api';

export class TessarRecord extends CardDef {
  @field label = contains(StringField);
  @field classroomKey = contains(StringField);
  @field day = contains(StringField);
  @field sequence = contains(NumberField);
  @field score = contains(NumberField);
  @field status = contains(StringField);
  @field narrative = contains(StringField);
}
export class Classroom extends TessarRecord {}
export class Student extends TessarRecord {}
export class Staff extends TessarRecord {}
export class Reference extends TessarRecord {}
export class Activity extends TessarRecord {
  @field student = linksTo(Student);
  @field staff = linksTo(Staff);
  @field reference = linksTo(Reference);
}
export class Slot extends Activity {}
export class Observation extends Activity {}
export class Report extends Activity {}

export class TessarRow extends FieldDef {
  @field sourceId = contains(StringField);
  @field label = contains(StringField);
  @field sequence = contains(NumberField);
  @field status = contains(StringField);
  @field studentLabel = contains(StringField);
  @field referenceLabel = contains(StringField);
}

export class DaySummary extends TessarRecord {
  @field students = linksToMany(Student, {
    query: {
      filter: { eq: { classroomKey: '$this.classroomKey' } },
      page: { size: 2000 },
    },
  });
  @field slots = linksToMany(Slot, {
    query: {
      filter: { eq: { classroomKey: '$this.classroomKey', day: '$this.day' } },
      page: { size: 2000 },
    },
  });
  @field observations = linksToMany(Observation, {
    query: {
      filter: { eq: { classroomKey: '$this.classroomKey', day: '$this.day' } },
      page: { size: 2000 },
    },
  });
  @field reports = linksToMany(Report, {
    query: {
      filter: { eq: { classroomKey: '$this.classroomKey', day: '$this.day' } },
      page: { size: 2000 },
    },
  });
  @field studentCount = contains(NumberField, {
    computeVia: function (this: DaySummary) {
      return this.students.length;
    },
  });
  @field slotCount = contains(NumberField, {
    computeVia: function (this: DaySummary) {
      return this.slots.length;
    },
  });
  @field observationCount = contains(NumberField, {
    computeVia: function (this: DaySummary) {
      return this.observations.length;
    },
  });
  @field reportCount = contains(NumberField, {
    computeVia: function (this: DaySummary) {
      return this.reports.length;
    },
  });
  @field readyReportCount = contains(NumberField, {
    computeVia: function (this: DaySummary) {
      return this.reports.filter((report) => report.status === 'ready').length;
    },
  });
  @field scoreTotal = contains(NumberField, {
    computeVia: function (this: DaySummary) {
      return this.observations.reduce(
        (sum, item) => sum + (item.score ?? 0),
        0,
      );
    },
  });
  @field rows = containsMany(TessarRow, {
    computeVia: function (this: DaySummary) {
      return [...this.slots]
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
        .map(
          (slot) =>
            new TessarRow({
              sourceId: `Slot/${String(slot.sequence).padStart(5, '0')}`,
              label: slot.label,
              sequence: slot.sequence,
              status: slot.status,
              studentLabel: slot.student?.label,
              referenceLabel: slot.reference?.label,
            }),
        );
    },
  });

  static isolated = class extends Component<typeof DaySummary> {
    <template>
      <article class='tessar-dashboard'>
        <h1>Tessar Classroom Board</h1>
        <p>{{@model.classroomKey}} · {{@model.day}}</p>
        <dl>
          <dt>Students</dt><dd
            data-tessar-stat='studentCount'
          >{{@model.studentCount}}</dd>
          <dt>Sessions</dt><dd
            data-tessar-stat='slotCount'
          >{{@model.slotCount}}</dd>
          <dt>Observations</dt><dd
            data-tessar-stat='observationCount'
          >{{@model.observationCount}}</dd>
          <dt>Reports</dt><dd
            data-tessar-stat='reportCount'
          >{{@model.reportCount}}</dd>
          <dt>Ready reports</dt><dd
            data-tessar-stat='readyReportCount'
          >{{@model.readyReportCount}}</dd>
          <dt>Score total</dt><dd
            data-tessar-stat='scoreTotal'
          >{{@model.scoreTotal}}</dd>
        </dl>
        <table>
          <thead><tr><th>Session</th><th>Student</th><th>Resource</th><th
              >Status</th></tr></thead>
          <tbody>
            {{#each @model.rows as |row|}}
              <tr data-tessar-source={{row.sourceId}}>
                <td>{{row.label}}</td><td>{{row.studentLabel}}</td><td
                >{{row.referenceLabel}}</td><td>{{row.status}}</td>
              </tr>
            {{/each}}
          </tbody>
        </table>
      </article>
      <style scoped>
        .tessar-dashboard {
          padding: 1.5rem;
          color: #142b3c;
          background: #f7fafc;
        }
        dl {
          display: grid;
          grid-template-columns: 1fr 1fr;
          max-width: 24rem;
        }
        dd {
          font-variant-numeric: tabular-nums;
        }
        th,
        td {
          text-align: left;
          padding: 0.5rem 1rem;
          border-bottom: 0.0625rem solid #ccd6de;
        }
      </style>
    </template>
  };
}
