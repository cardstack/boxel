import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import { Spreadsheet } from '../spreadsheet/spreadsheet';
import {
  Button,
  BoxelSelect,
  FieldContainer,
} from '@cardstack/boxel-ui/components';
import ChartIcon from '@cardstack/boxel-icons/chart-bar-popular';
import { ChartsRenderer } from './chart-renderers';
import type Owner from '@ember/owner';

// Shared CSV utilities
class CSVParser {
  static parseCSVLine(line: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];

      if (ch === '"' && !inQuotes) {
        inQuotes = true;
      } else if (ch === '"' && inQuotes && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"' && inQuotes) {
        inQuotes = false;
      } else if (ch === delimiter && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  static getDelimiter(source: any): string {
    try {
      const d = source?.delimiter;
      if (d === '\\t') return '\t';
      return d || ',';
    } catch {
      return ',';
    }
  }

  static parseCSV(csvText: string, delimiter: string) {
    const text = csvText?.trim();
    if (!text) return { headers: [], rows: [] };

    const lines = text.split('\n');
    if (lines.length <= 1) return { headers: [], rows: [] };

    const headers = this.parseCSVLine(lines[0], delimiter);
    const rows = lines
      .slice(1)
      .map((line) => this.parseCSVLine(line, delimiter));

    return { headers, rows };
  }
}

class DataAnalyzer {
  static uniqueValues(rows: string[][], colIndex: number): string[] {
    const set = new Set<string>();
    for (const row of rows) {
      const value = (row[colIndex] ?? '').trim();
      if (value !== '') set.add(value);
    }
    return Array.from(set);
  }

  static normalizeBooleanLabel(value: string): string | undefined {
    const normalized = (value || '').trim().toLowerCase();
    const trueValues = [
      'true',
      'yes',
      'y',
      '1',
      'pass',
      'passed',
      'success',
      'active',
    ];
    const falseValues = ['false', 'no', 'n', '0', 'fail', 'failed', 'inactive'];

    if (trueValues.includes(normalized)) {
      return normalized === '1'
        ? 'Yes'
        : normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }
    if (falseValues.includes(normalized)) {
      return normalized === '0'
        ? 'No'
        : normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }
    return undefined;
  }

  static findBestCategoryColumn(
    headers: string[],
    rows: string[][],
    preferredHeader?: string | null,
  ): { index: number; label?: string } {
    // Try preferred header first
    if (preferredHeader) {
      const index = headers.indexOf(preferredHeader);
      if (index >= 0) return { index, label: headers[index] };
    }

    // Score columns by unique value count (prefer 2-30 unique values, optimal around 8)
    const candidates = headers
      .map((_, index) => {
        const uniques = this.uniqueValues(rows, index);
        if (uniques.length < 2 || uniques.length > 30) return null;

        const score = Math.max(0, 30 - Math.abs(8 - uniques.length));
        return { index, uniques, score };
      })
      .filter(Boolean);

    candidates.sort((a, b) => b!.score - a!.score);

    if (candidates.length > 0) {
      return {
        index: candidates[0]!.index,
        label: headers[candidates[0]!.index],
      };
    }

    // Fallback to first column
    return headers.length > 0 ? { index: 0, label: headers[0] } : { index: -1 };
  }

