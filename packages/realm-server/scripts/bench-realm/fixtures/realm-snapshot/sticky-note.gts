import {
  CardDef,
  field,
  contains,
  Component,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import MarkdownField from '@cardstack/base/markdown';
import DatetimeField from '@cardstack/base/datetime';
import StickyNoteIcon from '@cardstack/boxel-icons/sticky-note';

type StickyColor = 'yellow' | 'pink' | 'blue' | 'green' | 'orange' | 'purple';

const COLOR_PALETTE: Record<
  StickyColor,
  { background: string; accent: string }
> = {
  yellow: { background: '#fff6a8', accent: '#e6d268' },
  pink: { background: '#fdc4d6', accent: '#e893ad' },
  blue: { background: '#bde0fe', accent: '#7eb8ed' },
  green: { background: '#c9f5d0', accent: '#7fc991' },
  orange: { background: '#ffd6a5', accent: '#eaa760' },
  purple: { background: '#e1c8f5', accent: '#b48be0' },
};

const VALID_COLORS: StickyColor[] = [
  'yellow',
  'pink',
  'blue',
  'green',
  'orange',
  'purple',
];

function normalizeColor(value: string | null | undefined): StickyColor {
  if (!value) {
    return 'yellow';
  }
  const candidate = value.toLowerCase().trim();
  return (VALID_COLORS as string[]).includes(candidate)
    ? (candidate as StickyColor)
    : 'yellow';
}

function paletteFor(value: string | null | undefined) {
  return COLOR_PALETTE[normalizeColor(value)];
}

function snippet(text: string | null | undefined, max: number): string {
  if (!text) {
    return '';
  }
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return trimmed.slice(0, Math.max(0, max - 1)) + '…';
}

export class StickyNote extends CardDef {
  static displayName = 'Sticky Note';
  static icon = StickyNoteIcon;

  @field title = contains(StringField);
  @field body = contains(MarkdownField);
  @field color = contains(StringField);
  @field x = contains(NumberField);
  @field y = contains(NumberField);
  @field rotation = contains(NumberField);
  @field author = contains(StringField);
  @field createdAt = contains(DatetimeField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: StickyNote): string {
      try {
        const userName = this.cardInfo?.name?.trim();
        if (userName && userName.length) {
          return userName;
        }
        const t = this.title?.trim();
        if (t && t.length) {
          return t;
        }
        const b = this.body?.trim();
        if (b && b.length) {
          return snippet(b, 40);
        }
        return 'Untitled Sticky Note';
      } catch (e) {
        console.error('StickyNote: error computing cardTitle', e);
        return 'Untitled Sticky Note';
      }
    },
  });

  static isolated = class Isolated extends Component<typeof StickyNote> {
    get colorName(): StickyColor {
      return normalizeColor(this.args.model?.color);
    }

    get palette() {
      return paletteFor(this.args.model?.color);
    }

    get backgroundStyle(): string {
      return `--sticky-bg: ${this.palette.background}; --sticky-accent: ${this.palette.accent};`;
    }

    get displayTitle(): string {
      const t = this.args.model?.title?.trim();
      return t && t.length ? t : '';
    }

    get displayBody(): string {
      return this.args.model?.body?.trim() ?? '';
    }

    get displayAuthor(): string {
      return this.args.model?.author?.trim() ?? '';
    }

    <template>
      <article
        class='sticky sticky--isolated'
        style={{this.backgroundStyle}}
        data-test-sticky-note
        data-test-color={{this.colorName}}
      >
        {{#if this.displayTitle}}
          <h1 class='sticky-title' data-test-title>{{this.displayTitle}}</h1>
        {{/if}}

        <div class='sticky-body' data-test-body>
          {{this.displayBody}}
        </div>

        <footer class='sticky-footer'>
          {{#if this.displayAuthor}}
            <span class='sticky-author' data-test-author>—
              {{this.displayAuthor}}</span>
          {{/if}}
        </footer>
      </article>

      <style scoped>
        .sticky--isolated {
          width: 360px;
          max-width: 360px;
          min-height: 360px;
          padding: 1.5rem;
          background-color: var(--sticky-bg, #fff6a8);
          color: #222;
          font-family: -apple-system, 'Segoe UI', sans-serif;
          box-shadow:
            0 6px 12px rgba(0, 0, 0, 0.12),
            0 2px 4px rgba(0, 0, 0, 0.08);
          transform: rotate(-1deg);
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin: 1rem auto;
          border-radius: 2px;
        }
        .sticky-title {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 700;
          line-height: 1.2;
          color: #222;
        }
        .sticky-body {
          flex: 1;
          font-size: 18px;
          line-height: 1.4;
          white-space: pre-wrap;
          color: #222;
        }
        .sticky-footer {
          border-top: 1px solid var(--sticky-accent, #e6d268);
          padding-top: 0.5rem;
          font-size: 0.875rem;
          color: #444;
          font-style: italic;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof StickyNote> {
    get colorName(): StickyColor {
      return normalizeColor(this.args.model?.color);
    }

    get palette() {
      return paletteFor(this.args.model?.color);
    }

    get backgroundStyle(): string {
      return `--sticky-bg: ${this.palette.background}; --sticky-accent: ${this.palette.accent};`;
    }

    get displayTitle(): string {
      const t = this.args.model?.title?.trim();
      return t && t.length ? t : '';
    }

    get displayBody(): string {
      return snippet(this.args.model?.body, 80);
    }

    <template>
      <article
        class='sticky sticky--embedded'
        style={{this.backgroundStyle}}
        data-test-sticky-note
        data-test-color={{this.colorName}}
      >
        {{#if this.displayTitle}}
          <h2 class='sticky-title' data-test-title>{{this.displayTitle}}</h2>
        {{/if}}
        <p class='sticky-body' data-test-body>{{this.displayBody}}</p>
      </article>

      <style scoped>
        .sticky--embedded {
          width: 200px;
          height: 200px;
          padding: 0.75rem;
          background-color: var(--sticky-bg, #fff6a8);
          color: #222;
          font-family: -apple-system, 'Segoe UI', sans-serif;
          box-shadow:
            0 4px 8px rgba(0, 0, 0, 0.1),
            0 1px 2px rgba(0, 0, 0, 0.06);
          transform: rotate(-1deg);
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
          border-radius: 2px;
          overflow: hidden;
        }
        .sticky-title {
          margin: 0;
          font-size: 1rem;
          font-weight: 700;
          line-height: 1.2;
          color: #222;
        }
        .sticky-body {
          margin: 0;
          font-size: 0.875rem;
          line-height: 1.3;
          color: #222;
          flex: 1;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 5;
          -webkit-box-orient: vertical;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof StickyNote> {
    get colorName(): StickyColor {
      return normalizeColor(this.args.model?.color);
    }

    get palette() {
      return paletteFor(this.args.model?.color);
    }

    get backgroundStyle(): string {
      return `--sticky-bg: ${this.palette.background}; --sticky-accent: ${this.palette.accent};`;
    }

    get displayTitle(): string {
      const t = this.args.model?.title?.trim();
      return t && t.length ? t : '';
    }

    get displayBody(): string {
      return this.args.model?.body?.trim() ?? '';
    }

    <template>
      <article
        class='sticky sticky--fitted'
        style={{this.backgroundStyle}}
        data-test-sticky-note
        data-test-color={{this.colorName}}
      >
        {{#if this.displayTitle}}
          <h3 class='sticky-title' data-test-title>{{this.displayTitle}}</h3>
        {{/if}}
        <p class='sticky-body' data-test-body>{{this.displayBody}}</p>
      </article>

      <style scoped>
        .sticky--fitted {
          width: 100%;
          height: 100%;
          padding: 0.75rem;
          background-color: var(--sticky-bg, #fff6a8);
          color: #222;
          font-family: -apple-system, 'Segoe UI', sans-serif;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
          overflow: hidden;
          box-shadow: inset 0 0 0 1px var(--sticky-accent, #e6d268);
        }
        .sticky-title {
          margin: 0;
          font-size: 0.95rem;
          font-weight: 700;
          line-height: 1.2;
          color: #222;
        }
        .sticky-body {
          margin: 0;
          font-size: 14px;
          line-height: 1.3;
          color: #222;
          flex: 1;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
        }
      </style>
    </template>
  };
}
