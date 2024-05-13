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
// @ts-ignore
import {
  Chart,
  registerables,
  // @ts-ignore
} from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.2/+esm';
import Modifier from 'ember-modifier';

type ProgressChartModifierSignature = {
  Args: {
    Named: {
      target?: number;
      total?: number;
    };
  };
  Element: HTMLElement;
};

class ProgressChartModifier extends Modifier<ProgressChartModifierSignature> {
  modify(
    element: HTMLElement,
    _positional: [],
    { target, total }: ProgressChartModifierSignature['Args']['Named'],
  ) {
    total = total ?? 0;
    target = target ?? 0;
    Chart.register(...registerables);
    new Chart(element, {
      type: 'doughnut',
      data: {
        labels: ['progress (KM)', 'remaining (KM)'],
        datasets: [
          {
            label: ['Cycling Mileage Log'],
            data: [total, target - total],
            backgroundColor: ['rgb(255, 99, 132)', 'rgb(54, 162, 235)'],
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
  @field total = contains(NumberField, {
    computeVia: function (this: CyclingMileageLog) {
      let sum = 0;
      for (let entry of this.entries) {
        sum += entry.distance;
      }
      return sum;
    },
  });
  @field successPercentage = contains(NumberField, {
    computeVia: function (this: CyclingMileageLog) {
      return this.total / this.target;
    },
  });
  @field entries = containsMany(CyclingLogEntry);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='cycling-mileage-log'>
        <div class='summary'>
          <span>Target: <@fields.target /> KM</span>
          <span>Progress: <@fields.total /> KM</span>
          <span>Success Percentage: <@fields.successPercentage /></span>
        </div>
        <div class='chart'>
          <canvas
            id='progress-chart'
            {{ProgressChartModifier
              total=this.args.model.total
              target=this.args.model.target
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
