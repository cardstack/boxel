import {
  CardDef,
  Component,
  field,
  contains,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { FileDef } from 'https://cardstack.com/base/file-api';
import StringField from 'https://cardstack.com/base/string';
import LayoutDashboardIcon from '@cardstack/boxel-icons/layout-dashboard';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn, get } from '@ember/helper';

// The 16 host-owned fitted envelopes. These mirror FITTED_FORMATS in
// runtime-common/formats.ts (which card modules cannot import), so the
// dimensions here are the host's pixel specs, not layout choices — keep them
// in px and keep them in sync with that list.
const FORMAT_GROUPS = [
  {
    label: 'Badges',
    formats: [
      { key: 'badge-s', name: 'Small Badge', w: 150, h: 40 },
      { key: 'badge-m', name: 'Medium Badge', w: 150, h: 65 },
      { key: 'badge-l', name: 'Large Badge', w: 150, h: 105 },
    ],
  },
  {
    label: 'Strips',
    formats: [
      { key: 'strip-1', name: 'Single Strip', w: 250, h: 40 },
      { key: 'strip-2', name: 'Double Strip', w: 250, h: 65 },
      { key: 'strip-3', name: 'Triple Strip', w: 250, h: 105 },
      { key: 'strip-wide-2', name: 'Double Wide Strip', w: 400, h: 65 },
      { key: 'strip-wide-3', name: 'Triple Wide Strip', w: 400, h: 105 },
    ],
  },
  {
    label: 'Tiles',
    formats: [
      { key: 'tile-s', name: 'Small Tile', w: 150, h: 170 },
      { key: 'tile-r', name: 'Regular Tile', w: 250, h: 170 },
      { key: 'tile-grid', name: 'CardsGrid Tile', w: 170, h: 250 },
      { key: 'tile-tall', name: 'Tall Tile', w: 150, h: 275 },
      { key: 'tile-l', name: 'Large Tile', w: 250, h: 275 },
    ],
  },
  {
    label: 'Cards',
    formats: [
      { key: 'card-c', name: 'Compact Card', w: 400, h: 170 },
      { key: 'card-f', name: 'Full Card', w: 400, h: 275 },
      { key: 'card-x', name: 'Expanded Card', w: 400, h: 445 },
    ],
  },
];

type PreviewItem = {
  index: number;
  typeKey: string;
  typeName: string;
  tier: string;
  fileName: string;
};

type TypeGroup = { key: string; name: string; items: PreviewItem[] };

const TIER_ORDER: Record<string, number> = {
  simple: 0,
  moderate: 1,
  complex: 2,
};

// Fixture files follow the `<type>-<tier>.<extension>` naming convention
// documented in SOURCES.md (the extension may have several segments, as in
// `.sample.gts` or `.data.json`); grouping and ordering are derived from the
// file name so the harness works for every fixture, including types whose
// FileDef subclass has not landed yet.
const FIXTURE_NAME_RE = /^(.+)-(simple|moderate|complex)\..+$/;

