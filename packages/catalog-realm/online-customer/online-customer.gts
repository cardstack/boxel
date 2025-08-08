import {
  CardDef,
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DatetimeField from 'https://cardstack.com/base/datetime';
import { ContactLinkField } from '../fields/contact-link';

import {
  formatCurrency,
  formatDateTime,
  formatNumber,
} from '@cardstack/boxel-ui/helpers';
import { BoxelSelect } from '@cardstack/boxel-ui/components';

import CustomerIcon from '@cardstack/boxel-icons/user';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

class LoyaltyTierFieldEdit extends Component<typeof LoyaltyTierField> {
  get initialTierName() {
    return this.args.model.name || 'Bronze';
  }

  @tracked selectedTier: { name: string } | null = {
    name: this.initialTierName,
  };
  @tracked tierOptions = [
    { name: 'Bronze' },
    { name: 'Silver' },
    { name: 'Gold' },
    { name: 'Platinum' },
  ];

  @action onSelectTier(tier: { name: string } | null) {
    this.selectedTier = tier;
    // Update the field's name property directly
    if (tier) {
      this.args.model.name = tier.name;
    }
  }

  <template>
    <BoxelSelect
      @placeholder='Select loyalty tier'
      @options={{this.tierOptions}}
      @selected={{this.selectedTier}}
      @onChange={{this.onSelectTier}}
      @searchEnabled={{false}}
      as |tier|
    >
      <div>{{tier.name}}</div>
    </BoxelSelect>
  </template>
}

class LoyaltyTierField extends FieldDef {
  static displayName = 'Loyalty Tier';
  @field name = contains(StringField);
  static edit = LoyaltyTierFieldEdit;
}

class IsolatedTemplate extends Component<typeof OnlineCustomer> {
  get initials() {
    try {
      const name = this.args.model?.customerName;
      if (!name) return '?';
      return name
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    } catch (e) {
      return '?';
    }
  }

  get customerTier() {
    try {
      return this.args.model?.loyaltyTier?.name ?? 'Bronze';
    } catch (e) {
      return 'Bronze';
    }
  }

  get isPremium() {
    return this.customerTier === 'Gold' || this.customerTier === 'Platinum';
  }

  <template>
    <div class='customer-card'>
      <div class='customer-header'>
        <div class='avatar-section'>
          {{#if @model.customerName}}
            <div class='avatar'>
              <div class='avatar-initials'>{{this.initials}}</div>
            </div>
          {{else}}
            <div class='avatar-placeholder'>
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
            <div class='premium-badge'>{{this.customerTier}}</div>
          {{/if}}
        </div>

        <div class='customer-info'>
          <h1 class='customer-name'>{{if
              @model.customerName
              @model.customerName
              'Unknown Customer'
            }}</h1>
          <div class='customer-tier'>{{this.customerTier}} Status Customer</div>
          {{#if @model.email}}
            <div class='contact-info'>
              <@fields.email @format='atom' />
              <span class='contact-value'>{{@model.email.value}}</span>
            </div>
          {{/if}}
          {{#if @model.phone}}
            <div class='contact-info'>
              <@fields.phone @format='atom' />
              <span class='contact-value'>{{@model.phone.value}}</span>
            </div>
          {{/if}}
        </div>
      </div>

      {{#if @model.totalSpent}}
        <div class='spending-highlight'>
          <div class='highlight-amount'>{{formatCurrency
              @model.totalSpent
              currency='USD'
              size='medium'
            }}</div>
          <div class='highlight-label'>Total Spent</div>
        </div>
      {{/if}}

      <div class='customer-stats'>
        {{#if @model.totalOrders}}
          <div class='stat-card orders'>
            <div class='stat-icon'>📦</div>
            <div class='stat-content'>
              <div class='stat-value'>{{formatNumber @model.totalOrders}}</div>
              <div class='stat-label'>Orders Placed</div>
            </div>
          </div>
        {{/if}}

        {{#if @model.customerSince}}
          <div class='stat-card since'>
            <div class='stat-icon'>📅</div>
            <div class='stat-content'>
              <div class='stat-value'>{{formatDateTime
                  @model.customerSince
                  size='medium'
                }}</div>
              <div class='stat-label'>Customer Since</div>
            </div>
          </div>
        {{/if}}
      </div>

    </div>

    <style scoped>
      .customer-card {
        container-type: inline-size;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
        border-radius: 1rem;
        padding: 1.5rem;
        border: 1px solid rgba(226, 232, 240, 0.8);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .customer-header {
        display: flex;
        align-items: flex-start;
        gap: 1.25rem;
        flex-wrap: wrap;
      }

      .avatar-section {
        position: relative;
        flex-shrink: 0;
      }

      .avatar,
      .avatar-placeholder {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .avatar-initials {
        font-weight: 700;
        color: white;
        font-size: 1.5rem;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
      }

      .avatar-placeholder {
        background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
        color: #64748b;
      }

      .avatar-placeholder svg {
        width: 2.5rem;
        height: 2.5rem;
      }

      .premium-badge {
        position: absolute;
        top: -0.5rem;
        right: -0.5rem;
        background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
        color: #92400e;
        padding: 0.5rem 1rem;
        border-radius: 0.75rem;
        font-size: 0.875rem;
        font-weight: 700;
        box-shadow: 0 4px 12px rgba(251, 191, 36, 0.4);
        border: 2px solid white;
      }

      .customer-info {
        flex: 1;
      }

      .customer-name {
        font-size: 1.8rem;
        font-weight: 800;
        color: #1f2937;
        margin: 0 0 0.5rem 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .customer-tier {
        font-size: 1rem;
        color: #6366f1;
        font-weight: 600;
        background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
        padding: 0.5rem 1rem;
        border-radius: 0.75rem;
        display: inline-block;
        border: 1px solid rgba(99, 102, 241, 0.2);
        margin-bottom: 0.5rem;
      }

      .contact-info {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        color: #6366f1;
        font-weight: 500;
        margin-top: 0.25rem;
      }
      .contact-info :where(.atom-format) {
        flex-shrink: 0;
      }

      .contact-value {
        font-size: 0.75rem;
        color: #6b7280;
        font-weight: 400;
      }

      .spending-highlight {
        height: fit-content;
        text-align: center;
        background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
        padding: 2rem;
        border-radius: 1rem;
        border: 2px solid rgba(5, 150, 105, 0.2);
        box-shadow: 0 8px 25px rgba(5, 150, 105, 0.1);
      }

      .highlight-amount {
        font-size: 2rem;
        font-weight: 900;
        color: #059669;
        line-height: 1;
      }

      .highlight-label {
        font-size: 1.25rem;
        color: #047857;
        margin-top: 0.5rem;
        font-weight: 700;
      }

      .customer-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1.5rem;
      }

      .stat-card {
        display: flex;
        align-items: center;
        gap: 1rem;
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        padding: 1.5rem;
        border-radius: 1rem;
        border: 1px solid rgba(226, 232, 240, 0.8);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        transition: all 0.2s ease;
      }

      .stat-card.orders {
        background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
        border: 1px solid rgba(99, 102, 241, 0.2);
      }

      .stat-card.since {
        background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
        border: 1px solid rgba(245, 158, 11, 0.2);
      }

      .stat-icon {
        font-size: 2rem;
        flex-shrink: 0;
      }

      .stat-content {
        flex: 1;
      }

      .stat-value {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1f2937;
        line-height: 1.1;
      }

      .stat-label {
        font-size: 1rem;
        color: #6b7280;
        margin-top: 0.25rem;
        font-weight: 500;
      }
    </style>
  </template>
}

class EmbeddedTemplate extends Component<typeof OnlineCustomer> {
  get initials() {
    try {
      const name = this.args.model?.customerName;
      if (!name) return '?';
      return name
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    } catch (e) {
      return '?';
    }
  }

  get customerTier() {
    try {
      return this.args.model?.loyaltyTier?.name ?? 'Bronze';
    } catch (e) {
      return 'Bronze';
    }
  }

  get isPremium() {
    return this.customerTier === 'Gold' || this.customerTier === 'Platinum';
  }

  <template>
    <div class='customer-embedded'>
      <div class='customer-header'>
        <div class='avatar-section'>
          {{#if @model.customerName}}
            <div class='avatar'>
              <div class='avatar-initials'>{{this.initials}}</div>
            </div>
          {{else}}
            <div class='avatar-placeholder'>
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
            <div class='premium-badge'>{{this.customerTier}}</div>
          {{/if}}
        </div>

        <div class='customer-info'>
          <div class='customer-name'>{{if
              @model.customerName
              @model.customerName
              'Unknown Customer'
            }}</div>
          <div class='customer-tier'>{{this.customerTier}} Customer</div>
          {{#if @model.email}}
            <div class='contact-info'>
              <@fields.email @format='atom' />
              <span class='contact-value'>{{@model.email.value}}</span>
            </div>
          {{/if}}
          {{#if @model.phone}}
            <div class='contact-info'>
              <@fields.phone @format='atom' />
              <span class='contact-value'>{{@model.phone.value}}</span>
            </div>
          {{/if}}
        </div>

        {{#if @model.totalSpent}}
          <div class='spending-highlight'>
            <div class='highlight-amount'>{{formatCurrency
                @model.totalSpent
                currency='USD'
                size='medium'
              }}</div>
            <div class='highlight-label'>Total Spent</div>
          </div>
        {{/if}}
      </div>

      <div class='customer-stats'>
        {{#if @model.totalOrders}}
          <div class='stat-card orders'>
            <div class='stat-icon'>📦</div>
            <div class='stat-content'>
              <div class='stat-value'>{{formatNumber @model.totalOrders}}</div>
              <div class='stat-label'>Orders</div>
            </div>
          </div>
        {{/if}}

        {{#if @model.customerSince}}
          <div class='stat-card since'>
            <div class='stat-icon'>📅</div>
            <div class='stat-content'>
              <div class='stat-value'>{{formatDateTime
                  @model.customerSince
                  size='short'
                }}</div>
              <div class='stat-label'>Since</div>
            </div>
          </div>
        {{/if}}
      </div>

    </div>

    <style scoped>
      .customer-embedded {
        container-type: inline-size;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
        border-radius: 0.75rem;
        padding: 1rem;
        border: 1px solid rgba(226, 232, 240, 0.8);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .customer-header {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .avatar-section {
        position: relative;
        flex-shrink: 0;
      }

      .avatar,
      .avatar-placeholder {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .avatar-initials {
        font-weight: 700;
        color: white;
        font-size: 1.125rem;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
      }

      .avatar-placeholder {
        background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
        color: #64748b;
      }

      .avatar-placeholder svg {
        width: 1.75rem;
        height: 1.75rem;
      }

      .premium-badge {
        position: absolute;
        top: -0.375rem;
        right: -0.375rem;
        background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
        color: #92400e;
        padding: 0.25rem 0.5rem;
        border-radius: 0.5rem;
        font-size: 0.75rem;
        font-weight: 700;
        box-shadow: 0 2px 8px rgba(251, 191, 36, 0.4);
        border: 2px solid white;
      }

      .customer-info {
        flex: 1;
      }

      .customer-name {
        font-size: 1.25rem;
        font-weight: 700;
        color: #1f2937;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .customer-tier {
        font-size: 0.9375rem;
        color: #6366f1;
        font-weight: 600;
        margin-top: 0.25rem;
        margin-bottom: 0.25rem;
      }

      .contact-info {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.75rem;
        color: #6366f1;
        font-weight: 500;
        margin-top: 0.125rem;
      }
      .contact-info :where(.atom-format) {
        flex-shrink: 0;
      }

      .contact-value {
        font-size: 0.75rem;
        color: #6b7280;
        font-weight: 400;
      }

      .spending-highlight {
        height: fit-content;
        text-align: right;
        background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
        padding: 0.75rem;
        border-radius: 0.75rem;
        border: 1px solid rgba(5, 150, 105, 0.2);
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

      .customer-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 1rem;
      }

      .stat-card {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        padding: 1rem;
        border-radius: 0.75rem;
        border: 1px solid rgba(226, 232, 240, 0.8);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        transition: all 0.2s ease;
      }

      .stat-card.orders {
        background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
        border: 1px solid rgba(59, 130, 246, 0.2);
      }

      .stat-card.since {
        background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
        border: 1px solid rgba(245, 158, 11, 0.2);
      }

      .stat-icon {
        font-size: 1.5rem;
        flex-shrink: 0;
      }

      .stat-content {
        flex: 1;
      }

      .stat-value {
        font-size: 1.125rem;
        font-weight: 700;
        color: #1f2937;
        line-height: 1.1;
      }

      .stat-label {
        font-size: 0.8125rem;
        color: #6b7280;
        margin-top: 0.25rem;
        font-weight: 500;
      }

      /* Container query responsive layouts */
      @container (max-width: 500px) {
        .customer-embedded {
          padding: 0.75rem;
          gap: 0.75rem;
        }

        .customer-header {
          flex-direction: column;
          text-align: center;
          align-items: center;
          gap: 0.75rem;
        }

        .avatar,
        .avatar-placeholder {
          width: 48px;
          height: 48px;
        }

        .avatar-initials {
          font-size: 1rem;
        }

        .avatar-placeholder svg {
          width: 1.5rem;
          height: 1.5rem;
        }

        .customer-name {
          font-size: 1.125rem;
        }

        .customer-tier {
          font-size: 0.875rem;
        }

        .spending-highlight {
          text-align: center;
          padding: 0.5rem;
          width: 100%;
        }

        .highlight-amount {
          font-size: 1.25rem;
        }

        .customer-stats {
          grid-template-columns: 1fr;
          gap: 0.75rem;
        }

        .stat-card {
          padding: 0.75rem;
        }

        .contact-section {
          padding: 0.75rem;
        }
      }

      @container (min-width: 301px) and (max-width: 500px) {
        .customer-stats {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @container (min-width: 501px) {
        .customer-stats {
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        }
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
      return this.args.model?.loyaltyTier?.name ?? 'Bronze';
    } catch (e) {
      return 'Bronze';
    }
  }

  get totalSpentFormatted() {
    try {
      return this.args.model?.totalSpent
        ? formatCurrency(this.args.model.totalSpent, {
            currency: 'USD',
            size: 'tiny',
          })
        : null;
    } catch (e) {
      return null;
    }
  }

  <template>
    <div class='fitted-container'>
      {{! Badge Format: Ultra compact with icon + primary + secondary }}
      <div class='badge-format'>
        <div class='badge-content'>
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
          <div class='badge-text'>
            <div class='badge-primary'>{{if
                @model.customerName
                @model.customerName
                'Customer'
              }}</div>
            <div class='badge-secondary'>{{this.customerTier}}</div>
          </div>
          {{#if this.totalSpentFormatted}}
            <div class='badge-amount'>{{this.totalSpentFormatted}}</div>
          {{/if}}
        </div>
      </div>

      {{! Strip Format: Avatar left, text left-aligned }}
      <div class='strip-format'>
        <div class='strip-content'>
          <div class='strip-avatar'>{{this.initials}}</div>
          <div class='strip-text'>
            <div class='strip-primary'>{{if
                @model.customerName
                @model.customerName
                'Customer'
              }}</div>
            <div class='strip-secondary'>{{this.customerTier}}
              •
              {{@model.totalOrders}}
              orders</div>
          </div>
          {{#if this.totalSpentFormatted}}
            <div class='strip-amount'>{{this.totalSpentFormatted}}</div>
          {{/if}}
        </div>
      </div>

      {{! Tile Format: Icon on top, everything centered }}
      <div class='tile-format'>
        <div class='tile-content'>
          <div class='tile-header'>
            <div class='tile-avatar'>{{this.initials}}</div>
            <div class='tile-badge'>{{this.customerTier}}</div>
          </div>
          <div class='tile-body'>
            <div class='tile-primary'>{{if
                @model.customerName
                @model.customerName
                'Customer'
              }}</div>
            <div class='tile-secondary'>{{@model.totalOrders}}
              orders placed</div>
            {{#if this.totalSpentFormatted}}
              <div class='tile-amount'>{{this.totalSpentFormatted}}
                total spent</div>
            {{/if}}
          </div>
          <div class='tile-footer'>
            {{#if @model.email}}
              <div class='tile-contact'><@fields.email @format='atom' /></div>
            {{/if}}
          </div>
        </div>
      </div>

      {{! Card Format: Avatar left, comprehensive layout }}
      <div class='card-format'>
        <div class='card-content'>
          <div class='card-header'>
            <div class='card-avatar'>{{this.initials}}</div>
            <div class='card-info'>
              <div class='card-primary'>{{if
                  @model.customerName
                  @model.customerName
                  'Customer'
                }}</div>
              <div class='card-secondary'>{{this.customerTier}} Customer</div>
            </div>
            <div class='card-badge'>{{this.customerTier}}</div>
          </div>
          <div class='card-body'>
            <div class='card-stats'>
              <div class='stat-item'>
                <div class='stat-value'>{{@model.totalOrders}}</div>
                <div class='stat-label'>Orders</div>
              </div>
              {{#if this.totalSpentFormatted}}
                <div class='stat-item'>
                  <div class='stat-value'>{{this.totalSpentFormatted}}</div>
                  <div class='stat-label'>Spent</div>
                </div>
              {{/if}}
              {{#if @model.customerSince}}
                <div class='stat-item'>
                  <div class='stat-value'>{{formatDateTime
                      @model.customerSince
                      size='tiny'
                    }}</div>
                  <div class='stat-label'>Since</div>
                </div>
              {{/if}}
            </div>
          </div>
          <div class='card-footer'>
            {{#if @model.email}}
              <div class='card-contact'>
                <@fields.email @format='atom' />
                <span class='contact-value'>{{@model.email.value}}</span>
              </div>
            {{/if}}
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .fitted-container {
        container-type: size;
        width: 100%;
        height: 100%;
        position: relative;
      }

      /* Hide all formats by default */
      .badge-format,
      .strip-format,
      .tile-format,
      .card-format {
        display: none;
        width: 100%;
        height: 100%;
        padding: clamp(0.1875rem, 2%, 0.625rem);
        box-sizing: border-box;
        overflow: hidden;
      }

      /* === RESPONSIVE TYPOGRAPHY HIERARCHY === */
      /* All primary (title/name) elements - ellipsis style */
      .badge-primary,
      .strip-primary,
      .tile-primary,
      .card-primary {
        font-weight: 600;
        color: #1f2937;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* All secondary elements - ALWAYS smaller than primary */
      .badge-secondary,
      .strip-secondary,
      .tile-secondary,
      .card-secondary {
        font-weight: 500;
        color: #6b7280;
        line-height: 1.3;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Tertiary elements - smallest */
      .badge-tertiary,
      .strip-tertiary,
      .tile-tertiary,
      .card-tertiary {
        font-weight: 400;
        color: #9ca3af;
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Amount styling across all formats */
      .badge-amount,
      .strip-amount,
      .tile-amount {
        font-weight: 600;
        color: #059669;
        flex-shrink: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* === BADGE FORMAT === */
      @container (max-width: 150px) and (max-height: 169px) {
        .badge-format {
          display: flex;
          padding: 0.1875rem;
        }

        .badge-content {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          width: 100%;
        }

        .badge-icon {
          width: 0.75rem;
          height: 0.75rem;
          flex-shrink: 0;
          color: #6366f1;
        }

        .badge-text {
          flex: 1;
          min-width: 0;
        }

        /* Smallest font sizes for badges - responsive rem units */
        .badge-primary {
          font-size: clamp(0.4375rem, 1.5vw, 0.5625rem);
        }
        .badge-secondary {
          font-size: clamp(
            0.375rem,
            1.2vw,
            0.4375rem
          ); /* Always smaller than primary */
        }
        .badge-amount {
          font-size: clamp(0.375rem, 1.2vw, 0.4375rem);
        }
      }

      /* === STRIP FORMAT === */
      @container (min-width: 151px) and (max-height: 169px) {
        .strip-format {
          display: flex;
          padding: 0.25rem;
        }

        .strip-content {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
        }

        .strip-avatar {
          width: 1.5rem;
          height: 1.5rem;
          border-radius: 50%;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 700;
          font-size: 0.5rem;
          flex-shrink: 0;
        }

        .strip-text {
          flex: 1;
          min-width: 0;
          text-align: left; /* Left-aligned when avatar on left */
        }

        /* Small font sizes for strips - responsive rem units */
        .strip-primary {
          font-size: clamp(0.625rem, 2vw, 0.75rem);
        }
        .strip-secondary {
          font-size: clamp(
            0.5rem,
            1.8vw,
            0.625rem
          ); /* Always smaller than primary */
          margin-top: 0.125rem;
        }
        .strip-amount {
          font-size: clamp(0.5rem, 1.8vw, 0.625rem);
        }

        /* Even smaller for shorter strips */
        @container (max-height: 65px) {
          .strip-primary {
            font-size: clamp(0.5625rem, 1.8vw, 0.625rem);
          }
          .strip-secondary {
            font-size: clamp(0.4375rem, 1.5vw, 0.5rem); /* Maintain hierarchy */
          }
          .strip-amount {
            font-size: clamp(0.4375rem, 1.5vw, 0.5rem);
          }
          .strip-avatar {
            width: clamp(1rem, 3vw, 1.25rem);
            height: clamp(1rem, 3vw, 1.25rem);
            font-size: clamp(0.375rem, 1.2vw, 0.4375rem);
          }
        }
      }

      /* === TILE FORMAT === */
      @container (max-width: 399px) and (min-height: 170px) {
        .tile-format {
          display: flex;
          flex-direction: column;
          padding: 0.5rem;
        }

        .tile-content {
          display: flex;
          flex-direction: column;
          height: 100%;
          text-align: center; /* Everything centered when icon on top */
        }

        .tile-header {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }

        .tile-avatar {
          width: 2rem;
          height: 2rem;
          border-radius: 50%;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 700;
          font-size: 0.75rem;
        }

        .tile-badge {
          background: rgba(99, 102, 241, 0.1);
          color: #6366f1;
          padding: 0.1875rem 0.375rem;
          border-radius: 0.375rem;
          font-size: 0.5625rem;
          font-weight: 600;
          border: 1px solid rgba(99, 102, 241, 0.2);
        }

        .tile-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.25rem;
        }

        .tile-primary {
          font-size: clamp(0.75rem, 2.5vw, 0.875rem);
        }
        .tile-secondary {
          font-size: clamp(
            0.625rem,
            2vw,
            0.75rem
          ); /* Always smaller than primary */
        }
        .tile-amount {
          font-size: clamp(0.625rem, 2vw, 0.75rem);
          margin-top: 0.25rem;
        }

        .tile-footer {
          margin-top: auto;
          padding-top: 0.5rem;
        }

        .tile-contact {
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.5625rem;
        }

        /* Progressive content hiding when height too short */
        @container (max-height: 220px) {
          .tile-amount {
            display: none; /* Hide tertiary content first */
          }
        }

        @container (max-height: 180px) {
          .tile-secondary {
            display: none; /* Hide secondary content next */
          }
          .tile-footer {
            display: none;
          }
        }
      }

      /* === CARD FORMAT === */
      @container (min-width: 400px) and (min-height: 170px) {
        .card-format {
          display: flex;
          flex-direction: column;
          padding: 0.75rem;
        }

        .card-content {
          display: flex;
          flex-direction: column;
          height: 100%;
          gap: 0.75rem;
        }

        .card-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .card-avatar {
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 50%;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 700;
          font-size: 0.9375rem;
          flex-shrink: 0;
        }

        .card-info {
          flex: 1;
          min-width: 0;
          text-align: left; /* Left-aligned when avatar on left */
        }

        .card-primary {
          font-size: clamp(0.875rem, 3vw, 1rem);
          margin-bottom: 0.25rem;
        }
        .card-secondary {
          font-size: clamp(
            0.6875rem,
            2.5vw,
            0.8125rem
          ); /* Always smaller than primary */
        }

        .card-badge {
          background: rgba(99, 102, 241, 0.1);
          color: #6366f1;
          padding: 0.3125rem 0.625rem;
          border-radius: 0.5rem;
          font-size: 0.625rem;
          font-weight: 600;
          border: 1px solid rgba(99, 102, 241, 0.2);
          flex-shrink: 0;
        }

        .card-body {
          flex: 1;
          display: flex;
          align-items: center;
        }

        .card-stats {
          display: flex;
          gap: 1.25rem;
          width: 100%;
        }

        .stat-item {
          text-align: center;
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          padding: 0.5rem;
          border-radius: 0.5rem;
          border: 1px solid rgba(226, 232, 240, 0.8);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
          transition: all 0.2s ease;
        }

        .stat-item:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .stat-value {
          font-size: 1rem;
          font-weight: 700;
          color: #1f2937;
          line-height: 1.1;
        }

        .stat-label {
          font-size: 0.625rem;
          color: #6b7280;
          margin-top: 0.25rem;
          font-weight: 500;
        }

        .card-footer {
          margin-top: auto;
        }

        .card-contact {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.6875rem;
          color: #6366f1;
        }

        .contact-value {
          font-size: 0.625rem;
          color: #6b7280;
          font-weight: 400;
        }

        /* Progressive content hiding when height too short */
        @container (max-height: 220px) {
          .card-footer {
            display: none; /* Hide footer first */
          }
        }

        @container (max-height: 180px) {
          .stat-label {
            display: none; /* Hide stat labels next */
          }
        }

        @container (max-height: 150px) {
          .card-badge {
            display: none; /* Hide badge if very short */
          }
        }
      }

      /* Golden ratio split for compact cards (400×170px) */
      @container (min-width: 400px) and (height: 170px) {
        .card-content {
          flex-direction: row;
          align-items: center;
          gap: 1rem;
        }

        .card-header {
          flex: 1.618; /* Golden ratio */
          flex-direction: column;
          align-items: flex-start;
          text-align: left;
        }

        .card-body {
          flex: 1;
          justify-content: center;
        }

        .card-stats {
          flex-direction: column;
          gap: 0.5rem;
        }

        .card-footer {
          margin-top: 0;
        }
      }
    </style>
  </template>
}

export class OnlineCustomer extends CardDef {
  static displayName = 'Customer';
  static icon = CustomerIcon;

  @field customerName = contains(StringField);
  @field email = contains(ContactLinkField);
  @field phone = contains(ContactLinkField);
  @field totalOrders = contains(NumberField);
  @field totalSpent = contains(NumberField);
  @field customerSince = contains(DatetimeField);
  @field loyaltyTier = contains(LoyaltyTierField);

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

  static isolated = IsolatedTemplate;
  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
}
