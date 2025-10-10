import { array } from '@ember/helper';
import { gt } from '@cardstack/boxel-ui/helpers';
import { CardDef, field, linksTo } from 'https://cardstack.com/base/card-api';
import { Component, realmURL } from 'https://cardstack.com/base/card-api';
import { Button, BoxelInput } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import DashboardIcon from '@cardstack/boxel-icons/layout-dashboard';
import type { Query } from '@cardstack/runtime-common';
import { task } from 'ember-concurrency';
import { PolicyManual } from './policy-manual';
import { GenerateDailyReport } from '../commands/generate-daily-report';

class Isolated extends Component<typeof DailyReportDashboard> {
  get dailyReportsQuery(): Query {
    return {
      filter: {
        on: {
          module: new URL('./daily-report', import.meta.url).href,
          name: 'DailyReport',
        },
        eq: {
          'policyManual.id': this.args.model.policyManual!.id,
        },
      },

      sort: [
        {
          by: 'reportDate',
          on: {
            module: new URL('./daily-report', import.meta.url).href,
            name: 'DailyReport',
          },
          direction: 'desc',
        },
      ],
    };
  }

  get currentRealm() {
    return this.args.model[realmURL];
  }
  private get realms() {
    return [this.currentRealm!];
  }
  private get realmHrefs() {
    return this.realms.map((realm) => realm.href);
  }

  @tracked selectedDate: Date = new Date();

  get selectedDateString() {
    return this.selectedDate.toISOString().split('T')[0];
  }

  @action
  updateSelectedDate(date: string) {
    this.selectedDate = new Date(date);
  }

  @action
  generateReport() {
    this._generateReport.perform();
  }

