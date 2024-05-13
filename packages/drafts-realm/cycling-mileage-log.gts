import {
  contains,
  containsMany,
  CardDef,
  FieldDef,
  StringField,
  field,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import { Component } from 'https://cardstack.com/base/card-api';
import Date from 'https://cardstack.com/base/date';
import {
  Chart,
  registerables,
  // @ts-ignore cannot find module error
} from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.2/+esm';
import Modifier from 'ember-modifier';
import { isAfter, isBefore, isEqual } from 'date-fns';

type ProgressChartModifierSignature = {
  Args: {
    Named: {
      target?: number;
      total?: number;
      unit?: string;
    };
  };
  Element: HTMLElement;
};

class ProgressChartModifier extends Modifier<ProgressChartModifierSignature> {
  modify(
    element: HTMLElement,
    _positional: [],
    { target, total, unit }: ProgressChartModifierSignature['Args']['Named'],
  ) {
    total = total ?? 0;
    target = target ?? 0;
    Chart.register(...registerables);
    new Chart(element, {
      type: 'doughnut',
      data: {
        labels: [`progress (${unit})`, `remaining (${unit})`],
        datasets: [
          {
            label: ['Cycling Mileage Log'],
            data: [total, target - total],
            backgroundColor: ['rgb(255, 99, 132)', 'rgb(220, 220, 220)'],
            hoverOffset: 4,
          },
        ],
      },
    });
  }
}

class CyclingLogEntry extends FieldDef {
  static displayName = 'Cycling Log Entry';

  @field date = contains(Date);
  @field origin = contains(StringField);
  @field destination = contains(StringField);
  @field distance = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='entry'>
        <span>Date: <@fields.date /></span>
        <span>Routes: <@fields.origin /> - <@fields.destination /></span>
        <span>Distance: <@fields.distance /> KM</span>
      </div>
      <style>
        .entry {
          display: flex;
          flex-direction: column;
          padding: var(--boxel-sp);
          border: var(--boxel-border);
        }
      </style>
    </template>
  };
}

export class CyclingMileageLog extends CardDef {
  static displayName = 'Cycling Mileage Log';

  @field target = contains(NumberField);
  @field startDate = contains(Date);
  @field endDate = contains(Date);
  @field unit = contains(StringField);
  @field total = contains(NumberField, {
    computeVia: function (this: CyclingMileageLog) {
      let sum = 0;
      for (let entry of this.entries) {
        if (
          isEqual(entry.date, this.startDate) ||
          isEqual(entry.date, this.endDate) ||
          (isAfter(entry.date, this.startDate) &&
            isBefore(entry.date, this.endDate))
        ) {
          sum += entry.distance;
        }
      }
      return sum;
    },
  });
  @field successPercentage = contains(NumberField, {
    computeVia: function (this: CyclingMileageLog) {
      return ((this.total / this.target) * 100).toFixed(2);
    },
  });
  @field entries = containsMany(CyclingLogEntry);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='cycling-mileage-log'>
        <div class='summary'>
          <span>Date Range: <@fields.startDate /> - <@fields.endDate /></span>
          <span>Target: <@fields.target /> <@fields.unit /></span>
          <span>Progress: <@fields.total /> <@fields.unit /></span>
          <span>Success Percentage: <@fields.successPercentage /> %</span>
        </div>
        <div class='chart'>
          <canvas
            id='progress-chart'
            {{ProgressChartModifier
              total=this.args.model.total
              target=this.args.model.target
              unit=this.args.model.unit
            }}
          />
        </div>
        <div class='entries'>
          <@fields.entries />
        </div>
      </div>
      <style>
        .summary {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: var(--boxel-sp-xs);
          margin-bottom: var(--boxel-sp-lg);
        }
        .chart {
          display: flex;
          justify-content: center;
          max-height: 400px;
        }
        .cycling-mileage-log {
          display: flex;
          flex-direction: column;
          padding: var(--boxel-sp);
        }
        .entries {
          padding: var(--boxel-sp);
        }
      </style>
    </template>
  };
}