export class FileDefFormatPreview extends CardDef {
  static displayName = 'FileDef Format Preview';
  static icon = LayoutDashboardIcon;
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field previewFiles = linksToMany(() => FileDef);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: FileDefFormatPreview) {
      return this.title ?? 'FileDef Format Preview';
    },
  });

  static isolated = class Isolated extends Component<
    typeof FileDefFormatPreview
  > {
    @tracked chosenType: string | null = null;
    @tracked chosenTier = 'complex';

    get files(): Array<FileDef | undefined> {
      return this.args.model.previewFiles ?? [];
    }

    get items(): PreviewItem[] {
      let items: PreviewItem[] = [];
      // linksToMany indices are preserved so `get @fields.previewFiles index`
      // reaches the matching field component even when some links are
      // unresolved.
      this.files.forEach((file, index) => {
        if (!file || !file.name) {
          return;
        }
        let match = FIXTURE_NAME_RE.exec(file.name);
        items.push({
          index,
          typeKey: match?.[1] ?? file.name,
          typeName:
            (file.constructor as typeof FileDef)?.displayName ?? 'File',
          tier: match?.[2] ?? 'sample',
          fileName: file.name,
        });
      });
      return items;
    }

    get unresolvedCount(): number {
      return this.files.length - this.items.length;
    }

    get groups(): TypeGroup[] {
      let groups = new Map<string, PreviewItem[]>();
      for (let item of this.items) {
        let group = groups.get(item.typeKey) ?? [];
        group.push(item);
        groups.set(item.typeKey, group);
      }
      return [...groups.entries()]
        .map(([key, items]) => ({
          key,
          name: items[0]?.typeName ?? key,
          items: items.sort(
            (a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99),
          ),
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
    }

    get selectedTypeKey(): string {
      return this.chosenType ?? this.groups[0]?.key ?? '';
    }

    get selectedGroup(): TypeGroup | undefined {
      return this.groups.find((group) => group.key === this.selectedTypeKey);
    }

    get selectedItem(): PreviewItem | undefined {
      return (
        this.selectedGroup?.items.find(
          (item) => item.tier === this.chosenTier,
        ) ?? this.selectedGroup?.items[0]
      );
    }

    get selectedFieldIndex(): number {
      return this.selectedItem?.index ?? 0;
    }

    selectType = (event: Event) => {
      this.chosenType = (event.target as HTMLSelectElement).value;
      if (
        !this.selectedGroup?.items.some((item) => item.tier === this.chosenTier)
      ) {
        this.chosenTier = this.selectedGroup?.items[0]?.tier ?? 'complex';
      }
    };

    selectTier = (tier: string) => {
      this.chosenTier = tier;
    };
    isSelectedTier = (tier: string) => this.selectedItem?.tier === tier;

    <template>
      <main class='preview' data-test-filedef-format-preview>
        <header class='preview-header'>
          <div>
            <p class='eyebrow'>Format regression harness</p>
            <h1>{{@model.cardTitle}}</h1>
            <p class='lede'>
              {{this.groups.length}}
              file types ·
              {{this.items.length}}
              loaded fixtures · atom, embedded, isolated, and the canonical 16
              fitted envelopes
              {{#if this.unresolvedCount}}
                ·
                {{this.unresolvedCount}}
                unresolved{{/if}}
            </p>
          </div>
          <label class='type-picker'>
            <span>File type</span>
            <select
              value={{this.selectedTypeKey}}
              data-test-type-select
              {{on 'change' this.selectType}}
            >
              {{#each this.groups as |group|}}
                <option value={{group.key}}>{{group.key}}
                  ·
                  {{group.items.length}}</option>
              {{/each}}
            </select>
          </label>
        </header>

        {{#if this.selectedGroup}}
          <section class='sample-section' aria-labelledby='sample-heading'>
            <div class='section-heading'>
              <div>
                <p class='section-kicker'>Fixture comparison · fitted</p>
                <h2 id='sample-heading'>{{this.selectedGroup.name}}</h2>
              </div>
              <div
                class='sample-tabs'
                role='tablist'
                aria-label='Choose fixture tier'
              >
                {{#each this.selectedGroup.items as |item|}}
                  <button
                    type='button'
                    role='tab'
                    aria-selected={{this.isSelectedTier item.tier}}
                    class={{if (this.isSelectedTier item.tier) 'active'}}
                    data-test-tier-tab={{item.tier}}
                    {{on 'click' (fn this.selectTier item.tier)}}
                  >
                    {{item.tier}}
                  </button>
                {{/each}}
              </div>
            </div>

            <div class='fixture-row'>
              {{#each this.selectedGroup.items as |item|}}
                <article class='fixture'>
                  <div class='fixture-label'>
                    <strong>{{item.tier}}</strong>
                    <span>{{item.fileName}}</span>
                  </div>
                  <div class='format-frame fixture-frame'>
                    {{#let
                      (get @fields.previewFiles item.index)
                      as |FileField|
                    }}
                      {{#if FileField}}<FileField @format='fitted' />{{/if}}
                    {{/let}}
                  </div>
                </article>
              {{/each}}
            </div>
          </section>

          <section class='matrix-section' aria-labelledby='matrix-heading'>
            <div class='section-heading'>
              <div>
                <p class='section-kicker'>Fitted envelope matrix</p>
                <h2 id='matrix-heading'>{{this.selectedItem.fileName}}</h2>
              </div>
              <p class='matrix-note'>Every frame below delegates the same file
                as
                <code>fitted</code>.</p>
            </div>

            <div class='format-collage'>
              {{#each FORMAT_GROUPS as |group|}}
                <section class='format-group'>
                  <h3>{{group.label}}</h3>
                  <div class='format-list'>
                    {{#each group.formats as |fmt|}}
                      <article class='format-item'>
                        <div class='format-label'>
                          <strong>{{fmt.name}}</strong>
                          <span>{{fmt.w}} × {{fmt.h}}</span>
                        </div>
                        <div class='format-frame size-{{fmt.key}}'>
                          {{#let
                            (get @fields.previewFiles this.selectedFieldIndex)
                            as |FileField|
                          }}
                            {{#if FileField}}<FileField
                                @format='fitted'
                              />{{/if}}
                          {{/let}}
                        </div>
                      </article>
                    {{/each}}
                  </div>
                </section>
              {{/each}}
            </div>
          </section>

          <section class='other-formats' aria-labelledby='other-heading'>
            <div class='section-heading'>
              <div>
                <p class='section-kicker'>Atom · embedded · isolated</p>
                <h2 id='other-heading'>{{this.selectedItem.fileName}}</h2>
              </div>
            </div>

            {{#let
              (get @fields.previewFiles this.selectedFieldIndex)
              as |FileField|
            }}
              {{#if FileField}}
                <article class='format-panel'>
                  <h3>Atom</h3>
                  <p class='atom-line'>An inline reference to
                    <FileField @format='atom' />
                    sits inside running prose without mounting a domain
                    renderer.</p>
                </article>
                <article class='format-panel'>
                  <h3>Embedded</h3>
                  <div class='embedded-frame'>
                    <FileField @format='embedded' />
                  </div>
                </article>
                <article class='format-panel'>
                  <h3>Isolated</h3>
                  <div class='isolated-frame'>
                    <FileField @format='isolated' />
                  </div>
                </article>
              {{/if}}
            {{/let}}
          </section>
        {{else}}
          <p class='empty'>Link FileDef fixtures to begin visual regression
            review.</p>
        {{/if}}
      </main>

      <style scoped>
        .preview {
          padding: clamp(1rem, 3vw, 2.5rem);
          display: grid;
          gap: 2.5rem;
          color: var(--foreground);
        }
        .preview-header {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 2rem;
          border-bottom: 1px solid var(--border);
          padding-bottom: 1.25rem;
        }
        .eyebrow,
        .section-kicker {
          margin: 0 0 0.4rem;
          color: var(--muted-foreground);
          font-family: var(--font-mono);
          font-weight: 700;
          font-size: 0.7rem;
          line-height: 1;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        h1,
        h2,
        h3,
        p {
          margin-top: 0;
        }
        h1 {
          margin-bottom: 0.45rem;
          font-size: clamp(1.7rem, 3vw, 2.6rem);
          font-weight: 650;
          letter-spacing: -0.035em;
        }
        h2 {
          margin-bottom: 0;
          font-size: 1.35rem;
          letter-spacing: -0.02em;
        }
        h3 {
          margin: 0;
          color: var(--muted-foreground);
          font-family: var(--font-mono);
          font-weight: 700;
          font-size: 0.76rem;
          line-height: 1;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .lede,
        .matrix-note {
          margin-bottom: 0;
          color: var(--muted-foreground);
          font-size: 0.86rem;
        }
        .type-picker {
          display: grid;
          gap: 0.4rem;
          min-width: min(22rem, 45vw);
          color: var(--muted-foreground);
          font-family: var(--font-mono);
          font-weight: 700;
          font-size: 0.68rem;
          line-height: 1;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        select {
          width: 100%;
          min-height: 2.5rem;
          padding: 0 0.75rem;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--card);
          color: var(--card-foreground);
          font-weight: 600;
          font-size: 0.85rem;
          line-height: 1;
          letter-spacing: normal;
          text-transform: none;
        }
        .sample-section,
        .matrix-section,
        .other-formats {
          display: grid;
          gap: 1rem;
        }
        .section-heading {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 1rem;
        }
        .sample-tabs {
          display: flex;
          gap: 0.35rem;
        }
        .sample-tabs button {
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--card);
          color: var(--muted-foreground);
          padding: 0.48rem 0.72rem;
          font-family: var(--font-mono);
          font-weight: 700;
          font-size: 0.68rem;
          line-height: 1;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          cursor: pointer;
        }
        .sample-tabs button.active {
          background: var(--primary);
          border-color: var(--primary);
          color: var(--primary-foreground);
        }
        .fixture-row {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1rem;
        }
        .fixture {
          min-width: 0;
          display: grid;
          grid-template-rows: auto 170px;
          gap: 0.45rem;
        }
        .fixture-label {
          min-width: 0;
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 0.75rem;
          font-size: 0.75rem;
        }
        .fixture-label strong {
          font-family: var(--font-mono);
          text-transform: uppercase;
          letter-spacing: 0.07em;
        }
        .fixture-label span {
          overflow: hidden;
          color: var(--muted-foreground);
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fixture-frame {
          width: 100%;
          height: 170px;
        }
        .format-collage {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: start;
          gap: 2rem;
        }
        .format-group {
          min-width: 0;
          display: grid;
          gap: 0.85rem;
          padding-top: 0.85rem;
          border-top: 1px solid var(--border);
        }
        .format-list {
          display: flex;
          flex-wrap: wrap;
          align-items: start;
          gap: 1rem;
        }
        .format-item {
          display: grid;
          gap: 0.38rem;
        }
        .format-label {
          display: flex;
          justify-content: space-between;
          gap: 0.7rem;
          color: var(--muted-foreground);
          font-family: var(--font-mono);
          font-weight: 600;
          font-size: 0.66rem;
          line-height: 1;
        }
        .format-label strong {
          color: var(--foreground);
        }
        .format-frame {
          min-width: 0;
          min-height: 0;
          overflow: hidden;
          background: var(--card);
        }
        /* Envelope frames are the host's pixel specs (see FORMAT_GROUPS). */
        .size-badge-s {
          width: 150px;
          height: 40px;
        }
        .size-badge-m {
          width: 150px;
          height: 65px;
        }
        .size-badge-l {
          width: 150px;
          height: 105px;
        }
        .size-strip-1 {
          width: 250px;
          height: 40px;
        }
        .size-strip-2 {
          width: 250px;
          height: 65px;
        }
        .size-strip-3 {
          width: 250px;
          height: 105px;
        }
        .size-strip-wide-2 {
          width: 400px;
          height: 65px;
        }
        .size-strip-wide-3 {
          width: 400px;
          height: 105px;
        }
        .size-tile-s {
          width: 150px;
          height: 170px;
        }
        .size-tile-r {
          width: 250px;
          height: 170px;
        }
        .size-tile-grid {
          width: 170px;
          height: 250px;
        }
        .size-tile-tall {
          width: 150px;
          height: 275px;
        }
        .size-tile-l {
          width: 250px;
          height: 275px;
        }
        .size-card-c {
          width: 400px;
          height: 170px;
        }
        .size-card-f {
          width: 400px;
          height: 275px;
        }
        .size-card-x {
          width: 400px;
          height: 445px;
        }
        .format-panel {
          display: grid;
          gap: 0.6rem;
          padding-top: 0.85rem;
          border-top: 1px solid var(--border);
        }
        .atom-line {
          margin: 0;
          font-size: 0.95rem;
          line-height: 1.7;
        }
        .embedded-frame {
          max-width: 46rem;
          min-width: 0;
        }
        .isolated-frame {
          min-width: 0;
          height: 34rem;
          overflow: auto;
          border: 1px solid var(--border);
          border-radius: var(--radius);
        }
        code {
          font-family: var(--font-mono);
          color: var(--foreground);
        }
        .empty {
          padding: 4rem 1rem;
          text-align: center;
          color: var(--muted-foreground);
        }
        @media (max-width: 900px) {
          .format-collage {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 680px) {
          .preview-header,
          .section-heading {
            align-items: stretch;
            flex-direction: column;
          }
          .type-picker {
            min-width: 0;
            width: 100%;
          }
          .fixture-row {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<
    typeof FileDefFormatPreview
  > {
    <template>
      <section class='embedded'>
        <LayoutDashboardIcon />
        <span><strong>{{@model.cardTitle}}</strong>{{@model.previewFiles.length}}
          fixtures ready for format QA</span>
      </section>
      <style scoped>
        .embedded {
          padding: 0.9rem;
          display: flex;
          align-items: center;
          gap: 0.7rem;
          color: var(--foreground);
        }
        .embedded svg {
          width: 1.2rem;
        }
        .embedded span {
          display: grid;
          gap: 0.2rem;
          font-size: 0.78rem;
          color: var(--muted-foreground);
        }
        .embedded strong {
          color: var(--foreground);
          font-size: 0.9rem;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof FileDefFormatPreview> {
    <template>
      <section class='fit'>
        <LayoutDashboardIcon />
        <strong>{{@model.cardTitle}}</strong>
        <span>{{@model.previewFiles.length}} fixtures</span>
      </section>
      <style scoped>
        .fit {
          width: 100%;
          height: 100%;
          min-width: 0;
          min-height: 0;
          padding: clamp(0.4rem, 5cqmin, 1rem);
          display: grid;
          align-content: center;
          gap: 0.35rem;
          overflow: hidden;
          color: var(--foreground);
        }
        .fit svg {
          width: clamp(1rem, 12cqmin, 2.4rem);
        }
        .fit strong,
        .fit span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fit strong {
          font-size: clamp(0.7rem, 6cqmin, 1rem);
        }
        .fit span {
          color: var(--muted-foreground);
          font-family: var(--font-mono);
          font-weight: 600;
          font-size: clamp(0.58rem, 4cqmin, 0.76rem);
          line-height: 1;
        }
      </style>
    </template>
  };
}
