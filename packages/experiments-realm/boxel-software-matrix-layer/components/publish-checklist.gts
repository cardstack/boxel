import GlimmerComponent from '@glimmer/component';

// Publish Checklist — the pre-publish gate, rendered. Render-only: it
// paints the same requirements PublishListingCommand enforces (the command
// re-checks everything at write time, so this list can never grant what
// the guard refuses). Structural model type on purpose — any object with
// these facts can be checked, and the component never imports the card.

interface ChecklistModel {
  photoCount?: number | null;
  askingPrice?: { amount?: number | null } | null;
  description?: string | null;
  address?: {
    addressLine1?: string | null;
    city?: string | null;
  } | null;
  cardTitle?: string | null;
}

interface ChecklistRow {
  label: string;
  state: 'pass' | 'fail' | 'warn';
  hint?: string;
}

interface Signature {
  Args: {
    model: ChecklistModel | undefined;
  };
  Element: HTMLElement;
}

const GLYPH: Record<ChecklistRow['state'], string> = {
  pass: '✓',
  fail: '✗',
  warn: '!',
};

export class PublishChecklist extends GlimmerComponent<Signature> {
  get rows(): ChecklistRow[] {
    let m = this.args.model;
    let photoCount = m?.photoCount ?? 0;
    let descriptionLength = (m?.description ?? '').trim().length;
    let rows: ChecklistRow[] = [];

    rows.push(
      photoCount >= 10
        ? { label: `${photoCount} photos uploaded`, state: 'pass' }
        : photoCount >= 1
          ? {
              label: `${photoCount} photo${photoCount === 1 ? '' : 's'} uploaded`,
              state: 'warn',
              hint: '10+ recommended',
            }
          : {
              label: 'No photos yet',
              state: 'fail',
              hint: 'at least 1 required, 10 recommended',
            },
    );
    rows.push(
      m?.askingPrice?.amount != null
        ? { label: 'Price set', state: 'pass' }
        : { label: 'Price not set', state: 'fail' },
    );
    rows.push(
      descriptionLength >= 100
        ? { label: 'Description written', state: 'pass' }
        : {
            label: descriptionLength
              ? `Description is short (${descriptionLength} chars)`
              : 'No description',
            state: 'warn',
            hint: 'min 100 chars recommended',
          },
    );
    rows.push(
      m?.address?.addressLine1?.trim() && m?.address?.city?.trim()
        ? { label: 'Address complete', state: 'pass' }
        : { label: 'Address incomplete', state: 'fail' },
    );
    return rows;
  }

  /** True when nothing is a hard fail — warns don't block. */
  get ready(): boolean {
    return this.rows.every((row) => row.state !== 'fail');
  }

  glyphOf = (state: ChecklistRow['state']) => GLYPH[state];

  <template>
    <ul class='checklist' ...attributes>
      {{#each this.rows as |row|}}
        <li class='row {{row.state}}'>
          <span class='glyph' aria-hidden='true'>{{this.glyphOf
              row.state
            }}</span>
          <span class='label'>{{row.label}}</span>
          {{#if row.hint}}
            <span class='hint'>{{row.hint}}</span>
          {{/if}}
        </li>
      {{/each}}
    </ul>
    <style scoped>
      .checklist {
        --ck-pass: var(--ck-pass-color, var(--boxel-dark-green));
        --ck-fail: var(--ck-fail-color, var(--boxel-danger));
        --ck-warn: var(--ck-warn-color, var(--boxel-warning));
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: var(--boxel-sp-5xs);
        font-size: 0.8125rem;
      }
      .row {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
      }
      .glyph {
        flex: 0 0 auto;
        width: 1.25rem;
        height: 1.25rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        font-size: 0.6875rem;
        font-weight: 700;
        line-height: 1;
      }
      .row.pass .glyph {
        color: var(--ck-pass);
        background: color-mix(in oklab, var(--ck-pass) 14%, transparent);
      }
      .row.fail .glyph {
        color: var(--ck-fail);
        background: color-mix(in oklab, var(--ck-fail) 14%, transparent);
      }
      .row.warn .glyph {
        color: var(--ck-warn);
        background: color-mix(in oklab, var(--ck-warn) 18%, transparent);
      }
      .row.fail .label {
        color: var(--ck-fail);
      }
      .label {
        color: var(--foreground, var(--boxel-dark));
      }
      .hint {
        font-size: 0.75rem;
        font-style: italic;
        color: var(--muted-foreground, var(--boxel-450));
      }
    </style>
  </template>
}

export default PublishChecklist;
