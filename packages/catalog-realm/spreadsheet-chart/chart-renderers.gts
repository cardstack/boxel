import { eq } from '@cardstack/boxel-ui/helpers';
import { concat } from '@ember/helper';
import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';

interface Signature {
  Args: {
    chartData: any;
  };
}

export class ChartsRenderer extends GlimmerComponent<Signature> {
  get chartTypeClass(): string {
    const typeMap: Record<string, string> = {
      bar: 'column',
      horizontalBar: 'bar',
      stackedBar: 'column',
      pie: 'pie',
      line: 'line',
    };
    return typeMap[this.args.chartData?.chartType] || 'column';
  }

  getDisplayValue(item: any): number {
    // Return the first valid numeric value found
    const value = item.value ?? item.total ?? item.size ?? 0;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  getCSSProps(item: any, chartType: string, segment?: 'A' | 'B') {
    const props: Record<string, string> = {};

    if (chartType === 'stackedBar') {
      const size = segment === 'B' ? item.sizeB || 0 : item.sizeA || 0;
      const color =
        segment === 'B'
          ? item.colorB || item.color || 'var(--chart-5, #ef4444)'
          : item.colorA || item.color || 'var(--chart-1, #3b82f6)';
      props['--size'] = String(size);
      props['--color'] = color;
    } else if (chartType === 'pie' || chartType === 'line') {
      props['--start'] = String(item.start || 0);
      props['--end'] = String(item.end || 0);
      props['--color'] = item.color || 'var(--chart-1, #3b82f6)';
    } else {
      props['--size'] = String(item.size || item.normalizedSize || 0);
      props['--color'] = item.color || 'var(--chart-1, #3b82f6)';
    }

    return htmlSafe(
      Object.entries(props)
        .map(([key, value]) => `${key}: ${value}`)
        .join('; '),
    );
  }

  get legendItems() {
    const chartType = this.args.chartData?.chartType;
    const data = this.args.chartData?.data || [];
    const labels = this.args.chartData?.labels || [];

    if (chartType === 'stackedBar' && labels.length >= 2) {
      return [
        { label: labels[0], color: 'var(--chart-1, #3b82f6)' },
        { label: labels[1], color: 'var(--chart-5, #ef4444)' },
      ];
    } else if (chartType === 'pie') {
      return data.map((item: any) => ({
        label: item.category,
        color: item.color || 'var(--chart-1, #3b82f6)',
      }));
    }

    return [];
  }

  get showLegend() {
    const chartType = this.args.chartData?.chartType;
    return (
      (chartType === 'stackedBar' &&
        this.args.chartData?.labels?.length >= 2) ||
      chartType === 'pie'
    );
  }

  get firstLabel() {
    return this.args.chartData?.labels?.[0] || 'Series A';
  }

  get secondLabel() {
    return this.args.chartData?.labels?.[1] || 'Series B';
  }

  getChartClasses(chartType: string) {
    const classes = ['charts-css'];

    if (chartType === 'stackedBar') {
      classes.push('column', 'stacked', 'multiple');
    } else if (chartType === 'horizontalBar') {
      classes.push('bar');
    } else if (chartType === 'bar') {
      classes.push('column');
    } else if (chartType === 'pie') {
      classes.push('pie');
    } else if (chartType === 'line') {
      classes.push('line');
    } else {
      classes.push('column');
    }

    classes.push('show-labels');
    if (chartType !== 'pie' && chartType !== 'donut') {
      classes.push('show-primary-axis', 'show-data-axes');
    }
    if (chartType === 'stackedBar') {
      classes.push('data-spacing-3');
    }

    return classes.join(' ');
  }

  <template>
    <div class='charts-container'>
      {{#if @chartData.data.length}}
        {{! template-lint-disable table-groups }}
        <table class={{this.getChartClasses @chartData.chartType}}>
          <caption>{{@chartData.title}}</caption>

          {{#if (eq @chartData.chartType 'stackedBar')}}
            <thead>
              <tr>
                <th scope='col'>Category</th>
                <th scope='col'>{{this.firstLabel}}</th>
                <th scope='col'>{{this.secondLabel}}</th>
              </tr>
            </thead>
            <tbody>
              {{#each @chartData.data as |item|}}
                <tr>
                  <th scope='row'>{{item.category}}</th>
                  <td style={{this.getCSSProps item @chartData.chartType 'A'}}>
                    <span class='data'>{{item.valueA}}</span>
                  </td>
                  <td style={{this.getCSSProps item @chartData.chartType 'B'}}>
                    <span class='data'>{{item.valueB}}</span>
                  </td>
                </tr>
              {{/each}}
            </tbody>

          {{else if (eq @chartData.chartType 'pie')}}
            <tbody>
              {{#each @chartData.data as |item|}}
                <tr>
                  <th scope='row'>{{item.category}}</th>
                  <td style={{this.getCSSProps item @chartData.chartType}}>
                    <span class='data'>{{item.value}}</span>
                  </td>
                </tr>
              {{/each}}
            </tbody>

          {{else if (eq @chartData.chartType 'line')}}
            <div
              class='line-chart-wrapper'
              id='line-chart-{{@chartData.chartType}}'
            >
              <table class={{this.getChartClasses @chartData.chartType}}>
                <caption>{{@chartData.title}}</caption>
                <tbody>

                  {{#each @chartData.data as |item|}}
                    <tr>
                      <th scope='row'>{{item.fullLabel}}</th>
                      <td
                        style={{this.getCSSProps item @chartData.chartType}}
                        title='{{item.fullLabel}}: {{item.value}}'
                      >
                        <span class='data'>{{item.value}}</span>
                      </td>
                    </tr>
                  {{/each}}

                </tbody>
              </table>

              {{#if @chartData.xAxisLabel}}
                <div class='primary-axis'>{{@chartData.xAxisLabel}}</div>
              {{/if}}

              {{#if @chartData.yAxisLabel}}
                <div class='data-axis-1'>{{@chartData.yAxisLabel}}</div>
              {{/if}}
            </div>

          {{else}}
            <thead>
              <tr>
                <th scope='col'>Category</th>
                <th scope='col'>Value</th>
              </tr>
            </thead>
            <tbody>
              {{#each @chartData.data as |item|}}
                <tr>
                  <th scope='row'>{{item.category}}</th>
                  <td style={{this.getCSSProps item @chartData.chartType}}>
                    <span class='data'>{{this.getDisplayValue item}}</span>
                  </td>
                </tr>
              {{/each}}
            </tbody>
          {{/if}}
        </table>

        {{#if this.showLegend}}
          <div class='modern-legend'>
            {{#each this.legendItems as |item|}}
              <div class='legend-item'>
                <div
                  class='legend-color'
                  style={{htmlSafe (concat 'background-color: ' item.color)}}
                ></div>
                <span class='legend-label'>{{item.label}}</span>
              </div>
            {{/each}}
          </div>
        {{/if}}

      {{else}}
        <div class='empty-chart'>
          <p>No data available for visualization</p>
        </div>
      {{/if}}
    </div>
    <style scoped>
      .charts-container {
        width: 100%;
        height: 100%;
        padding: 1rem;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        background: var(--card, #ffffff);
      }

      .charts-css {
        width: 100%;
        height: auto;
        min-height: 300px;
        margin: 0;
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;

        --color-1: var(--chart-1, #3b82f6);
        --color-2: var(--chart-2, #8b5cf6);
        --color-3: var(--chart-3, #10b981);
        --color-4: var(--chart-4, #f59e0b);
        --color-5: var(--chart-5, #ef4444);
        --color-6: var(--chart-6, #06b6d4);
        --color-7: var(--chart-7, #f97316);
        --color-8: var(--chart-8, #6b7280);

        --labels-size: 0.75rem;
        --data-size: 0.6875rem;

        --datasets-spacing: 4px;
        --data-spacing: 2px;

        --animation-duration: 0.8s;
        --animation-delay: 0.1s;
      }

      .charts-css.column {
        --datasets-spacing: 6px;
      }

      .charts-css.bar {
        --datasets-spacing: 4px;
      }

      .charts-css.pie {
        --datasets-spacing: 2px;
        margin: 0 auto;
        max-width: 400px;
        max-height: 400px;
      }

      .charts-css.pie tbody {
        width: auto;
        margin: 0 auto;
        height: 100%;
      }

      .line-chart-wrapper {
        display: grid;
        align-items: center;
        justify-items: center;
        grid-template-columns: 36px 1fr;
        grid-template-rows: auto 32px;
        grid-template-areas:
          'data-axis-1 chart'
          '. primary-axis';
        width: 100%;
        height: 100%;
        gap: 0.25rem;
      }

      .line-chart-wrapper .charts-css.line {
        grid-area: chart;
        --datasets-spacing: 0;
        padding-left: 4px;
        overflow-x: auto;
        display: block;
        white-space: nowrap;
        width: 100%;
        height: auto;
        min-height: 0;
        margin: 0;
      }

      .line-chart-wrapper .primary-axis {
        grid-area: primary-axis;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--foreground, #374151);
        text-align: center;
        padding: 0.25rem 0;
        line-height: 1.1;
      }

      .line-chart-wrapper .data-axis-1 {
        grid-area: data-axis-1;
        writing-mode: tb-rl;
        transform: rotateZ(180deg);
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--foreground, #374151);
        text-align: center;
        padding: 0.25rem 0;
        line-height: 1.1;
      }

      .charts-css.line tbody tr {
        display: inline-flex;
        width: max-content;
      }

      .charts-css.line td {
        width: 80px;
        position: relative;
      }

      .charts-css tbody th {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--foreground, #374151);
      }

      .charts-css tbody td {
        position: relative;
      }

      .charts-css .data {
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--foreground, #1f2937);
        text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
      }

      caption {
        font-size: 1rem;
        font-weight: 600;
        color: var(--foreground, #1f2937);
        margin-bottom: 1rem;
        text-align: left;
        caption-side: top;
      }

      .modern-legend {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 1.5rem;
        margin-top: 1rem;
        padding: 0.875rem 1rem;
        background: var(--background, rgba(248, 250, 252, 0.5));
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 0.5rem;
        font-size: 0.8125rem;
        min-height: 2.5rem;
        box-sizing: border-box;
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        flex-shrink: 0;
        min-width: 0;
      }

      .legend-color {
        width: 1rem;
        height: 1rem;
        border-radius: 0.25rem;
        border: 1px solid rgba(0, 0, 0, 0.15);
        flex-shrink: 0;
        display: block;
      }

      .legend-label {
        color: var(--foreground, #374151);
        font-weight: 500;
        line-height: 1.3;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      @media (max-width: 640px) {
        .modern-legend {
          flex-wrap: wrap;
          gap: 0.75rem;
          justify-content: flex-start;
        }

        .legend-label {
          max-width: 100px;
        }
      }

      .empty-chart {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 200px;
        border: 2px dashed var(--border, #d1d5db);
        border-radius: 0.5rem;
        background: var(--background, #f9fafb);
      }

      .empty-chart p {
        color: #6b7280;
        font-size: 0.875rem;
        margin: 0;
      }

      .chart-summary {
        margin-top: 0.75rem;
        padding-top: 0.75rem;
        border-top: 1px solid #e5e7eb;
        text-align: center;
      }

      .summary-text {
        font-size: 0.875rem;
        color: #6b7280;
        font-weight: 500;
      }

      @media (max-width: 768px) {
        .charts-container {
          padding: 0.75rem;
        }

        .charts-css {
          min-height: 250px;
          --labels-size: 0.6875rem;
          --data-size: 0.625rem;
        }

        caption {
          font-size: 0.875rem;
        }

        .line-chart-wrapper {
          grid-template-columns: 1fr;
          grid-template-rows: auto 1fr auto;
          grid-template-areas:
            'data-axis-1'
            'chart'
            'primary-axis';
          gap: 0.25rem;
        }

        .line-chart-wrapper .data-axis-1 {
          writing-mode: horizontal-tb;
          transform: none;
          font-size: 0.75rem;
          padding: 0.125rem 0;
        }

        .line-chart-wrapper .primary-axis {
          font-size: 0.75rem;
          padding: 0.125rem 0;
        }
      }

      @media (max-width: 480px) {
        .charts-css {
          min-height: 200px;
          --labels-size: 0.625rem;
          --data-size: 0.5625rem;
        }
      }

      @media (prefers-contrast: high) {
        .charts-css {
          --color-1: #000080;
          --color-2: #800080;
          --color-3: #008000;
          --color-4: #ff8c00;
          --color-5: #dc143c;
          --color-6: #00ced1;
          --color-7: #ff4500;
          --color-8: #2f4f4f;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .charts-css tbody tr {
          animation: none;
        }

        .charts-css tbody tr:hover td {
          transform: none;
        }
      }
    </style>
    <link
      rel='stylesheet'
      href='https://cdn.jsdelivr.net/npm/charts.css/dist/charts.min.css'
    />
  </template>
}
