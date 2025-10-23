import { eq, add, gt } from '@cardstack/boxel-ui/helpers';
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import TextAreaField from 'https://cardstack.com/base/text-area';
import { Button } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { restartableTask, timeout } from 'ember-concurrency';
import TableIcon from '@cardstack/boxel-icons/table';
import type Owner from '@ember/owner';

class SpreadsheetIsolated extends Component<typeof Spreadsheet> {
  @tracked parsedData: string[][] = [];
  @tracked headers: string[] = [];
  @tracked hasUnsavedChanges = false;
  @tracked saveStatus = '';
  @tracked delimiter = ',';
  @tracked tempDelimiter = '';
  @tracked showDelimiterHelp = false;
  @tracked isEditingDelimiter = false;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.delimiter = this.args.model?.delimiter || ',';
    this.initialParse.perform();
  }

  private initialParse = restartableTask(async () => {
    this.parseCSV();
    await Promise.resolve();
  });

  parseCSV() {
    try {
      const csvContent = this.args.model?.csvData || '';
      if (!csvContent.trim()) {
        this.headers = [];
        this.parsedData = [];
        return;
      }

      const lines = csvContent
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);
      if (lines.length === 0) {
        this.headers = ['Column A'];
        this.parsedData = [['']];
        return;
      }

      const newHeaders = this.parseCSVLine(lines[0]);
      if (newHeaders.length === 0) {
        this.headers = ['Column A'];
        this.parsedData = [['']];
        return;
      }

      const newData = lines.slice(1).map((line) => this.parseCSVLine(line));

      const headerCount = newHeaders.length;
      const normalizedData = newData.map((row) => {
        if (row.length === headerCount) return row;
        if (row.length > headerCount) return row.slice(0, headerCount);

        const padded = [...row];
        padded.length = headerCount;
        padded.fill('', row.length);
        return padded;
      });

      this.headers = newHeaders;
      this.parsedData = normalizedData;

      if (this.saveStatus && !this.hasUnsavedChanges) {
        this.saveStatus = '';
      }
    } catch (error) {
      console.error('Error parsing CSV:', error);
      this.headers = ['Column A'];
      this.parsedData = [['Error parsing CSV']];
    }
  }

  parseCSVLine(line: string): string[] {
    if (!line || typeof line !== 'string') return [''];

    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    try {
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"' && !inQuotes) {
          inQuotes = true;
        } else if (char === '"' && inQuotes && nextChar === '"') {
          current += '"';
          i++;
        } else if (char === '"' && inQuotes) {
          inQuotes = false;
        } else if (char === this.delimiterChar && !inQuotes) {
          result.push(current);
          current = '';
        } else {
          current += char;
        }
      }

      result.push(current);
      return result;
    } catch (error) {
      console.warn('CSV line parsing error:', error, 'Line:', line);
      return [line];
    }
  }

  generateCSV(): string {
    const escapeCSVValue = (value: string | null | undefined): string => {
      const safeValue = value?.toString() ?? '';
      if (
        safeValue.includes(this.delimiterChar) ||
        safeValue.includes('"') ||
        safeValue.includes('\n')
      ) {
        return '"' + safeValue.replace(/"/g, '""') + '"';
      }
      return safeValue;
    };

    const headers = this.headers || [];
    const data = this.parsedData || [];

    if (headers.length === 0) {
      return '';
    }

    const headerRow = headers.map(escapeCSVValue).join(this.delimiterChar);
    const dataRows = data.map((row) =>
      row.map(escapeCSVValue).join(this.delimiterChar),
    );

    return [headerRow, ...dataRows].join('\n');
  }

  private autoSave = restartableTask(async () => {
    if (!this.hasUnsavedChanges) return;

    this.saveStatus = 'Saving...';
    const csvContent = this.generateCSV();

    try {
      if (this.args.model) {
        this.args.model.csvData = csvContent;
      }

      await timeout(500);

      this.hasUnsavedChanges = false;
      this.saveStatus = 'Saved ✓';

      await timeout(2000);
      this.saveStatus = '';
    } catch (error) {
      console.error('Save error:', error);
      this.saveStatus = 'Save failed ✗';
      await timeout(3000);
      this.saveStatus = '';
    }
  });

  get delimiterChar(): string {
    const rawDelimiter = this.delimiter || this.args.model?.delimiter || ',';
    if (!rawDelimiter) return ',';
    const trimmed = rawDelimiter.trim();
    return trimmed === '\\t' ? '\t' : trimmed;
  }

  updateTempDelimiter = (event: Event) => {
    this.tempDelimiter = (event?.target as HTMLInputElement)?.value ?? '';
  };

  saveDelimiterEdit = () => {
    const normalized = this.tempDelimiter || ',';
    this.delimiter = normalized;
    if (this.args.model) {
      this.args.model.delimiter = normalized === '\t' ? '\\t' : normalized;
    }
    this.parseCSV();
    this.hasUnsavedChanges = true;
    this.autoSave.perform();
    this.isEditingDelimiter = false;
  };

  handleDelimiterKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.saveDelimiterEdit();
      (event.target as HTMLInputElement).blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.tempDelimiter = this.delimiter;
      this.isEditingDelimiter = false;
      (event.target as HTMLInputElement).blur();
    }
  };

  startDelimiterEdit = () => {
    this.tempDelimiter = this.delimiter;
    this.isEditingDelimiter = true;
  };

  toggleDelimiterHelp = () => {
    this.showDelimiterHelp = !this.showDelimiterHelp;
  };

  detectDelimiter = (csvText: string): string => {
    if (!csvText.trim()) return ',';

    const firstLine = csvText.split('\n')[0] || '';
    const delimiters = [';', ',', '|', '\t'];

    const counts = delimiters.map((delim) => ({
      delimiter: delim,
      count: firstLine.split(delim).length - 1,
    }));

    const best = counts.reduce((prev, curr) =>
      curr.count > prev.count ? curr : prev,
    );

    return best.count > 0 ? best.delimiter : ',';
  };

  importFromFile = async (event: Event) => {
    const input = event?.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      console.error('File too large. Maximum size is 10MB.');
      return;
    }

    const validTypes = ['text/csv', 'application/csv', 'text/plain'];
    const validExtensions = ['.csv', '.txt'];
    const isValidType =
      validTypes.includes(file.type) ||
      validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext));

    if (!isValidType) {
      console.warn(
        'Unexpected file type. Expected CSV file, but will attempt to process.',
      );
    }

    if (file.size === 0) {
      console.error('Cannot import empty file.');
      return;
    }

    try {
      const text = await file.text();
      const normalizedText = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();

      const detectedDelimiter = this.detectDelimiter(normalizedText);

      if (this.args.model) {
        this.args.model.csvData = normalizedText;
        this.args.model.delimiter =
          detectedDelimiter === '\t' ? '\\t' : detectedDelimiter;
      }

      // Update the component's delimiter to match
      this.delimiter = detectedDelimiter;

      this.parseCSV();
      this.hasUnsavedChanges = true;
      this.autoSave.perform();
      if (input) input.value = '';
    } catch (e) {
      console.error('Import CSV failed', e);
    }
  };

  downloadCSV = () => {
    try {
      const csv = this.generateCSV();
      const base =
        this.args.model?.csvFilename?.trim() ||
        this.args.model?.name?.trim() ||
        'spreadsheet';
      const filename = base.endsWith('.csv') ? base : `${base}.csv`;

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download CSV failed', e);
    }
  };

  <template>
    <div class='spreadsheet-container'>
      <header class='spreadsheet-header'>
        <div class='title-section'>
          <h1>{{if @model.name @model.name 'Untitled Spreadsheet'}}</h1>
          {{#if this.saveStatus}}
            <span
              class='save-status
                {{if (eq this.saveStatus "Saved ✓") "success" "pending"}}'
            >
              {{this.saveStatus}}
            </span>
          {{/if}}
        </div>

        <div class='toolbar'>
          <div class='delimiter-field'>
            <label
              for='delimiter-input'
              class='delimiter-label'
              title='Delimiters: , ; | or \t (tab). Import/Export uses this. Quoted values keep embedded delimiters.'
            >Delimiter</label>
            <input
              id='delimiter-input'
              class='delimiter-input'
              value={{if
                this.isEditingDelimiter
                this.tempDelimiter
                this.delimiter
              }}
              placeholder=''
              {{on 'focus' this.startDelimiterEdit}}
              {{on 'input' this.updateTempDelimiter}}
              {{on 'blur' this.saveDelimiterEdit}}
              {{on 'keydown' this.handleDelimiterKeydown}}
            />
            <button
              class='help-button'
              title='Delimiter help'
              {{on 'click' this.toggleDelimiterHelp}}
            >?</button>
            {{#if this.showDelimiterHelp}}
              <div class='delimiter-tooltip'>
                <div class='tooltip-content'>
                  <button
                    class='close-button'
                    {{on 'click' this.toggleDelimiterHelp}}
                  >×</button>
                  <div class='tooltip-header'>
                    <strong>Delimiter Options</strong>
                  </div>
                  <div class='delimiter-options'>
                    <div class='delimiter-row'>
                      <code>,</code>
                      <span>Comma</span>
                      <span class='example'>name,age</span>
                    </div>
                    <div class='delimiter-row'>
                      <code>;</code>
                      <span>Semicolon</span>
                      <span class='example'>name;age</span>
                    </div>
                    <div class='delimiter-row'>
                      <code>|</code>
                      <span>Pipe</span>
                      <span class='example'>name|age</span>
                    </div>
                    <div class='delimiter-row'>
                      <code>\t</code>
                      <span>Tab</span>
                      <span class='example'>
                        {{! template-lint-disable no-whitespace-for-layout }}
                        name&nbsp;&nbsp;&nbsp;&nbsp;age</span>
                    </div>
                  </div>
                  <div class='tooltip-tip'>
                    💡 Auto-detected on CSV import
                  </div>
                </div>
              </div>
            {{/if}}
          </div>

          <label class='import-label'>
            Import CSV
            <input
              type='file'
              accept='.csv,text/csv'
              class='file-input-hidden'
              {{on 'change' this.importFromFile}}
            />
          </label>
          <Button class='add-button' {{on 'click' this.downloadCSV}}>
            Download CSV
          </Button>
        </div>
      </header>

      <div class='table-wrapper'>
        {{#if (gt this.parsedData.length 0)}}
          <table class='spreadsheet-table'>
            <thead>
              <tr class='header-row'>
                <th class='row-number'>#</th>
                {{#each this.headers as |header|}}
                  <th class='column-header'>
                    <div class='header-display'>
                      {{if header header 'Column Name'}}
                    </div>
                  </th>
                {{/each}}
              </tr>
            </thead>

            <tbody>
              {{#each this.parsedData as |row rowIndex|}}
                <tr class='data-row'>
                  <td class='row-number'>{{add rowIndex 1}}</td>
                  {{#each row as |cell|}}
                    <td class='data-cell'>
                      <div class='cell-display' title='{{cell}}'>
                        {{cell}}
                      </div>
                    </td>
                  {{/each}}
                </tr>
              {{/each}}
            </tbody>
          </table>
        {{else}}
          <div class='empty-state'>
            <div class='empty-icon'>📄</div>
            <div class='empty-title'>No Data Yet</div>
            <div class='empty-description'>
              Import a CSV file or paste data to get started
            </div>
          </div>
        {{/if}}
      </div>

      {{#if @model.csvFilename}}
        <footer class='spreadsheet-footer'>
          <span class='file-info'>
            Linked to:
            <strong>{{@model.csvFilename}}</strong>
          </span>
        </footer>
      {{/if}}
    </div>

    <style scoped>
      .spreadsheet-container {
        width: 100%;
        height: 100vh;
        display: flex;
        flex-direction: column;
        font-family:
          'Inter',
          -apple-system,
          sans-serif;
        background: var(--background, #fafbfc);
      }

      .spreadsheet-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 1.5rem;
        background: var(--card, #ffffff);
        border-bottom: 1px solid var(--border, #e5e7eb);
        flex-shrink: 0;
      }

      .title-section {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .title-section h1 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--foreground, #111827);
      }

      .save-status {
        padding: 0.25rem 0.5rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 500;
      }

      .save-status.success {
        background: var(--success, #dcfce7);
        color: var(--success-foreground, #166534);
      }

      .save-status.pending {
        background: var(--warning, #fef3c7);
        color: var(--warning-foreground, #92400e);
      }

      .data-stats {
        padding: 0.25rem 0.5rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 500;
        background: #f3f4f6;
        color: #6b7280;
      }

      .toolbar {
        display: flex;
        gap: 0.5rem;
      }

      .add-button {
        padding: 0.5rem 1rem;
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        border: none;
        border-radius: 0.375rem;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.15s;
      }

      .add-button:hover {
        background: var(--primary-hover, #2563eb);
      }

      .delimiter-field {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        background: var(--muted, #f3f4f6);
        padding: 0.25rem 0.5rem;
        border-radius: 0.375rem;
        position: relative;
      }

      .delimiter-label {
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
      }

      .delimiter-input {
        width: 4rem;
        padding: 0.25rem 0.5rem;
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 0.375rem;
        background: var(--card, #ffffff);
        font-size: 0.8125rem;
      }

      .import-label {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 1rem;
        background: var(--secondary, #10b981);
        color: var(--secondary-foreground, #ffffff);
        border-radius: 0.375rem;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.15s;
      }

      .import-label:hover {
        background: var(--secondary-hover, #059669);
      }

      .help-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 0.375rem;
        border: 1px solid var(--border, #e5e7eb);
        background: var(--card, #ffffff);
        color: var(--foreground, #374151);
        font-weight: 600;
        cursor: pointer;
        position: relative;
      }

      .help-button:hover {
        background: var(--muted, #f3f4f6);
      }

      .delimiter-tooltip {
        position: absolute;
        top: calc(100% + 0.5rem);
        right: 0;
        z-index: 1000;
        background: var(--popover, #ffffff);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 0.5rem;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
        min-width: 16rem;
        animation: tooltipFadeIn 0.2s ease-out;
      }

      .delimiter-tooltip::before {
        content: '';
        position: absolute;
        top: -0.5rem;
        right: 0.75rem;
        width: 0;
        height: 0;
        border-left: 0.5rem solid transparent;
        border-right: 0.5rem solid transparent;
        border-bottom: 0.5rem solid var(--border, #e5e7eb);
      }

      .delimiter-tooltip::after {
        content: '';
        position: absolute;
        top: -0.4375rem;
        right: 0.8125rem;
        width: 0;
        height: 0;
        border-left: 0.375rem solid transparent;
        border-right: 0.375rem solid transparent;
        border-bottom: 0.375rem solid var(--popover, #ffffff);
      }

      .tooltip-content {
        padding: 0.75rem;
        position: relative;
      }

      .close-button {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        width: 1.25rem;
        height: 1.25rem;
        border: none;
        background: none;
        color: var(--muted-foreground, #9ca3af);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 0.25rem;
        font-size: 1rem;
        line-height: 1;
      }

      .close-button:hover {
        background: var(--muted, #f3f4f6);
        color: var(--foreground, #374151);
      }

      .tooltip-header {
        margin-bottom: 0.75rem;
        padding-right: 1.5rem;
        font-size: 0.875rem;
        color: var(--popover-foreground, #111827);
      }

      .delimiter-options {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
      }

      .delimiter-row {
        display: grid;
        grid-template-columns: 1.5rem 1fr 1fr;
        gap: 0.5rem;
        align-items: center;
        font-size: 0.8125rem;
      }

      .delimiter-row code {
        background: var(--muted, #f3f4f6);
        padding: 0.125rem 0.25rem;
        border-radius: 0.25rem;
        font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
        font-size: 0.75rem;
        color: var(--foreground, #1f2937);
      }

      .delimiter-row .example {
        font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
        background: var(--background, #f9fafb);
        padding: 0.125rem 0.25rem;
        border-radius: 0.25rem;
      }

      .tooltip-tip {
        font-size: 0.75rem;
        color: var(--primary, #3b82f6);
        background: var(--primary-background, #eff6ff);
        padding: 0.5rem;
        border-radius: 0.25rem;
        border-left: 3px solid var(--primary, #3b82f6);
      }

      @keyframes tooltipFadeIn {
        from {
          opacity: 0;
          transform: translateY(-0.25rem);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .file-input-hidden {
        display: none;
      }

      .table-wrapper {
        flex: 1;
        overflow: auto;
        background: var(--card, #ffffff);
        margin: 0 1.5rem 1.5rem;
        border-radius: 0.5rem;
        border: 1px solid var(--border, #e5e7eb);
      }

      .spreadsheet-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        font-size: 0.875rem;
      }

      .header-row {
        background: var(--muted, #f9fafb);
        position: sticky;
        top: 0;
        z-index: 10;
      }

      .row-number {
        background: var(--muted, #f3f4f6);
        width: 50px;
        text-align: center;
        font-weight: 600;
        color: var(--muted-foreground, #6b7280);
        border-bottom: 1px solid var(--border, #e5e7eb);
        border-right: 1px solid var(--border, #e5e7eb);
        padding: 0.5rem 0.25rem;
        position: sticky;
        left: 0;
        z-index: 5;
      }

      .column-header {
        min-width: 120px;
        padding: 0.5rem;
        border-bottom: 1px solid var(--border, #e5e7eb);
        border-right: 1px solid var(--border, #e5e7eb);
        background: var(--muted, #f9fafb);
      }

      .header-input {
        width: 100%;
        border: none;
        background: transparent;
        font-weight: 600;
        color: var(--foreground, #374151);
        font-size: 0.875rem;
        padding: 0.25rem;
      }

      .header-input:focus {
        outline: 2px solid var(--primary, #3b82f6);
        outline-offset: -2px;
        border-radius: 0.25rem;
      }

      .header-display {
        width: 100%;
        font-weight: 600;
        color: var(--foreground, #374151);
        font-size: 0.875rem;
        padding: 0.25rem;
        cursor: text;
        min-height: 1.5rem;
        display: flex;
        align-items: center;
      }

      .header-display:hover {
        background: var(--accent, #f3f4f6);
        border-radius: 0.25rem;
      }

      .data-row:nth-child(even) {
        background: var(--muted, #f9fafb);
      }

      .data-cell {
        min-width: 120px;
        border-bottom: 1px solid var(--border, #e5e7eb);
        border-right: 1px solid var(--border, #e5e7eb);
        padding: 0;
        vertical-align: top;
      }

      .cell-display {
        padding: 0.5rem;
        min-height: 2.25rem;
        cursor: text;
        display: flex;
        align-items: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 200px;
      }

      .cell-display:hover {
        background: var(--accent, #f3f4f6);
      }

      .cell-input {
        width: 100%;
        border: none;
        padding: 0.5rem;
        font-size: 0.875rem;
        min-height: 2.25rem;
        resize: none;
        outline: 2px solid var(--primary, #3b82f6);
        outline-offset: -2px;
      }

      .spreadsheet-footer {
        padding: 0.75rem 1.5rem;
        background: var(--card, #ffffff);
        border-top: 1px solid var(--border, #e5e7eb);
        flex-shrink: 0;
      }

      .file-info {
        font-size: 0.875rem;
        color: var(--muted-foreground, #6b7280);
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 400px;
        text-align: center;
        color: var(--muted-foreground, #6b7280);
      }

      .empty-icon {
        font-size: 3rem;
        margin-bottom: 1rem;
        opacity: 0.7;
      }

      .empty-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--foreground, #374151);
        margin-bottom: 0.5rem;
      }

      .empty-description {
        font-size: 0.875rem;
        max-width: 300px;
        line-height: 1.5;
      }

      /* Responsive adjustments */
      @media (max-width: 768px) {
        .spreadsheet-header {
          flex-direction: column;
          gap: 1rem;
          align-items: stretch;
        }

        .toolbar {
          justify-content: stretch;
        }

        .add-button {
          flex: 1;
        }

        .table-wrapper {
          margin: 0 0.75rem 0.75rem;
        }
      }
    </style>
  </template>
}

export class Spreadsheet extends CardDef {
  static displayName = 'Spreadsheet';
  static icon = TableIcon;

  @field name = contains(StringField);
  @field csvData = contains(TextAreaField);
  @field csvFilename = contains(StringField);
  @field delimiter = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: Spreadsheet) {
      return this.name ?? 'Untitled Spreadsheet';
    },
  });

  static isolated = SpreadsheetIsolated;

  static embedded = class Embedded extends Component<typeof Spreadsheet> {
    get rowCount(): number {
      if (!this.args.model?.csvData) return 0;
      return this.args.model.csvData.split('\n').length - 1;
    }

    get columnCount(): number {
      if (!this.args.model?.csvData) return 0;
      const firstLine = this.args.model.csvData.split('\n')[0];
      const delim =
        this.args.model?.delimiter === '\\t'
          ? '\t'
          : this.args.model?.delimiter || ',';
      return firstLine ? firstLine.split(delim).length : 0;
    }

    <template>
      <div class='spreadsheet-preview'>
        <div class='preview-header'>
          <h3>{{if @model.name @model.name 'Untitled Spreadsheet'}}</h3>
          {{#if @model.csvFilename}}
            <span class='filename'>{{@model.csvFilename}}</span>
          {{/if}}
        </div>

        <div class='preview-content'>
          {{#if @model.csvData}}
            <div class='data-preview'>
              📊
              {{this.rowCount}}
              rows ×
              {{this.columnCount}}
              columns
            </div>
          {{else}}
            <div class='empty-preview'>
              📝 Empty spreadsheet - click to start editing
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .spreadsheet-preview {
          padding: 1rem;
          background: var(--card, #ffffff);
          border-radius: 0.5rem;
          border: 1px solid var(--border, #e5e7eb);
        }

        .preview-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
        }

        .preview-header h3 {
          margin: 0;
          font-size: 1rem;
          font-weight: 600;
          color: var(--foreground, #111827);
        }

        .filename {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          background: var(--muted, #f3f4f6);
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
        }

        .preview-content {
          color: var(--muted-foreground, #6b7280);
          font-size: 0.875rem;
        }

        .data-preview {
          font-weight: 500;
        }

        .empty-preview {
          font-style: italic;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Spreadsheet> {
    <template>
      <div class='fitted-container'>
        <div class='fitted-format badge-format'>
          <div class='spreadsheet-icon'>📊</div>
          <div class='spreadsheet-info'>
            <div class='primary-text'>{{if
                @model.name
                @model.name
                'Spreadsheet'
              }}</div>
            <div class='secondary-text'>{{this.dataInfo}}</div>
          </div>
        </div>

        <div class='fitted-format strip-format'>
          <div class='spreadsheet-icon'>📊</div>
          <div class='spreadsheet-details'>
            <div class='primary-text'>{{if
                @model.name
                @model.name
                'Untitled Spreadsheet'
              }}</div>
            <div class='secondary-text'>{{this.dataInfo}}</div>
            {{#if @model.csvFilename}}
              <div class='tertiary-text'>{{@model.csvFilename}}</div>
            {{/if}}
          </div>
        </div>

        <div class='fitted-format tile-format'>
          <div class='tile-header'>
            <div class='spreadsheet-icon large'>📊</div>
            <div class='primary-text'>{{if
                @model.name
                @model.name
                'Untitled Spreadsheet'
              }}</div>
          </div>
          <div class='tile-content'>
            <div class='secondary-text'>{{this.dataInfo}}</div>
            {{#if @model.csvFilename}}
              <div class='tertiary-text'>Linked: {{@model.csvFilename}}</div>
            {{/if}}
          </div>
        </div>

        <div class='fitted-format card-format'>
          <div class='card-header'>
            <div class='spreadsheet-icon large'>📊</div>
            <div class='header-text'>
              <div class='primary-text'>{{if
                  @model.name
                  @model.name
                  'Untitled Spreadsheet'
                }}</div>
              <div class='secondary-text'>{{this.dataInfo}}</div>
            </div>
          </div>
          {{#if @model.csvFilename}}
            <div class='card-footer'>
              <div class='tertiary-text'>File: {{@model.csvFilename}}</div>
            </div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .fitted-container {
          width: 100%;
          height: 100%;
          container-type: size;
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
            gap: 0.5rem;
          }
        }

        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
            align-items: center;
            gap: 0.75rem;
          }
        }

        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
          }
        }

        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }
        }

        .spreadsheet-icon {
          font-size: 1.25rem;
          flex-shrink: 0;
        }

        .spreadsheet-icon.large {
          font-size: 2rem;
        }

        .primary-text {
          font-size: 1em;
          font-weight: 600;
          color: var(--foreground, #111827);
          line-height: 1.2;
        }

        .secondary-text {
          font-size: 0.875em;
          font-weight: 500;
          color: var(--muted-foreground, #6b7280);
          line-height: 1.3;
        }

        .tertiary-text {
          font-size: 0.75em;
          font-weight: 400;
          color: var(--muted-foreground, #9ca3af);
          line-height: 1.4;
        }

        .tile-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.75rem;
        }

        .card-header {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .header-text {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .card-footer {
          margin-top: auto;
          padding-top: 0.5rem;
          border-top: 1px solid var(--border, #f3f4f6);
        }
      </style>
    </template>

    get dataInfo(): string {
      if (!this.args.model?.csvData) return 'Empty spreadsheet';

      const delim =
        this.args.model?.delimiter === '\\t'
          ? '\t'
          : this.args.model?.delimiter || ',';
      const lines = this.args.model.csvData.split('\n');
      const rows = Math.max(0, lines.length - 1);
      const cols = lines[0] ? lines[0].split(delim).length : 0;

      return `${rows} rows × ${cols} cols`;
    }
  };
}