  _generateReport = task(async () => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      throw new Error('Command context not available. Please try again.');
    }
    await new GenerateDailyReport(commandContext).execute({
      realm: this.currentRealm!.href,
      policyManual: this.args.model.policyManual,
      date: this.selectedDate,
    });
  });

  <template>
    <div class='dashboard-stage'>
      <div class='dashboard-container'>
        <header class='dashboard-header'>
          <div class='header-content'>
            <svg
              class='dashboard-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
              <rect x='9' y='9' width='13' height='13' rx='2' ry='2' />
            </svg>
            <div>
              <h1>{{@model.title}}</h1>
              <p class='dashboard-subtitle'>{{if
                  @model.description
                  @model.description
                  'Operations dashboard'
                }}</p>
            </div>
          </div>
        </header>

        <main class='dashboard-content'>
          <section class='reports-section'>
            <div class='section-header'>
              <div class='section-header-content'>
                <div>
                  <h2>
                    <svg
                      class='section-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
                      <line x1='16' y1='2' x2='16' y2='6' />
                      <line x1='8' y1='2' x2='8' y2='6' />
                      <line x1='3' y1='10' x2='21' y2='10' />
                    </svg>
                    Daily Reports
                  </h2>
                  <div class='section-subtitle'>Recent operational reports and
                    insights</div>
                </div>
                <div class='date-and-button-container'>
                  <div class='date-input-container'>
                    <BoxelInput
                      @type='date'
                      @value={{this.selectedDateString}}
                      @onInput={{this.updateSelectedDate}}
                      placeholder='Select date'
                    />
                  </div>
                  <Button
                    class='generate-report-button'
                    @disabled={{this._generateReport.isRunning}}
                    {{on 'click' this.generateReport}}
                  >
                    {{#if this._generateReport.isRunning}}
                      <svg
                        class='button-icon spinning'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <path d='M21 12a9 9 0 11-6.219-8.56' />
                      </svg>
                      Generating...
                    {{else}}
                      <svg
                        class='button-icon'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <circle cx='12' cy='12' r='10' />
                        <line x1='12' y1='8' x2='12' y2='12' />
                        <line x1='8' y1='12' x2='16' y2='12' />
                      </svg>
                      Generate Report
                    {{/if}}
                  </Button>
                </div>
              </div>
            </div>

            {{#let
              (component @context.prerenderedCardSearchComponent)
              as |PrerenderedCardSearch|
            }}
              <PrerenderedCardSearch
                @query={{this.dailyReportsQuery}}
                @format='fitted'
                @realms={{this.realmHrefs}}
                @isLive={{true}}
              >
                <:loading>
                  <div class='loading-grid'>
                    {{#each (array 1 2 3 4)}}
                      <div class='loading-card'>
                        <div class='loading-shimmer'></div>
                      </div>
                    {{/each}}
                  </div>
                </:loading>

                <:response as |cards|>
                  {{#if (gt cards.length 0)}}
                    <div class='reports-grid'>
                      {{#each cards key='url' as |card|}}
                        {{#if card.isError}}
                          <div class='error-card'>
                            <svg
                              class='error-icon'
                              viewBox='0 0 24 24'
                              fill='none'
                              stroke='currentColor'
                              stroke-width='2'
                            >
                              <circle cx='12' cy='12' r='10' />
                              <line x1='15' y1='9' x2='9' y2='15' />
                              <line x1='9' y1='9' x2='15' y2='15' />
                            </svg>
                            <div class='error-text'>Failed to load report</div>
                          </div>
                        {{else}}
                          <card.component
                            class='report-card-container hide-boundaries'
                          />
                        {{/if}}
                      {{/each}}
                    </div>
                  {{else}}
                    <div class='empty-state'>
                      <svg
                        class='empty-icon'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <rect
                          x='3'
                          y='4'
                          width='18'
                          height='18'
                          rx='2'
                          ry='2'
                        />
                        <line x1='16' y1='2' x2='16' y2='6' />
                        <line x1='8' y1='2' x2='8' y2='6' />
                        <line x1='3' y1='10' x2='21' y2='10' />
                      </svg>
                      <h3>No Daily Reports Yet</h3>
                      <p>Daily reports will appear here as they are created.
                        Start by creating your first daily report to track
                        operations and progress.</p>
                    </div>
                  {{/if}}
                </:response>
              </PrerenderedCardSearch>
            {{/let}}
          </section>
        </main>
      </div>
    </div>

    <style scoped>
      .dashboard-stage {
        width: 100%;
        height: 100%;
        background: linear-gradient(
          135deg,
          #f0f9ff 0%,
          #e0f2fe 50%,
          #f8fafc 100%
        );
        padding: 1rem;
        font-family: 'Inter', system-ui, sans-serif;
      }

      .dashboard-container {
        max-width: 84rem;
        margin: 0 auto;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .dashboard-header {
        background: white;
        border-radius: 0.75rem;
        box-shadow:
          0 4px 6px -1px rgba(0, 0, 0, 0.1),
          0 2px 4px -1px rgba(0, 0, 0, 0.06);
        margin-bottom: 1.5rem;
        padding: 2rem;
      }

      .header-content {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .dashboard-icon {
        width: 3rem;
        height: 3rem;
        color: #0ea5e9;
        flex-shrink: 0;
      }

      .dashboard-header h1 {
        margin: 0 0 0.5rem 0;
        font-size: 2rem;
        font-weight: 700;
        background: linear-gradient(135deg, #0ea5e9 0%, #3b82f6 100%);
        background-clip: text;
        -webkit-background-clip: text;
        color: transparent;
        line-height: 1.2;
      }

      .dashboard-subtitle {
        margin: 0;
        font-size: 1rem;
        color: #64748b;
        font-weight: 500;
      }

      .dashboard-content {
        background: white;
        border-radius: 0.75rem;
        box-shadow:
          0 4px 6px -1px rgba(0, 0, 0, 0.1),
          0 2px 4px -1px rgba(0, 0, 0, 0.06);
        padding: 2rem;
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .reports-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .section-header {
        margin-bottom: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 2px solid #f1f5f9;
      }

      .section-header-content {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
      }

      .date-and-button-container {
        display: flex;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .date-input-container {
        min-width: 200px;
      }

      .generate-report-button {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1.25rem;
        background: linear-gradient(135deg, #0ea5e9 0%, #3b82f6 100%);
        color: white;
        border: none;
        border-radius: 0.5rem;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(14, 165, 233, 0.2);
        white-space: nowrap;
      }

      .generate-report-button:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(14, 165, 233, 0.3);
        background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%);
      }

      .generate-report-button:disabled {
        opacity: 0.7;
        cursor: not-allowed;
        transform: none;
      }

      .button-icon {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
      }

      .spinning {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .section-header h2 {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0 0 0.5rem 0;
        font-size: 1.5rem;
        font-weight: 600;
        color: #1e293b;
      }

      .section-icon {
        width: 1.25rem;
        height: 1.25rem;
        color: #0ea5e9;
      }

      .section-subtitle {
        color: #64748b;
        font-size: 0.9375rem;
        margin: 0;
      }

      .reports-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.25rem;
        flex: 1;
        overflow-y: auto;
        padding: 0.5rem;
        margin: -0.5rem;
      }

      .report-card-container {
        min-height: 200px;
        border-radius: 0.5rem;
        transition: all 0.2s ease;
        border: 1px solid #e2e8f0;
        background: #ffffff;
      }

      .report-card-container:hover {
        transform: translateY(-2px);
        box-shadow:
          0 10px 25px -5px rgba(0, 0, 0, 0.1),
          0 4px 6px -2px rgba(0, 0, 0, 0.05);
        border-color: #cbd5e1;
      }

      .loading-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.25rem;
        padding: 0.5rem;
      }

      .loading-card {
        height: 200px;
        border-radius: 0.5rem;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        overflow: hidden;
        position: relative;
      }

      .loading-shimmer {
        width: 100%;
        height: 100%;
        background: linear-gradient(
          90deg,
          #f1f5f9 25%,
          #e2e8f0 50%,
          #f1f5f9 75%
        );
        background-size: 200% 100%;
        animation: shimmer 2s infinite;
      }

      @keyframes shimmer {
        0% {
          background-position: -200% 0;
        }
        100% {
          background-position: 200% 0;
        }
      }

      .error-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 200px;
        border: 1px solid #fecaca;
        border-radius: 0.5rem;
        background: #fef2f2;
        color: #dc2626;
        text-align: center;
        padding: 1rem;
      }

      .error-icon {
        width: 2rem;
        height: 2rem;
        margin-bottom: 0.5rem;
      }

      .error-text {
        font-size: 0.875rem;
        font-weight: 500;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 3rem 1.5rem;
        color: #64748b;
        flex: 1;
      }

      .empty-icon {
        width: 4rem;
        height: 4rem;
        color: #cbd5e1;
        margin-bottom: 1rem;
      }

      .empty-state h3 {
        margin: 0 0 0.5rem 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #475569;
      }

      .empty-state p {
        margin: 0;
        max-width: 28rem;
        line-height: 1.6;
      }

      @media (max-width: 768px) {
        .dashboard-stage {
          padding: 0.5rem;
        }

        .dashboard-header,
        .dashboard-content {
          padding: 1.5rem;
        }

        .dashboard-header h1 {
          font-size: 1.5rem;
        }

        .reports-grid {
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 1rem;
        }

        .header-content {
          gap: 0.75rem;
        }

        .dashboard-icon {
          width: 2.5rem;
          height: 2.5rem;
        }
      }

      @media (max-width: 768px) {
        .section-header-content {
          flex-direction: column;
          align-items: stretch;
        }

        .generate-report-button {
          align-self: flex-start;
        }
      }

      @media (max-width: 640px) {
        .reports-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

export class DailyReportDashboard extends CardDef {
  static displayName = 'Daily Report Dashboard';
  static icon = DashboardIcon;

  @field policyManual = linksTo(() => PolicyManual);
  static isolated = Isolated;
}
