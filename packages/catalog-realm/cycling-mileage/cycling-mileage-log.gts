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
import BikeIcon from '@cardstack/boxel-icons/bike';

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
            backgroundColor: ['#FC4C02', '#f2f2f2'],
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
        <div class='entry-date'><@fields.date /></div>
        <div class='entry-details'>
          <div class='entry-route'><@fields.origin />
            →
            <@fields.destination /></div>
          <div class='entry-distance'><@fields.distance />
            <span class='unit'>KM</span></div>
        </div>
      </div>
      <style scoped>
        .entry {
          display: flex;
          align-items: center;
          padding: 16px;
          border-bottom: 1px solid #e5e5e5;
          margin-bottom: 8px;
          border-radius: 8px;
          background-color: white;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
          transition: background-color 0.2s ease;
        }
        .entry:hover {
          background-color: #f9f9f9;
        }
        .entry-date {
          font-weight: 600;
          color: #242428;
          width: 120px;
        }
        .entry-details {
          flex: 1;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .entry-route {
          color: #666;
          font-size: 0.95em;
        }
        .entry-distance {
          font-weight: 700;
          color: #fc4c02;
          font-size: 1.1em;
        }
        .unit {
          font-weight: normal;
          color: #666;
          font-size: 0.85em;
        }
      </style>
    </template>
  };
}

export class CyclingMileageLog extends CardDef {
  static displayName = 'Cycling Mileage Log';
  static icon = BikeIcon;

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
        <div class='header'>
          <h2 class='title'>Cycling Progress</h2>
        </div>

        <div class='stats-container'>
          <div class='summary'>
            <div class='stat-block'>
              <div class='stat-label'>Date Range</div>
              <div class='stat-value date-range'><@fields.startDate />
                -
                <@fields.endDate /></div>
            </div>
            <div class='stat-block'>
              <div class='stat-label'>Target</div>
              <div class='stat-value'><@fields.target />
                <span class='unit'><@fields.unit /></span></div>
            </div>
            <div class='stat-block'>
              <div class='stat-label'>Progress</div>
              <div class='stat-value'><@fields.total />
                <span class='unit'><@fields.unit /></span></div>
            </div>
            <div class='stat-block'>
              <div class='stat-label'>Success Rate</div>
              <div class='stat-value'><@fields.successPercentage />%</div>
            </div>
          </div>
        </div>

        <div class='chart-container'>
          <canvas
            id='progress-chart'
            {{ProgressChartModifier
              total=@model.total
              target=@model.target
              unit=@model.unit
            }}
          />
        </div>

        <div class='entries-header'>
          <h3>Activity Log</h3>
        </div>
        <div class='entries'>
          <@fields.entries />
        </div>
      </div>
      <style scoped>
        .cycling-mileage-log {
          display: flex;
          flex-direction: column;
          padding: 20px;
          background-color: #f8f8fa;
          border-radius: 8px;
          font-family:
            -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .header {
          margin-bottom: 20px;
        }
        .title {
          color: #242428;
          font-size: 24px;
          font-weight: 600;
          margin: 0;
        }
        .stats-container {
          display: flex;
          margin-bottom: 20px;
          background-color: white;
          border-radius: 8px;
          padding: 15px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }
        .summary {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          flex: 1;
          justify-content: space-between;
        }
        .stat-block {
          display: flex;
          flex-direction: column;
          padding: 10px;
          border-radius: 6px;
          background-color: transparent;
          box-shadow: none;
          transition: transform 0.2s ease;
        }
        .stat-block:hover {
          transform: translateY(-2px);
        }
        .stat-label {
          font-size: 13px;
          color: #666;
          margin-bottom: 4px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 500;
        }
        .stat-value {
          font-size: 20px;
          font-weight: 700;
          background: linear-gradient(90deg, #fc4c02, #ff6833);
          background-clip: text;
          -webkit-background-clip: text;
          color: transparent;
          text-shadow: 0px 0px 1px rgba(0, 0, 0, 0.1);
          white-space: nowrap;
        }
        .date-range {
          font-size: 16px;
        }
        .unit {
          font-weight: normal;
          color: #666;
          font-size: 0.6em;
          margin-left: 2px;
        }
        .chart-container {
          background-color: white;
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 20px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
          display: flex;
          justify-content: center;
          align-items: center;
          height: 300px;
        }
        .entries-header {
          margin: 16px 0;
          padding-bottom: 8px;
          border-bottom: 2px solid #fc4c02;
        }
        .entries-header h3 {
          color: #242428;
          font-size: 18px;
          font-weight: 600;
          margin: 0;
        }
        .entries {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
      </style>
    </template>
  };
}
