import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DatetimeField from 'https://cardstack.com/base/datetime';
import EmailField from 'https://cardstack.com/base/email';

import {
  formatCurrency,
  formatDateTime,
  formatNumber,
} from '@cardstack/boxel-ui/helpers';

import CustomerIcon from '@cardstack/boxel-icons/user';

class EmbeddedTemplate extends Component<typeof OnlineCustomer> {
  get initials() {
    try {
      const name = this.args.model?.customerName;
      if (!name) return '?';
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    } catch (e) {
      return '?';
    }
  }

  <template>
    <div class='embedded-container'>
      <div class='embedded-compact'>
        <div class='compact-avatar'>
          {{#if @model.customerName}}
            <div class='avatar-initials'>{{this.initials}}</div>
          {{else}}
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
              <circle cx='12' cy='7' r='4' />
            </svg>
          {{/if}}
        </div>

        <div class='compact-info'>
          <div class='compact-name'>{{if
              @model.customerName
              @model.customerName
              'Customer'
            }}</div>
          <div class='compact-tier'>{{@model.loyaltyTier}}</div>
          {{#if @model.totalSpent}}
            <div class='compact-spent'>{{formatCurrency
                @model.totalSpent
                currency='USD'
                size='tiny'
              }}</div>
          {{/if}}
        </div>
      </div>

      <div class='embedded-standard'>
        <div class='standard-header'>
          <div class='standard-avatar'>
            {{#if @model.customerName}}
              <div class='avatar-initials'>{{this.initials}}</div>
            {{else}}
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                <circle cx='12' cy='7' r='4' />
              </svg>
            {{/if}}
          </div>

          <div class='standard-info'>
            <div class='standard-name'>{{if
                @model.customerName
                @model.customerName
                'Unknown Customer'
              }}</div>
            {{#if @model.loyaltyTier}}
              <div class='standard-tier'>{{@model.loyaltyTier}} Customer</div>
            {{/if}}
            {{#if @model.email}}
              <div class='standard-email'>{{@model.email}}</div>
            {{/if}}
          </div>

          {{#if @model.totalSpent}}
            <div class='standard-highlight'>{{formatCurrency
                @model.totalSpent
                currency='USD'
                size='short'
              }}</div>
          {{/if}}
        </div>

        <div class='standard-metrics'>
          {{#if @model.totalOrders}}
            <div class='metric-card orders'>
              <div class='metric-value'>{{formatNumber
                  @model.totalOrders
                }}</div>
              <div class='metric-label'>Orders</div>
            </div>
          {{/if}}
          {{#if @model.customerSince}}
            <div class='metric-card since'>
              <div class='metric-value'>{{formatDateTime
                  @model.customerSince
                  size='short'
                }}</div>
              <div class='metric-label'>Since</div>
            </div>
          {{/if}}
        </div>
      </div>

      <div class='embedded-spacious'>
        <div class='spacious-header'>
          <div class='spacious-avatar'>
            {{#if @model.customerName}}
              <div class='avatar-initials'>{{this.initials}}</div>
            {{else}}
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                <circle cx='12' cy='7' r='4' />
              </svg>
            {{/if}}
          </div>

          <div class='spacious-info'>
            <div class='spacious-name'>{{if
                @model.customerName
                @model.customerName
                'Unknown Customer'
              }}</div>
            {{#if @model.loyaltyTier}}
              <div class='spacious-tier'>{{@model.loyaltyTier}}
                Status Customer</div>
            {{/if}}
          </div>

          {{#if @model.totalSpent}}
            <div class='spacious-highlight'>
              <div class='highlight-amount'>{{formatCurrency
                  @model.totalSpent
                  currency='USD'
                  size='medium'
                }}</div>
              <div class='highlight-label'>Total Spent</div>
            </div>
          {{/if}}
        </div>

        <div class='spacious-body'>
          {{#if @model.email}}
            <div class='contact-info'>
              <div class='contact-label'>Email:</div>
              <div class='contact-value'>{{@model.email}}</div>
            </div>
          {{/if}}
          {{#if @model.phone}}
            <div class='contact-info'>
              <div class='contact-label'>Phone:</div>
              <div class='contact-value'>{{@model.phone}}</div>
            </div>
          {{/if}}
        </div>

        <div class='spacious-stats'>
          {{#if @model.totalOrders}}
            <div class='stat-card primary'>
              <div class='stat-icon'>📦</div>
              <div class='stat-content'>
                <div class='stat-value'>{{formatNumber
                    @model.totalOrders
                  }}</div>
                <div class='stat-label'>Orders Placed</div>
              </div>
            </div>
          {{/if}}
          {{#if @model.customerSince}}
            <div class='stat-card'>
              <div class='stat-icon'>📅</div>
              <div class='stat-content'>
                <div class='stat-value'>{{formatDateTime
                    @model.customerSince
                    size='short'
                  }}</div>
                <div class='stat-label'>Customer Since</div>
              </div>
            </div>
          {{/if}}
        </div>
      </div>
    </div>

    <style scoped>
      /* Container query system for embedded template */
      .embedded-container {
        container-type: inline-size;
        width: 100%;
        height: 100%;
      }

      /* Hide all layouts by default */
      .embedded-compact,
      .embedded-standard,
      .embedded-spacious {
        display: none;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
        border-radius: 0.75rem;
        padding: 1rem;
        border: 1px solid rgba(226, 232, 240, 0.8);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        transition: all 0.3s ease;
      }

      /* Compact layout: ≤300px width */
      @container (max-width: 300px) {
        .embedded-compact {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 0.75rem;
          padding: 0.75rem;
        }
      }

      /* Standard layout: 301-500px width */
      @container (min-width: 301px) and (max-width: 500px) {
        .embedded-standard {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
      }

      /* Spacious layout: ≥501px width */
      @container (min-width: 501px) {
        .embedded-spacious {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          padding: 1.25rem;
        }
      }

      /* Avatar styles with gradients */
      .avatar-initials {
        font-weight: 700;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        letter-spacing: 0.025em;
      }

      /* Compact layout styles */
      .compact-avatar {
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        border-radius: 50%;
        overflow: hidden;
        background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .compact-avatar svg {
        width: 1.25rem;
        height: 1.25rem;
        color: #64748b;
      }

      .compact-info {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
      }

      .compact-name {
        font-size: 0.875rem;
        font-weight: 600;
        color: #1f2937;
        text-align: center;
      }

      .compact-tier {
        font-size: 0.75rem;
        color: #6366f1;
        background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
        padding: 0.25rem 0.5rem;
        border-radius: 0.375rem;
        font-weight: 500;
        border: 1px solid rgba(99, 102, 241, 0.2);
      }

      .compact-spent {
        font-size: 0.875rem;
        font-weight: 700;
        color: #059669;
      }

      /* Standard layout styles */
      .standard-header {
        display: flex;
        align-items: center;
        gap: 0.875rem;
      }

      .standard-avatar {
        width: 48px;
        height: 48px;
        flex-shrink: 0;
        border-radius: 50%;
        overflow: hidden;
        background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .standard-avatar svg {
        width: 1.5rem;
        height: 1.5rem;
        color: #64748b;
      }

      .standard-info {
        flex: 1;
        min-width: 0;
      }

      .standard-name {
        font-size: 1rem;
        font-weight: 600;
        color: #1f2937;
        margin-bottom: 0.25rem;
      }

      .standard-tier {
        font-size: 0.8125rem;
        color: #6366f1;
        font-weight: 600;
        margin-bottom: 0.25rem;
      }

      .standard-email {
        font-size: 0.75rem;
        color: #6b7280;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .standard-highlight {
        text-align: right;
        font-size: 1.125rem;
        font-weight: 700;
        color: #059669;
        flex-shrink: 0;
      }

      .standard-metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 0.75rem;
      }

      .metric-card {
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        padding: 0.75rem;
        border-radius: 0.5rem;
        text-align: center;
        border: 1px solid rgba(226, 232, 240, 0.8);
      }

      .metric-card.orders {
        background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
        border: 1px solid rgba(99, 102, 241, 0.2);
      }

      .metric-card.since {
        background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
        border: 1px solid rgba(245, 158, 11, 0.2);
      }

      .metric-value {
        font-size: 0.875rem;
        font-weight: 600;
        color: #1f2937;
      }

      .metric-label {
        font-size: 0.6875rem;
        color: #6b7280;
        margin-top: 0.25rem;
        font-weight: 500;
      }

      /* Spacious layout styles */
      .spacious-header {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .spacious-avatar {
        width: 56px;
        height: 56px;
        flex-shrink: 0;
        border-radius: 50%;
        overflow: hidden;
        background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      .spacious-avatar svg {
        width: 2rem;
        height: 2rem;
        color: #64748b;
      }

      .spacious-info {
        flex: 1;
        min-width: 0;
      }

      .spacious-name {
        font-size: 1.25rem;
        font-weight: 700;
        color: #1f2937;
        margin-bottom: 0.375rem;
      }

      .spacious-tier {
        font-size: 0.9375rem;
        color: #6366f1;
        font-weight: 600;
        background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
        padding: 0.375rem 0.75rem;
        border-radius: 0.5rem;
        display: inline-block;
        border: 1px solid rgba(99, 102, 241, 0.2);
      }

      .spacious-highlight {
        text-align: right;
        flex-shrink: 0;
        background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
        padding: 1rem;
        border-radius: 0.75rem;
        border: 2px solid rgba(5, 150, 105, 0.2);
      }

      .highlight-amount {
        font-size: 1.5rem;
        font-weight: 800;
        color: #059669;
        line-height: 1.1;
      }

      .highlight-label {
        font-size: 0.875rem;
        color: #047857;
        margin-top: 0.25rem;
        font-weight: 600;
      }

      .spacious-body {
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        padding: 1rem;
        border-radius: 0.75rem;
        border: 1px solid rgba(226, 232, 240, 0.8);
      }

      .contact-info {
        display: flex;
        gap: 0.75rem;
        align-items: center;
        margin-bottom: 0.5rem;
      }

      .contact-info:last-child {
        margin-bottom: 0;
      }

      .contact-label {
        font-size: 0.8125rem;
        font-weight: 600;
        color: #6b7280;
        min-width: 3.5rem;
      }

      .contact-value {
        font-size: 0.875rem;
        color: #6366f1;
        font-weight: 500;
      }

      .spacious-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 1rem;
      }

      .stat-card {
        display: flex;
        align-items: center;
        gap: 1rem;
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        padding: 1rem;
        border-radius: 0.75rem;
        border: 1px solid rgba(226, 232, 240, 0.8);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        transition: all 0.2s ease;
      }

      .stat-card:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      .stat-card.primary {
        background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
        border: 1px solid rgba(99, 102, 241, 0.2);
      }

      .stat-icon {
        font-size: 1.5rem;
        flex-shrink: 0;
      }

      .stat-content {
        flex: 1;
      }

      .stat-card .stat-value {
        font-size: 1.125rem;
        font-weight: 700;
        color: #1f2937;
        line-height: 1.1;
      }

      .stat-card .stat-label {
        font-size: 0.8125rem;
        color: #6b7280;
        margin-top: 0.25rem;
        font-weight: 500;
      }

      /* Hover effects */
      .embedded-container:hover .embedded-compact,
      .embedded-container:hover .embedded-standard,
      .embedded-container:hover .embedded-spacious {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.12);
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof OnlineCustomer> {
  get initials() {
    try {
      const name = this.args.model?.customerName;
      if (!name) return '?';
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    } catch (e) {
      return '?';
    }
  }

  get customerTier() {
    try {
      return this.args.model?.loyaltyTier ?? 'Bronze';
    } catch (e) {
      return 'Bronze';
    }
  }

  get isPremium() {
    return this.customerTier === 'Gold' || this.customerTier === 'Platinum';
  }

  <template>
    <div class='fitted-container'>
      <div class='badge-format'>
        <div class='badge-content'>
          {{#if @model.customerName}}
            <div class='badge-avatar'>
              <div class='avatar-initials'>{{this.initials}}</div>
            </div>
          {{else}}
            <div class='badge-icon'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                <circle cx='12' cy='7' r='4' />
              </svg>
            </div>
          {{/if}}

          <div class='badge-info'>
            <div class='primary-text badge-name'>{{if
                @model.customerName
                @model.customerName
                'Customer'
              }}</div>
            <div class='secondary-text badge-tier'>{{this.customerTier}}</div>
            {{#if @model.totalSpent}}
              <div class='tertiary-text badge-spent'>{{formatCurrency
                  @model.totalSpent
                  currency='USD'
                  size='tiny'
                }}</div>
            {{/if}}
          </div>

          {{#if this.isPremium}}
            <div class='badge-premium'>⭐</div>
          {{/if}}
        </div>
      </div>

      <div class='strip-format'>
        <div class='strip-content'>
          {{#if @model.customerName}}
            <div class='strip-avatar'>
              <div class='avatar-initials'>{{this.initials}}</div>
            </div>
          {{else}}
            <div class='strip-icon'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                <circle cx='12' cy='7' r='4' />
              </svg>
            </div>
          {{/if}}

          <div class='strip-info'>
            <div class='strip-main'>
              <div class='primary-text strip-name'>{{if
                  @model.customerName
                  @model.customerName
                  'Unknown Customer'
                }}</div>
              <div class='secondary-text strip-tier'>{{this.customerTier}}
                Customer</div>
            </div>

            <div class='strip-stats'>
              {{#if @model.totalOrders}}
                <div class='secondary-text strip-orders'>{{formatNumber
                    @model.totalOrders
                  }}
                  orders</div>
              {{/if}}
              {{#if @model.totalSpent}}
                <div class='primary-text strip-spent'>{{formatCurrency
                    @model.totalSpent
                    currency='USD'
                    size='short'
                  }}</div>
              {{/if}}
            </div>

            <div class='strip-meta'>
              {{#if @model.email}}
                <span class='tertiary-text'>{{@model.email}}</span>
              {{/if}}
              {{#if @model.customerSince}}
                <span class='tertiary-text'>Since
                  {{formatDateTime @model.customerSince size='tiny'}}</span>
              {{/if}}
            </div>
          </div>

          {{#if this.isPremium}}
            <div class='strip-badge'>{{this.customerTier}}</div>
          {{/if}}
        </div>
      </div>

      <div class='tile-format'>
        <div class='tile-content'>
          <div class='tile-header'>
            {{#if @model.customerName}}
              <div class='tile-avatar'>
                <div class='avatar-initials'>{{this.initials}}</div>
              </div>
            {{else}}
              <div class='tile-icon'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                  <circle cx='12' cy='7' r='4' />
                </svg>
              </div>
            {{/if}}

            <div class='tile-info'>
              <div class='primary-text tile-name'>{{if
                  @model.customerName
                  @model.customerName
                  'Unknown Customer'
                }}</div>
              <div class='secondary-text tile-tier'>{{this.customerTier}}
                Customer</div>
            </div>

            {{#if this.isPremium}}
              <div class='tile-premium'>⭐</div>
            {{/if}}
          </div>

          <div class='tile-stats'>
            {{#if @model.totalSpent}}
              <div class='tile-stat primary'>
                <div class='stat-value'>{{formatCurrency
                    @model.totalSpent
                    currency='USD'
                    size='medium'
                  }}</div>
                <div class='stat-label'>Total Spent</div>
              </div>
            {{/if}}

            <div class='tile-metrics'>
              {{#if @model.totalOrders}}
                <div class='tile-metric'>
                  <span class='metric-value'>{{formatNumber
                      @model.totalOrders
                    }}</span>
                  <span class='metric-label'>Orders</span>
                </div>
              {{/if}}
              {{#if @model.customerSince}}
                <div class='tile-metric'>
                  <span class='metric-value'>{{formatDateTime
                      @model.customerSince
                      size='short'
                    }}</span>
                  <span class='metric-label'>Since</span>
                </div>
              {{/if}}
            </div>
          </div>

          {{#if @model.email}}
            <div class='tile-email'>{{@model.email}}</div>
          {{/if}}
        </div>
      </div>

      <div class='card-format'>
        <div class='card-content'>
          <div class='card-header'>
            <div class='card-avatar-section'>
              {{#if @model.customerName}}
                <div class='card-avatar'>
                  <div class='avatar-initials'>{{this.initials}}</div>
                </div>
              {{else}}
                <div class='card-icon'>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                    <circle cx='12' cy='7' r='4' />
                  </svg>
                </div>
              {{/if}}

              {{#if this.isPremium}}
                <div class='card-premium-badge'>{{this.customerTier}}</div>
              {{/if}}
            </div>

            <div class='card-info'>
              <div class='primary-text card-name'>{{if
                  @model.customerName
                  @model.customerName
                  'Unknown Customer'
                }}</div>
              <div class='secondary-text card-tier'>{{this.customerTier}}
                Customer</div>
            </div>
          </div>

          <div class='card-stats'>
            {{#if @model.totalSpent}}
              <div class='card-stat primary'>
                <div class='stat-value'>{{formatCurrency
                    @model.totalSpent
                    currency='USD'
                    size='medium'
                  }}</div>
                <div class='stat-label'>Total Spent</div>
              </div>
            {{/if}}

            <div class='card-metrics'>
              {{#if @model.totalOrders}}
                <div class='card-metric'>
                  <div class='metric-value'>{{formatNumber
                      @model.totalOrders
                    }}</div>
                  <div class='metric-label'>Orders</div>
                </div>
              {{/if}}

              {{#if @model.customerSince}}
                <div class='card-metric'>
                  <div class='metric-value'>{{formatDateTime
                      @model.customerSince
                      size='short'
                    }}</div>
                  <div class='metric-label'>Customer Since</div>
                </div>
              {{/if}}
            </div>
          </div>

          <div class='card-footer'>
            <div class='card-contact'>
              {{#if @model.email}}
                <div class='contact-item'>
                  <span class='tertiary-text'>Email:</span>
                  <span class='secondary-text'>{{@model.email}}</span>
                </div>
              {{/if}}
              {{#if @model.phone}}
                <div class='contact-item'>
                  <span class='tertiary-text'>Phone:</span>
                  <span class='secondary-text'>{{@model.phone}}</span>
                </div>
              {{/if}}
            </div>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      /* Container query system */
      .fitted-container {
        container-type: size;
        width: 100%;
        height: 100%;
      }

      /* Hide all subformats by default */
      .badge-format,
      .strip-format,
      .tile-format,
      .card-format {
        display: none;
        width: 100%;
        height: 100%;
        padding: clamp(0.125rem, 1.5%, 0.5rem);
        box-sizing: border-box;
        overflow: hidden;
      }

      /* Activation ranges - NO GAPS */
      @container (max-width: 150px) and (max-height: 169px) {
        .badge-format {
          display: flex;
        }
      }

      @container (min-width: 151px) and (max-height: 169px) {
        .strip-format {
          display: flex;
          align-items: center;
        }
      }

      @container (max-width: 399px) and (min-height: 170px) {
        .tile-format {
          display: flex;
        }
      }

      @container (min-width: 400px) and (min-height: 170px) {
        .card-format {
          display: flex;
        }
      }

      /* Typography hierarchy */
      .primary-text {
        font-size: 1em;
        font-weight: 600;
        color: var(--text-primary, #1f2937);
        line-height: 1.2;
      }

      .secondary-text {
        font-size: 0.875em;
        font-weight: 500;
        color: var(--text-secondary, #6b7280);
        line-height: 1.3;
      }

      .tertiary-text {
        font-size: 0.75em;
        font-weight: 400;
        color: var(--text-tertiary, #9ca3af);
        line-height: 1.4;
      }

      /* Avatar styles with gradients */
      .avatar-initials {
        font-weight: 700;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        font-size: 0.875em;
        letter-spacing: 0.025em;
      }

      /* Badge format styles */
      .badge-content {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
        border-radius: 0.5rem;
        padding: 0.375rem;
        border: 1px solid rgba(226, 232, 240, 0.8);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .badge-avatar,
      .badge-icon {
        width: 1.8rem;
        height: 1.8rem;
        flex-shrink: 0;
        border-radius: 50%;
        overflow: hidden;
        position: relative;
      }

      .badge-avatar {
        flex-shrink: 0;
      }

      .badge-icon {
        background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #64748b;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .badge-icon svg {
        width: 0.875rem;
        height: 0.875rem;
      }

      .badge-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        height: 100%;
      }

      .badge-name {
        font-size: 0.875rem;
        font-weight: 600;
        color: #1f2937;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 0 0 auto;
      }

      .badge-tier {
        font-size: 0.75rem;
        margin-top: 0.125rem;
        color: #6366f1;
        font-weight: 500;
        flex: 0 0 auto;
      }

      .badge-spent {
        font-size: 0.6875rem;
        margin-top: auto;
        color: #059669;
        font-weight: 600;
        flex: 0 0 auto;
      }

      .badge-premium {
        font-size: 0.875rem;
        flex-shrink: 0;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
      }

      /* Strip format styles */
      .strip-content {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
        border-radius: 0.625rem;
        padding: 0.5rem;
        border: 1px solid rgba(226, 232, 240, 0.8);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        transition: all 0.2s ease;
      }

      .strip-avatar,
      .strip-icon {
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        border-radius: 50%;
        align-self: center;
        overflow: hidden;
      }

      .strip-avatar {
        flex-shrink: 0;
      }

      .strip-icon {
        background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #64748b;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .strip-icon svg {
        width: 1.375rem;
        height: 1.375rem;
      }

      .strip-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-width: 0;
        gap: 0.375rem;
        height: 100%;
      }

      .strip-main {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        flex: 0 0 auto;
      }

      .strip-name {
        font-size: 0.9375rem;
        font-weight: 600;
        color: #1f2937;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      .strip-tier {
        font-size: 0.75rem;
        color: #6366f1;
        background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
        padding: 0.25rem 0.5rem;
        border-radius: 0.375rem;
        flex-shrink: 0;
        font-weight: 600;
        border: 1px solid rgba(99, 102, 241, 0.2);
      }

      .strip-stats {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-top: 0.25rem;
        flex: 0 0 auto;
      }

      .strip-orders {
        font-size: 0.75rem;
        color: #6b7280;
        font-weight: 500;
      }

      .strip-spent {
        font-size: 0.9375rem;
        color: #059669;
        font-weight: 700;
      }

      .strip-meta {
        display: flex;
        gap: 0.75rem;
        font-size: 0.6875rem;
        margin-top: 0.25rem;
        flex: 0 0 auto;
      }

      .strip-badge {
        background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
        color: #92400e;
        padding: 0.375rem 0.625rem;
        border-radius: 0.5rem;
        font-size: 0.75rem;
        font-weight: 700;
        align-self: center;
        flex-shrink: 0;
        box-shadow: 0 2px 4px rgba(251, 191, 36, 0.3);
        border: 1px solid rgba(251, 191, 36, 0.3);
      }

      /* Tile format styles */
      .tile-content {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
        border-radius: 0.625rem;
        padding: 0.5rem;
        border: 1px solid rgba(226, 232, 240, 0.8);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        transition: all 0.3s ease;
      }

      .tile-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
        flex: 0 0 auto;
      }

      .tile-avatar,
      .tile-icon {
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        border-radius: 50%;
        overflow: hidden;
      }

      .tile-avatar {
        flex-shrink: 0;
      }

      .tile-icon {
        background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #64748b;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .tile-icon svg {
        width: 1.375rem;
        height: 1.375rem;
      }

      .tile-info {
        flex: 1;
        min-width: 0;
      }

      .tile-name {
        font-size: 0.9375rem;
        font-weight: 600;
        color: #1f2937;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tile-tier {
        font-size: 0.75rem;
        margin-top: 0.125rem;
        color: #6366f1;
        font-weight: 600;
      }

      .tile-premium {
        font-size: 0.875rem;
        flex-shrink: 0;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
      }

      .tile-stats {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        min-height: 0;
      }

      .tile-stat.primary {
        text-align: center;
        margin-bottom: 0.375rem;
        background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
        padding: 0.5rem;
        border-radius: 0.5rem;
        border: 1px solid rgba(5, 150, 105, 0.2);
        flex: 0 0 auto;
      }

      .tile-stat .stat-value {
        font-size: 0.9375rem;
        font-weight: 700;
        color: #059669;
        line-height: 1.1;
      }

      .tile-stat .stat-label {
        font-size: 0.75rem;
        color: #047857;
        margin-top: 0.125rem;
        font-weight: 600;
      }

      .tile-metrics {
        display: flex;
        justify-content: space-between;
        gap: 0.375rem;
        flex: 0 0 auto;
      }

      .tile-metric {
        text-align: center;
        flex: 1;
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        padding: 0.375rem;
        border-radius: 0.375rem;
        border: 1px solid rgba(226, 232, 240, 0.8);
      }

      .tile-metric .metric-value {
        display: block;
        font-size: 0.875rem;
        font-weight: 600;
        color: #1f2937;
        line-height: 1.1;
      }

      .tile-metric .metric-label {
        font-size: 0.6875rem;
        color: #6b7280;
        margin-top: 0.125rem;
        font-weight: 500;
      }

      .tile-email {
        font-size: 0.6875rem;
        color: #6366f1;
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: auto;
        padding: 0.375rem;
        background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
        border-radius: 0.375rem;
        font-weight: 500;
        border: 1px solid rgba(99, 102, 241, 0.2);
        flex: 0 0 auto;
      }

      /* Card format styles */
      .card-content {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        gap: 0.75rem;
        background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
        border-radius: 0.875rem;
        padding: 1rem;
        border: 1px solid rgba(226, 232, 240, 0.8);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
        transition: all 0.3s ease;
      }

      .card-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex: 0 0 auto;
      }

      .card-avatar-section {
        position: relative;
        flex-shrink: 0;
      }

      .card-avatar,
      .card-icon {
        width: 56px;
        height: 56px;
        flex-shrink: 0;
        border-radius: 50%;
        overflow: hidden;
      }

      .card-avatar {
        flex-shrink: 0;
      }

      .card-icon {
        background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #64748b;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      .card-icon svg {
        width: 2rem;
        height: 2rem;
      }

      .card-premium-badge {
        position: absolute;
        top: -0.375rem;
        right: -0.375rem;
        background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
        color: #92400e;
        padding: 0.25rem 0.5rem;
        border-radius: 0.5rem;
        font-size: 0.6875rem;
        font-weight: 700;
        box-shadow: 0 2px 8px rgba(251, 191, 36, 0.4);
        border: 2px solid white;
      }

      .card-info {
        flex: 1;
        min-width: 0;
      }

      .card-name {
        font-size: 1.125rem;
        font-weight: 700;
        color: #1f2937;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .card-tier {
        font-size: 0.9375rem;
        margin-top: 0.25rem;
        color: #6366f1;
        font-weight: 600;
      }

      .card-stats {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        min-height: 0;
      }

      .card-stat.primary {
        text-align: center;
        margin-bottom: 0.5rem;
        background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
        padding: 1rem;
        border-radius: 0.75rem;
        border: 2px solid rgba(5, 150, 105, 0.2);
        box-shadow: 0 4px 12px rgba(5, 150, 105, 0.1);
        flex: 0 0 auto;
      }

      .card-stat .stat-value {
        font-size: 1.75rem;
        font-weight: 800;
        color: #059669;
        line-height: 1.1;
      }

      .card-stat .stat-label {
        font-size: 0.9375rem;
        color: #047857;
        margin-top: 0.375rem;
        font-weight: 600;
      }

      .card-metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
        gap: 1rem;
        flex: 0 0 auto;
      }

      .card-metric {
        text-align: center;
        padding: 0.875rem;
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        border-radius: 0.75rem;
        border: 1px solid rgba(226, 232, 240, 0.8);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        transition: all 0.2s ease;
      }

      .card-metric:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      .card-metric .metric-value {
        font-size: 1rem;
        font-weight: 700;
        color: #1f2937;
        line-height: 1.1;
      }

      .card-metric .metric-label {
        font-size: 0.8125rem;
        color: #6b7280;
        margin-top: 0.375rem;
        font-weight: 500;
      }

      .card-footer {
        margin-top: auto;
        flex: 0 0 auto;
      }

      .card-contact {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        padding: 1rem;
        border-radius: 0.75rem;
        border: 1px solid rgba(226, 232, 240, 0.8);
      }

      .contact-item {
        display: flex;
        gap: 0.75rem;
        align-items: center;
      }

      .contact-item .tertiary-text {
        min-width: 3.5rem;
        font-weight: 600;
        color: #6b7280;
      }

      .contact-item .secondary-text {
        color: #6366f1;
        font-weight: 500;
      }
    </style>
  </template>
}

export class OnlineCustomer extends CardDef {
  static displayName = 'Customer';
  static icon = CustomerIcon;

  @field customerName = contains(StringField);
  @field email = contains(EmailField);
  @field phone = contains(StringField);
  @field totalOrders = contains(NumberField);
  @field totalSpent = contains(NumberField);
  @field customerSince = contains(DatetimeField);
  @field loyaltyTier = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: OnlineCustomer) {
      try {
        const name = this.customerName ?? 'Customer';
        return name.length > 50 ? name.substring(0, 47) + '...' : name;
      } catch (e) {
        console.error('OnlineCustomer: Error computing title', e);
        return 'Customer';
      }
    },
  });

  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
}