  static findBinaryColumn(
    headers: string[],
    rows: string[][],
    categoryIndex: number,
    preferredHeader?: string | null,
  ): { index: number; kinds?: [string, string] } {
    // Try preferred header first
    if (preferredHeader) {
      const index = headers.indexOf(preferredHeader);
      if (index >= 0) {
        const uniques = this.uniqueValues(rows, index);
        if (uniques.length === 2) {
          const normalized = uniques.map(
            (u) => this.normalizeBooleanLabel(u) || u,
          );
          return {
            index,
            kinds: [normalized[0], normalized[1]] as [string, string],
          };
        }
      }
    }

    // Find best binary column (exactly 2 unique values, prefer boolean-like)
    const candidates = headers
      .map((_, index) => {
        if (index === categoryIndex) return null;

        const uniques = this.uniqueValues(rows, index);
        if (uniques.length !== 2) return null;

        const normalized = uniques.map((u) => this.normalizeBooleanLabel(u));
        const isBooleanLike = normalized.every((n) => n !== undefined);
        const score = isBooleanLike ? 10 : 1;

        return { index, uniques, score };
      })
      .filter(Boolean);

    candidates.sort((a, b) => b!.score - a!.score);

    if (candidates.length > 0) {
      const best = candidates[0]!;
      const kinds = best.uniques.map(
        (u) => this.normalizeBooleanLabel(u) || u,
      ) as [string, string];
      return { index: best.index, kinds };
    }

    return { index: -1 };
  }
}

export class SpreadsheetChartIsolated extends Component<
  typeof SpreadsheetChart
> {
  get csvData() {
    try {
      const csvText = this.args.model?.source?.csvData ?? '';
      const delimiter = CSVParser.getDelimiter(this.args.model?.source);
      return CSVParser.parseCSV(csvText, delimiter);
    } catch {
      return { headers: [], rows: [] };
    }
  }

  get columnAnalysis() {
    const { rows, headers } = this.csvData;
    const prefCategory = this.args.model?.categoryHeader;
    const prefBinary = this.args.model?.binaryHeader;

    const category = DataAnalyzer.findBestCategoryColumn(
      headers,
      rows,
      prefCategory,
    );
    const binary =
      category.index >= 0
        ? DataAnalyzer.findBinaryColumn(
            headers,
            rows,
            category.index,
            prefBinary,
          )
        : { index: -1 };

    return {
      categoryIndex: category.index,
      categoryLabel: category.label,
      binaryIndex: binary.index,
      binaryKinds: binary.kinds,
      hasBinary: binary.index >= 0,
    };
  }

  get processedData() {
    const { rows } = this.csvData;
    const { categoryIndex, binaryIndex, binaryKinds, hasBinary } =
      this.columnAnalysis;

    if (categoryIndex < 0) {
      return { items: [], max: 0, hasBinary: false, kinds: undefined };
    }

    const categoryData: Record<
      string,
      { a: number; b: number; total: number }
    > = {};
    let aLabel: string | undefined;
    let bLabel: string | undefined;

    // Establish binary labels
    if (hasBinary && binaryKinds) {
      [aLabel, bLabel] = binaryKinds;
    }

    // Process each row
    for (const row of rows) {
      const category =
        (row[categoryIndex] || 'Uncategorized').trim() || 'Uncategorized';
      const entry = (categoryData[category] ||= { a: 0, b: 0, total: 0 });

      if (hasBinary) {
        const binaryValue = (row[binaryIndex] ?? '').trim();

        // Establish labels dynamically if not provided
        if (aLabel === undefined) aLabel = binaryValue || 'A';
        else if (binaryValue !== aLabel && bLabel === undefined)
          bLabel = binaryValue || 'B';

        if (binaryValue === aLabel) entry.a += 1;
        else entry.b += 1;
      } else {
        entry.a += 1;
      }
      entry.total += 1;
    }

    // Convert to sorted array
    let items = Object.entries(categoryData).map(([category, data]) => ({
      category,
      a: data.a,
      b: data.b,
      total: data.total,
    }));

    items.sort((x, y) => y.total - x.total);

    // Apply topN limit
    const topN = Math.max(1, Math.min(50, Number(this.args.model?.topN) || 20));
    items = items.slice(0, topN);

    const max = items.reduce((m, item) => Math.max(m, item.total), 0);
    const kinds: [string, string] | undefined = hasBinary
      ? binaryKinds ?? ([aLabel ?? 'A', bLabel ?? 'B'] as [string, string])
      : undefined;

    return { items, max, hasBinary, kinds };
  }

  get chartData() {
    const { items, max, kinds, hasBinary } = this.processedData;
    const { headers } = this.csvData;
    const chartType = this.effectiveChartType;

    const colorPalette = [
      'var(--chart-1, #3b82f6)',
      'var(--chart-2, #8b5cf6)',
      'var(--chart-3, #10b981)',
      'var(--chart-4, #f59e0b)',
      'var(--chart-5, #ef4444)',
      'var(--chart-6, #06b6d4)',
      'var(--chart-7, #f97316)',
      'var(--chart-8, #6b7280)',
    ];
    const safeValue = (n: number) => (Number.isFinite(n) && n > 0 ? n : 1);

    let data: any[] = [];
    let labels: string[] = [];
    let maxValue = 1;

    switch (chartType) {
      case 'line':
        const lineResult = this.generateLineChartData(headers);

        // Validate line chart data
        if (!lineResult.data || lineResult.data.length === 0) {
          console.warn('LineChart: No data generated, check X/Y headers');
          return {
            chartType,
            labels: [],
            data: [],
            maxValue: 1,
            xAxisLabel: lineResult.xAxisLabel || 'X-Axis',
            yAxisLabel: lineResult.yAxisLabel || 'Y-Axis',
          };
        }

        data = lineResult.data;
        const xAxisLabel = lineResult.xAxisLabel;
        const yAxisLabel = lineResult.yAxisLabel;

        // Calculate max value safely
        const values = data
          .map((d) => d.value)
          .filter((v) => Number.isFinite(v));
        maxValue = values.length > 0 ? Math.max(...values, 1) : 1;

        return {
          chartType,
          labels,
          data,
          maxValue,
          xAxisLabel,
          yAxisLabel,
        };
      case 'pie':
        if (items.length > 0) {
          const total = items.reduce((sum, item) => sum + item.total, 0);
          maxValue = safeValue(total);
          let cumulativeStart = 0;

          data = items.map((item, i) => {
            const size = total > 0 ? item.total / total : 0;
            const start = cumulativeStart;
            const end = cumulativeStart + size;
            cumulativeStart = end;

            return {
              category: item.category,
              value: item.total,
              start: start,
              end: end,
              color: colorPalette[i % colorPalette.length],
            };
          });
        }
        break;

      case 'stackedBar':
        if (hasBinary && kinds) {
          labels = [kinds[0], kinds[1]];
          const globalMax = safeValue(max);
          data = items.map((item) => ({
            category: item.category,
            valueA: item.a,
            valueB: item.b,
            sizeA: item.a / globalMax,
            sizeB: item.b / globalMax,
            colorA: colorPalette[0],
            colorB: colorPalette[4],
          }));
          maxValue = Math.max(...items.map((item) => item.total), 1);
        } else {
          data = this.generateBarChartData(items, colorPalette);
          maxValue = Math.max(...items.map((item) => item.total), 1);
        }
        break;
      default:
        data = this.generateBarChartData(items, colorPalette);
        maxValue = Math.max(...items.map((item) => item.total), 1);
        break;
    }

    return { chartType, labels, data, maxValue };
  }

  private generateLineChartData(headers: string[]) {
    const { rows } = this.csvData;

    const xName = this.args.model?.xHeader || headers[0] || 'X-Axis';
    const yName = this.args.model?.yHeader || headers[1] || 'Y-Axis';

    const xIndex = headers.indexOf(xName);
    const yIndex = headers.indexOf(yName);
    if (xIndex < 0 || yIndex < 0 || !rows.length)
      return { data: [], xAxisLabel: xName, yAxisLabel: yName };

    const parseNumber = (s: string): number | null => {
      const cleaned = s.replace(/[^0-9+\-Ee.]/g, '');
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : null;
    };

    const points: Array<{ x: string; y: number }> = [];
    for (const row of rows) {
      const x = (row[xIndex] ?? '').trim();
      const y = parseNumber((row[yIndex] ?? '').trim());
      if (x && y != null) points.push({ x, y });
    }

    if (!points.length)
      return { data: [], xAxisLabel: xName, yAxisLabel: yName };

    points.sort((a, b) => {
      const aNum = parseFloat(a.x);
      const bNum = parseFloat(b.x);
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
      return a.x.localeCompare(b.x, undefined, { numeric: true });
    });

    const topN = Math.max(
      1,
      Math.min(100, Number(this.args.model?.topN) || points.length),
    );
    const limited = points.slice(0, topN);

    const yVals = limited.map((p) => p.y);
    const yMin = Math.min(...yVals, 0);
    const yMax = Math.max(...yVals);
    const range = yMax - yMin || 1;

    const data = limited.map((p, i) => ({
      category: p.x,
      value: p.y,
      start: i === 0 ? (p.y - yMin) / range : (limited[i - 1].y - yMin) / range,
      end: (p.y - yMin) / range,
      color: 'var(--chart-1, #3b82f6)',
      fullLabel: p.x,
    }));

    return { data, xAxisLabel: xName, yAxisLabel: yName };
  }

  private generateBarChartData(items: any[], colorPalette: string[]) {
    if (items.length === 0) return [];

    const validItems = items.filter((item) => {
      const value = item.total || item.value || item.a || 0;
      return typeof value === 'number' && Number.isFinite(value);
    });

    if (validItems.length === 0) return [];

    const maxValue = Math.max(
      ...validItems.map((item) => {
        return item.total || item.value || item.a || 0;
      }),
    );

    return validItems.map((item, i) => {
      const value = item.total || item.value || item.a || 0;
      return {
        category: item.category,
        value: value,
        size: value / (maxValue || 1),
        color: colorPalette[i % colorPalette.length],
      };
    });
  }

  get effectiveChartType(): string {
    try {
      const requestedType = (
        this.args.model?.chartType?.trim() || 'auto'
      ).toLowerCase();
      const { hasBinary } = this.columnAnalysis;

      const typeMap: Record<string, string> = {
        horizontalbar: 'horizontalBar',
        stackedbar: hasBinary ? 'stackedBar' : 'bar',
        bar: 'bar',
        pie: 'pie',
        line: 'line',
        auto: hasBinary ? 'stackedBar' : 'bar',
      };

      return typeMap[requestedType] || 'bar';
    } catch {
      return 'bar';
    }
  }

  get showChart(): boolean {
    try {
      return (
        Array.isArray(this.chartData?.data) && this.chartData.data.length > 0
      );
    } catch {
      return false;
    }
  }

  openSource = () => {
    try {
      const src = this.args.model?.source;
      if (!src) return;
      if (this.args.viewCard) {
        this.args.viewCard(src, 'isolated', { openCardInRightMostStack: true });
      }
    } catch (e) {
      console.error('Open source failed', e);
    }
  };

  <template>
    <div class='chart-container'>
      <header class='chart-header'>
        <div class='head-left'>
          <h1 class='chart-title'>
            <svg
              class='title-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M3 3v18h18' />
              <path d='M18.7 8l-5.1 5.2-2.8-2.7L7 14.3' />
            </svg>
            {{@model.title}}
          </h1>
        </div>
        <div class='chart-controls'>
          {{#if @model.source}}
            <Button
              class='open-source-btn'
              {{on 'click' this.openSource}}
              title='Open source spreadsheet in side panel'
            >
              <svg
                class='btn-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path
                  d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                />
                <polyline points='14,2 14,8 20,8' />
                <line x1='16' y1='13' x2='8' y2='13' />
                <line x1='16' y1='17' x2='8' y2='17' />
                <polyline points='10,9 9,9 8,9' />
              </svg>
              View Source
            </Button>
          {{/if}}
        </div>
      </header>

      {{#if this.showChart}}
        <div class='chart-wrapper'>
          <ChartsRenderer @chartData={{this.chartData}} />
        </div>
      {{else}}
        <div class='empty-state'>
          <svg
            class='empty-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='1.5'
          >
            <path d='M9 17H7A5 5 0 0 1 7 7h2' />
            <path d='M15 7h2a5 5 0 1 1 0 10h-2' />
            <line x1='8' y1='12' x2='16' y2='12' />
          </svg>
          <div class='empty-content'>
            {{#if (eq this.processedData.items.length 0)}}
              <h3>No Data Available</h3>
              <p>No data found in the linked spreadsheet. Please ensure your
                spreadsheet contains data.</p>
            {{else}}
              <h3>Unable to Generate Chart</h3>
              <p>Cannot process the data. Please check your column selections in
                the edit mode.</p>
            {{/if}}
          </div>
        </div>
      {{/if}}

      <footer class='chart-footer'>
        {{#if @model.source}}
          <div class='source-attribution'>
            <svg
              class='source-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='1.5'
            >
              <path
                d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
              />
              <polyline points='14,2 14,8 20,8' />
            </svg>
            <span>Data source: <strong>{{@model.source.title}}</strong></span>
          </div>
        {{/if}}
        <span class='chart-type-label'>{{this.chartData.chartType}}</span>
      </footer>
    </div>
    <style scoped>
      .chart-container {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1.5rem;
        height: 100%;
        box-sizing: border-box;
        background: var(--card, #ffffff);
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
      }

      .chart-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        padding-bottom: 1rem;
        border-bottom: 2px solid var(--border, #e5e7eb);
      }

      .head-left {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        flex: 1;
      }

      .chart-title {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin: 0;
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--foreground, #111827);
        line-height: 1.2;
      }

      .title-icon {
        width: 1.75rem;
        height: 1.75rem;
        color: var(--chart-1, #3b82f6);
        flex-shrink: 0;
      }

      .chart-controls {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
      }

      .open-source-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.625rem 1rem;
        font-size: 0.875rem;
        font-weight: 600;
        background: var(--primary, #10b981);
        color: var(--primary-foreground, #ffffff);
        border: none;
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .open-source-btn:hover {
        background: var(--primary-hover, #059669);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      }

      .btn-icon {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
      }

      .chart-wrapper {
        flex: 1;
        min-height: 400px;
        background: var(--background, #ffffff);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 0.75rem;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
        overflow: hidden;
        position: relative;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        padding: 3rem 2rem;
        border: 2px dashed #d1d5db;
        background: #f9fafb;
        border-radius: 0.75rem;
        text-align: center;
        min-height: 200px;
      }

      .empty-icon {
        width: 3rem;
        height: 3rem;
        color: #9ca3af;
      }

      .empty-content h3 {
        margin: 0 0 0.5rem 0;
        font-size: 1.125rem;
        font-weight: 600;
        color: #374151;
      }

      .empty-content p {
        margin: 0 0 0.75rem 0;
        font-size: 0.875rem;
        color: #6b7280;
        line-height: 1.5;
      }

      .chart-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        margin-top: auto;
        padding-top: 1rem;
        border-top: 1px solid var(--border, #e5e7eb);
        font-size: 0.8125rem;
      }

      .source-attribution {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: #6b7280;
      }

      .source-icon {
        width: 1rem;
        height: 1rem;
        color: #9ca3af;
      }

      .chart-type-indicator {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .chart-type-label {
        padding: 0.25rem 0.5rem;
        background: #f3f4f6;
        color: #374151;
        border-radius: 0.25rem;
        font-size: 0.75rem;
        font-weight: 500;
        text-transform: capitalize;
      }

      .data-count {
        font-size: 0.75rem;
        color: #6b7280;
      }

      @media (max-width: 768px) {
        .chart-container {
          padding: 1rem;
          gap: 0.75rem;
        }

        .chart-header {
          flex-direction: column;
          align-items: stretch;
          gap: 0.75rem;
        }

        .chart-title {
          font-size: 1.25rem;
        }

        .chart-footer {
          flex-direction: column;
          align-items: stretch;
          gap: 0.5rem;
          text-align: center;
        }
      }
    </style>
  </template>
}

class SpreadsheetChartEdit extends Component<typeof SpreadsheetChart> {
  @tracked showAllLinePoints = true;

  get headers(): string[] {
    try {
      const csvText = this.args.model?.source?.csvData ?? '';
      const delimiter = CSVParser.getDelimiter(this.args.model?.source);
      const { headers } = CSVParser.parseCSV(csvText, delimiter);
      return headers;
    } catch {
      return [];
    }
  }

  @tracked topNField: string = '';

  constructor(owner: Owner, args: any) {
    super(owner, args);
    const v = Number(this.args.model?.topN);
    // If no topN defined → show all for line chart by default
    this.showAllLinePoints =
      this.args.model?.chartType === 'line'
        ? !(Number.isFinite(v) && v > 0)
        : false; // non-line charts keep explicit limit input
    this.topNField =
      Number.isFinite(v) && v > 0
        ? String(v)
        : this.showAllLinePoints
        ? ''
        : '10';
  }

  get chartTypeOptions() {
    return [
      {
        key: 'bar',
        label: 'Bar Chart',
        description: 'Vertical bars showing counts or values',
      },
      {
        key: 'horizontalBar',
        label: 'Horizontal Bar',
        description: 'Horizontal bars for long category names',
      },
      {
        key: 'stackedBar',
        label: 'Stacked Bar',
        description: 'Bars split by a binary column (2 values)',
      },
      {
        key: 'pie',
        label: 'Pie Chart',
        description: 'Circular chart showing proportions',
      },
      {
        key: 'line',
        label: 'Line Chart',
        description: 'Connected points showing trends over time',
      },
    ];
  }

  // Selected option getters - properly find selected items
  get selectedChartType() {
    return this.chartTypeOptions.find(
      (opt) => opt.key === (this.args.model?.chartType || 'bar'),
    );
  }

  get selectedCategoryColumn() {
    return this.categoryColumnOptions.find(
      (opt) => opt.key === (this.args.model?.categoryHeader || ''),
    );
  }

  get selectedBinaryColumn() {
    return this.binaryColumnOptions.find(
      (opt) => opt.key === (this.args.model?.binaryHeader || ''),
    );
  }

  get selectedXAxis() {
    return this.axisColumnOptions.find(
      (opt) => opt.key === (this.args.model?.xHeader || ''),
    );
  }

  get selectedYAxis() {
    return this.valueColumnOptions.find(
      (opt) => opt.key === (this.args.model?.yHeader || ''),
    );
  }

  // Column header options with auto-detect
  get categoryColumnOptions() {
    const autoDetect = [
      {
        key: '',
        label: 'Auto-detect best column',
        description: 'Let the system choose the best category column',
      },
    ];
    const headerOptions = this.headers.map((h) => ({
      key: h,
      label: h,
      description: `Use "${h}" as the category column`,
    }));
    return [...autoDetect, ...headerOptions];
  }

  get binaryColumnOptions() {
    const selectPrompt = [
      {
        key: '',
        label: 'Select a column...',
        description: 'Choose a column with exactly 2 unique values',
      },
    ];
    const headerOptions = this.headers.map((h) => ({
      key: h,
      label: h,
      description: `Split bars by "${h}" values`,
    }));
    return [...selectPrompt, ...headerOptions];
  }

  get valueColumnOptions() {
    const countOption = [
      {
        key: '',
        label: 'Count occurrences',
        description: 'Count how many times each category appears',
      },
    ];
    const headerOptions = this.headers.map((h) => ({
      key: h,
      label: h,
      description: `Sum values from "${h}" column`,
    }));
    return [...countOption, ...headerOptions];
  }

  get axisColumnOptions() {
    const autoDetect = [
      {
        key: '',
        label: 'Auto-detect',
        description: 'Let the system choose the best column',
      },
    ];
    const headerOptions = this.headers.map((h) => ({
      key: h,
      label: h,
      description: `Use "${h}" column`,
    }));
    return [...autoDetect, ...headerOptions];
  }

  updateTopN = (e: Event) => {
    const val = (e.target as HTMLInputElement)?.value ?? '';
    this.topNField = val;

    if (!this.args.model) return;

    if (val === '') return;

    const n = Number(val);
    if (Number.isFinite(n)) {
      const clamped = Math.max(1, Math.min(50, Math.floor(n)));
      this.args.model.topN = clamped as any;
    }
  };

  commitTopN = () => {
    if (!this.args.model) return;

    // If user explicitly wants all points for line charts
    if (this.args.model.chartType === 'line' && this.showAllLinePoints) {
      this.args.model.topN = null as any;
      this.topNField = '';
      return;
    }

    const n = Number(this.topNField);
    if (!Number.isFinite(n) || this.topNField === '') {
      this.args.model.topN = 10;
      this.topNField = '10';
      return;
    }
    const clamped = Math.max(1, Math.min(50, Math.floor(n)));
    this.args.model.topN = clamped;
    this.topNField = String(clamped);
  };

  // BoxelSelect change handlers
  updateChartType = (option: any) => {
    if (this.args.model) {
      this.args.model.chartType = option?.key || 'bar';
    }
  };

  updateCategoryHeader = (option: any) => {
    if (this.args.model) {
      this.args.model.categoryHeader = option?.key || '';
    }
  };

  updateBinaryHeader = (option: any) => {
    if (this.args.model) {
      this.args.model.binaryHeader = option?.key || '';
    }
  };

  updateXHeader = (option: any) => {
    if (this.args.model) {
      this.args.model.xHeader = option?.key || '';
    }
  };

  updateYHeader = (option: any) => {
    if (this.args.model) {
      this.args.model.yHeader = option?.key || '';
    }
  };

  toggleShowAllLinePoints = (e: Event) => {
    if (!this.args.model) return;
    this.showAllLinePoints = (e.target as HTMLInputElement)?.checked ?? false;

    if (this.args.model.chartType === 'line') {
      if (this.showAllLinePoints) {
        this.args.model.topN = null as any;
        this.topNField = '';
      } else {
        const v = Number(this.args.model.topN);
        const fallback = Number.isFinite(v) && v > 0 ? String(v) : '10';
        this.topNField = fallback;
        this.commitTopN();
      }
    }
  };

  <template>
    <div class='edit-panel'>
      <FieldContainer @label='Source Spreadsheet'>
        <@fields.source />
      </FieldContainer>

      <FieldContainer @label='Card Info'>
        <@fields.cardInfo />
      </FieldContainer>

      <FieldContainer @label='Chart Type'>
        <BoxelSelect
          @selected={{this.selectedChartType}}
          @options={{this.chartTypeOptions}}
          @onChange={{this.updateChartType}}
          @placeholder='Choose chart type...'
          as |option|
        >
          <div class='select-option'>
            <div class='option-title'>{{option.label}}</div>
            <div class='option-description'>{{option.description}}</div>
          </div>
        </BoxelSelect>
      </FieldContainer>

      <FieldContainer @label='Category Column'>
        <BoxelSelect
          @selected={{this.selectedCategoryColumn}}
          @options={{this.categoryColumnOptions}}
          @onChange={{this.updateCategoryHeader}}
          @searchEnabled={{true}}
          @placeholder='Choose category column...'
          as |option|
        >
          <div class='select-option'>
            <div class='option-title'>{{option.label}}</div>
            <div class='option-description'>{{option.description}}</div>
          </div>
        </BoxelSelect>
      </FieldContainer>

      {{#if (eq @model.chartType 'stackedBar')}}
        <FieldContainer @label='Split Each Bar By'>
          <BoxelSelect
            @selected={{this.selectedBinaryColumn}}
            @options={{this.binaryColumnOptions}}
            @onChange={{this.updateBinaryHeader}}
            @searchEnabled={{true}}
            @placeholder='Choose binary column...'
            as |option|
          >
            <div class='select-option'>
              <div class='option-title'>{{option.label}}</div>
              <div class='option-description'>{{option.description}}</div>
            </div>
          </BoxelSelect>
          <div class='field-help'>Choose a column with exactly 2 values(e.g.,
            "Male/Female"), else auto-detect will be used</div>
        </FieldContainer>
      {{/if}}

      {{#if (eq @model.chartType 'line')}}
        <FieldContainer @label='X-Axis Column'>
          <BoxelSelect
            @selected={{this.selectedXAxis}}
            @options={{this.axisColumnOptions}}
            @onChange={{this.updateXHeader}}
            @searchEnabled={{true}}
            @placeholder='Choose X-axis column...'
            as |option|
          >
            <div class='select-option'>
              <div class='option-title'>{{option.label}}</div>
              <div class='option-description'>{{option.description}}</div>
            </div>
          </BoxelSelect>
        </FieldContainer>

        <FieldContainer @label='Y-Axis Column'>
          <BoxelSelect
            @selected={{this.selectedYAxis}}
            @options={{this.valueColumnOptions}}
            @onChange={{this.updateYHeader}}
            @searchEnabled={{true}}
            @placeholder='Choose Y-axis column...'
            as |option|
          >
            <div class='select-option'>
              <div class='option-title'>{{option.label}}</div>
              <div class='option-description'>{{option.description}}</div>
            </div>
          </BoxelSelect>
        </FieldContainer>
        <FieldContainer @label='Show all data points (Line)'>
          <label class='toggle-row'>
            <input
              type='checkbox'
              checked={{this.showAllLinePoints}}
              {{on 'change' this.toggleShowAllLinePoints}}
            />
            <span>Show all data points</span>
          </label>
          <div class='field-help'>When enabled, all rows are plotted. Disable to
            limit the number of points.</div>
        </FieldContainer>
        <FieldContainer @label='Maximum Items'>
          <label class='sr-only' for='topN'>Maximum Items to Display</label>
          {{#if this.showAllLinePoints}}
            <div class='field-help'>Showing all points. Uncheck the toggle above
              to limit.</div>
          {{else}}
            <input
              id='topN'
              type='number'
              min='1'
              max='50'
              value={{this.topNField}}
              placeholder='10'
              {{on 'input' this.updateTopN}}
              {{on 'blur' this.commitTopN}}
            />
          {{/if}}
        </FieldContainer>
      {{else}}
        <FieldContainer @label='Value Column (Optional)'>
          <BoxelSelect
            @selected={{this.selectedYAxis}}
            @options={{this.valueColumnOptions}}
            @onChange={{this.updateYHeader}}
            @searchEnabled={{true}}
            @placeholder='Choose value column...'
            as |option|
          >
            <div class='select-option'>
              <div class='option-title'>{{option.label}}</div>
              <div class='option-description'>{{option.description}}</div>
            </div>
          </BoxelSelect>
        </FieldContainer>
      {{/if}}
    </div>

    <style scoped>
      .edit-panel {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
      }

      .select-option {
        padding: 0.25rem 0;
      }

      .option-title {
        font-size: 0.875rem;
        font-weight: 500;
        color: #1f2937;
        line-height: 1.2;
      }

      .option-description {
        font-size: 0.75rem;
        color: #6b7280;
        line-height: 1.3;
        margin-top: 0.125rem;
      }

      .field-help {
        font-size: 0.75rem;
        color: #6b7280;
        line-height: 1.4;
        font-style: italic;
        margin-top: 0.5rem;
      }

      .toggle-row {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        user-select: none;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        border: 0;
      }

      input[type='number'] {
        padding: var(--boxel-sp-xs);
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
        font-size: var(--boxel-font-sm);
        background: white;
        transition: all 0.2s ease;
      }

      input[type='number']:focus {
        border-color: var(--boxel-highlight);
        outline: none;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      @media (max-width: 640px) {
        .edit-panel {
          padding: var(--boxel-sp-lg);
          gap: var(--boxel-sp);
        }
      }
    </style>
  </template>
}

export class SpreadsheetChart extends CardDef {
  static displayName = 'Spreadsheet Chart';
  static icon = ChartIcon;
  @field source = linksTo(Spreadsheet);
  @field chartType = contains(StringField);
  @field categoryHeader = contains(StringField);
  @field yHeader = contains(StringField);
  @field binaryHeader = contains(StringField);
  @field xHeader = contains(StringField);
  @field topN = contains(NumberField);

  @field title = contains(StringField, {
    computeVia: function (this: SpreadsheetChart) {
      try {
        const srcTitle = (this as any).source?.title;
        const chartType = this.chartType || 'bar';
        const capitalizedType =
          chartType.charAt(0).toUpperCase() + chartType.slice(1);
        return srcTitle
          ? `${srcTitle} - ${capitalizedType} Chart`
          : `${capitalizedType} Chart`;
      } catch {
        return 'Spreadsheet Chart';
      }
    },
  });

  static isolated = SpreadsheetChartIsolated;

  static edit = SpreadsheetChartEdit;

  static embedded = class Embedded extends Component<typeof SpreadsheetChart> {
    get dataSummary(): string {
      try {
        const text = this.args.model?.source?.csvData ?? '';
        if (!text.trim()) return 'No data';
        const lines = text.split('\n');
        const rows = Math.max(0, lines.length - 1);
        const chartType = this.args.model?.chartType || 'bar';
        return `${rows} rows • ${chartType} chart`;
      } catch {
        return 'No data';
      }
    }

    <template>
      <div class='chart-embedded'>
        <div class='header'>
          <svg
            class='chart-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            {{#if (eq @model.chartType 'pie')}}
              <path d='M21.21 15.89A10 10 0 1 1 8 2.83' />
              <path d='M22 12A10 10 0 0 0 12 2v10z' />
            {{else if (eq @model.chartType 'line')}}
              <path d='M3 3v18h18' />
              <path d='M18.7 8l-5.1 5.2-2.8-2.7L7 14.3' />
            {{else}}
              <path d='M3 3v18h18' />
              <path d='M7 16V9' />
              <path d='M14 16V5' />
              <path d='M11 16v-6' />
              <path d='M18 16v-4' />
            {{/if}}
          </svg>
          <div class='title'>{{@model.title}}</div>
        </div>
        <div class='meta'>{{this.dataSummary}}</div>
        {{#if @model.source}}
          <div class='source'>From: {{@model.source.title}}</div>
        {{/if}}
      </div>

      <style scoped>
        .chart-embedded {
          padding: 1rem;
          background: var(--card, #ffffff);
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .chart-icon {
          width: 1.5rem;
          height: 1.5rem;
          color: var(--chart-1, #3b82f6);
          flex-shrink: 0;
        }

        .title {
          font-size: 1rem;
          font-weight: 600;
          color: var(--foreground, #111827);
          line-height: 1.2;
        }

        .meta {
          font-size: 0.875rem;
          color: #6b7280;
          margin-bottom: 0.25rem;
        }

        .source {
          font-size: 0.75rem;
          color: #9ca3af;
          font-style: italic;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof SpreadsheetChart> {
    get miniData(): string {
      try {
        const text = this.args.model?.source?.csvData ?? '';
        if (!text.trim()) return 'No data';
        const lines = text.split('\n');
        const rows = Math.max(0, lines.length - 1);
        const chartType = this.args.model?.chartType || 'bar';
        return `${rows} rows • ${chartType}`;
      } catch {
        return 'No data';
      }
    }

    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <svg
            class='mini-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <path d='M3 3v18h18' />
            <path d='M7 16V9' />
            <path d='M14 16V5' />
            <path d='M11 16v-6' />
          </svg>
          <div class='badge-text'>Chart</div>
        </div>

        <div class='strip-format'>
          <svg
            class='strip-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            {{#if (eq @model.chartType 'pie')}}
              <path d='M21.21 15.89A10 10 0 1 1 8 2.83' />
              <path d='M22 12A10 10 0 0 0 12 2v10z' />
            {{else if (eq @model.chartType 'line')}}
              <path d='M3 3v18h18' />
              <path d='M18.7 8l-5.1 5.2-2.8-2.7L7 14.3' />
            {{else}}
              <path d='M3 3v18h18' />
              <path d='M7 16V9' />
              <path d='M14 16V5' />
              <path d='M11 16v-6' />
            {{/if}}
          </svg>
          <div class='strip-content'>
            <div class='primary-text'>{{@model.title}}</div>
            <div class='secondary-text'>{{this.miniData}}</div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='tile-header'>
            <svg
              class='tile-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              {{#if (eq @model.chartType 'pie')}}
                <path d='M21.21 15.89A10 10 0 1 1 8 2.83' />
                <path d='M22 12A10 10 0 0 0 12 2v10z' />
              {{else if (eq @model.chartType 'line')}}
                <path d='M3 3v18h18' />
                <path d='M18.7 8l-5.1 5.2-2.8-2.7L7 14.3' />
              {{else}}
                <path d='M3 3v18h18' />
                <path d='M7 16V9' />
                <path d='M14 16V5' />
                <path d='M11 16v-6' />
              {{/if}}
            </svg>
            <div class='primary-text'>{{@model.title}}</div>
          </div>
          <div class='secondary-text'>{{this.miniData}}</div>
          {{#if @model.source}}
            <div class='tertiary-text'>From {{@model.source.title}}</div>
          {{/if}}
        </div>

        <div class='card-format'>
          <div class='card-header'>
            <div class='chart-visual'>
              <svg
                class='card-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                {{#if (eq @model.chartType 'pie')}}
                  <path d='M21.21 15.89A10 10 0 1 1 8 2.83' />
                  <path d='M22 12A10 10 0 0 0 12 2v10z' />
                {{else if (eq @model.chartType 'line')}}
                  <path d='M3 3v18h18' />
                  <path d='M18.7 8l-5.1 5.2-2.8-2.7L7 14.3' />
                {{else}}
                  <path d='M3 3v18h18' />
                  <path d='M7 16V9' />
                  <path d='M14 16V5' />
                  <path d='M11 16v-6' />
                {{/if}}
              </svg>
            </div>
            <div class='card-info'>
              <div class='primary-text'>{{@model.title}}</div>
              <div class='secondary-text'>{{this.miniData}}</div>
            </div>
          </div>
          {{#if @model.source}}
            <div class='card-footer'>
              <div class='tertiary-text'>Source: {{@model.source.title}}</div>
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .fitted-container {
          width: 100%;
          height: 100%;
          container-type: size;
          background: var(--card, #ffffff);
          border-radius: 0.5rem;
          overflow: hidden;
        }

        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          padding: clamp(0.1875rem, 2%, 0.625rem);
          box-sizing: border-box;
        }

        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
            align-items: center;
            gap: 0.25rem;
            justify-content: center;
          }
        }

        .mini-icon {
          width: 1rem;
          height: 1rem;
          color: var(--chart-1, #3b82f6);
        }

        .badge-text {
          font-size: 0.75rem;
          font-weight: 600;
          color: #1f2937;
        }

        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
        }

        .strip-icon {
          width: 1.25rem;
          height: 1.25rem;
          color: var(--chart-1, #3b82f6);
          flex-shrink: 0;
        }

        .strip-content {
          flex: 1;
          min-width: 0;
        }

        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
          }
        }

        .tile-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .tile-icon {
          width: 1.5rem;
          height: 1.5rem;
          color: var(--chart-1, #3b82f6);
          flex-shrink: 0;
        }

        /* Card format: full layout */
        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
          }
        }

        .card-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .chart-visual {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 3rem;
          height: 3rem;
          background: color-mix(
            in srgb,
            var(--chart-1, #3b82f6) 10%,
            transparent
          );
          border-radius: 0.5rem;
          flex-shrink: 0;
        }

        .card-icon {
          width: 1.75rem;
          height: 1.75rem;
          color: var(--chart-1, #3b82f6);
        }

        .card-info {
          flex: 1;
          min-width: 0;
        }

        .card-footer {
          margin-top: auto;
          padding-top: 0.5rem;
          border-top: 1px solid var(--border, #e5e7eb);
        }

        /* Typography hierarchy */
        .primary-text {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--foreground, #1f2937);
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .secondary-text {
          font-size: 0.75rem;
          font-weight: 500;
          color: #6b7280;
          line-height: 1.3;
          margin-top: 0.25rem;
        }

        .tertiary-text {
          font-size: 0.6875rem;
          font-weight: 400;
          color: #9ca3af;
          line-height: 1.4;
          margin-top: 0.25rem;
        }

        /* Responsive adjustments */
        @container (max-width: 200px) {
          .primary-text {
            font-size: 0.8125rem;
          }
          .secondary-text {
            font-size: 0.6875rem;
          }
        }
      </style>
    </template>
  };
}
