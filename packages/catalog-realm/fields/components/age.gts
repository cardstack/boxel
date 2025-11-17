import GlimmerComponent from '@glimmer/component';
import { and, eq } from '@cardstack/boxel-ui/helpers';

interface AgeConfiguration {
  ageOptions?: {
    showNextBirthday?: boolean;
  };
}
export interface AgeSignature {
  Args: {
    model?: any;
    config?: AgeConfiguration;
  };
}

export class Age extends GlimmerComponent<AgeSignature> {
  get config(): AgeConfiguration | undefined {
    return this.args.config as AgeConfiguration | undefined;
  }

  get birthDate() {
    return this.args.model;
  }

  get showNextBirthday() {
    return this.config?.ageOptions?.showNextBirthday ?? true;
  }

  get age() {
    if (!this.birthDate) return null;

    try {
      const birth = new Date(this.birthDate);
      const today = new Date();

      // If birth date is in the future, return null (invalid)
      if (birth > today) return null;

      let years = today.getFullYear() - birth.getFullYear();
      const monthDiff = today.getMonth() - birth.getMonth();

      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < birth.getDate())
      ) {
        years--;
      }

      // If less than 1 year old, calculate months
      if (years === 0) {
        let months = today.getMonth() - birth.getMonth();
        if (today.getDate() < birth.getDate()) {
          months--;
        }
        // Handle negative months (birth date in previous calendar year)
        if (months < 0) {
          months += 12;
        }
        return { years: 0, months };
      }

      return { years, months: 0 };
    } catch {
      return null;
    }
  }

  get nextBirthday() {
    if (!this.birthDate) return null;

    try {
      const birth = new Date(this.birthDate);
      const today = new Date();

      // If birth date is in the future, can't calculate next birthday
      if (birth > today) return null;

      const nextBday = new Date(
        today.getFullYear(),
        birth.getMonth(),
        birth.getDate(),
      );

      if (nextBday < today) {
        nextBday.setFullYear(today.getFullYear() + 1);
      }

      const diff = nextBday.getTime() - today.getTime();
      const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

      return days;
    } catch {
      return null;
    }
  }

  get isFutureDate() {
    if (!this.birthDate) return false;
    try {
      const birth = new Date(this.birthDate);
      const today = new Date();
      return birth > today;
    } catch {
      return false;
    }
  }

  get birthDateDisplay() {
    if (!this.birthDate) return '';

    try {
      return new Date(this.birthDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  }

  <template>
    <div class='age-calculator' data-test-age-calculator>
      {{#if this.isFutureDate}}
        <div class='age-error'>Invalid birth date (future date not allowed)</div>
      {{else if this.age}}
        <div class='age-display'>
          <div class='age-value'>
            {{#if (eq this.age.years 0)}}
              {{this.age.months}}
              {{if (eq this.age.months 1) 'month' 'months'}}
              old
            {{else}}
              {{this.age.years}}
              {{if (eq this.age.years 1) 'year' 'years'}}
              old
            {{/if}}
          </div>
          <div class='age-meta'>
            Born
            {{this.birthDateDisplay}}
            {{#if (and this.nextBirthday (Number this.showNextBirthday))}}
              * • Next birthday in
              {{this.nextBirthday}}
              {{if (eq this.nextBirthday 1) 'day' 'days'}}
            {{/if}}
          </div>
        </div>
      {{else}}
        <div class='age-placeholder'>No birth date set</div>
      {{/if}}
    </div>

    <style scoped>
      .age-calculator {
        padding: 0.75rem;
        background: linear-gradient(
          135deg,
          rgba(59, 130, 246, 0.1),
          rgba(147, 197, 253, 0.1)
        );
        border: 1px solid rgba(59, 130, 246, 0.2);
        border-radius: var(--radius, 0.375rem);
      }

      .age-display {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .age-value {
        font-size: 1.125rem;
        font-weight: 700;
        color: var(--primary, #3b82f6);
      }

      .age-meta {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
      }

      .age-placeholder {
        font-size: 0.875rem;
        color: var(--muted-foreground, #9ca3af);
        font-style: italic;
      }

      .age-error {
        font-size: 0.875rem;
        color: var(--destructive, #ef4444);
        font-style: italic;
      }
    </style>
  </template>
}
