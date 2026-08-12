// Isolated: the full work surface for a file. The hero is the family's own
// renderer at the source's aspect ratio; beside it, a property area that groups
// what the realm knows, what the parser extracted, and what was computed from
// that. Every displayed fact is a real field, so the default editor stays the
// correction surface and this view never becomes the only place a value exists.
import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';

import { copyCardURLToClipboard, eq, gt } from '@cardstack/boxel-ui/helpers';
// Provenance markers come from the boxel-ui icon barrel, a single module every
// card already depends on: `Folder` for a fact the realm supplied, `IconSearch`
// for one a parser read out of the bytes, `IconInherit` for one derived from
// those, and `IconCircle` for one that is absent.
import {
  Folder,
  IconCircle,
  IconInherit,
  IconSearch,
} from '@cardstack/boxel-ui/icons';

import { isSampledContentHash } from '@cardstack/runtime-common';

import {
  boundedVideoFrameAspectRatio,
  fileIconFor,
  humanSize,
  shortDate,
} from './file-presentation';
import {
  FilePreviewStage,
  type FilePreviewComponent,
} from './file-preview-stage';
import type { FileViewModel } from './file-view-model';

interface InspectorRow {
  label: string;
  value: string;
  mono?: boolean;
}

interface FileIsolatedShellSignature {
  Args: {
    model: FileViewModel;
    fields?: Record<string, any>;
    preview?: FilePreviewComponent;
  };
  Element: HTMLElement;
}

const COPY_FEEDBACK_MS = 2000;

export class FileIsolatedShell extends GlimmerComponent<FileIsolatedShellSignature> {
  // Successful clipboard feedback belongs to the control that was pressed.
  @tracked copied = false;
  copyFeedbackTimer?: ReturnType<typeof setTimeout>;

  get icon() {
    return fileIconFor(this.args.model);
  }

  get downloadName() {
    return this.args.model?.name || undefined;
  }

  // Keep the clipboard write inside the browser gesture that asked for it.
  copyLink = async () => {
    let fileLink = this.args.model?.url;
    if (!fileLink) {
      return;
    }
    await copyCardURLToClipboard(fileLink);
    if (this.copyFeedbackTimer) {
      clearTimeout(this.copyFeedbackTimer);
    }
    this.copied = true;
    this.copyFeedbackTimer = setTimeout(() => {
      this.copied = false;
    }, COPY_FEEDBACK_MS);
  };

  willDestroy() {
    super.willDestroy();
    if (this.copyFeedbackTimer) {
      clearTimeout(this.copyFeedbackTimer);
    }
  }

  get size() {
    return humanSize(this.args.model?.contentSize);
  }

  get created() {
    return shortDate(this.args.model?.createdAt);
  }

  get modified() {
    return shortDate(this.args.model?.lastModified);
  }

  get srcTag() {
    return (this.args.model?.previewSource ?? '').toUpperCase();
  }

  get rail() {
    let n = Math.min(this.args.model?.railCount ?? 0, 6);
    return Array.from({ length: n }, (_, i) => i + 1);
  }

  // Every parser-mirror field that has a value, for every family — no authored
  // per-family row list required.
  get parsedRows(): InspectorRow[] {
    let m = this.args.model;
    if (!m) {
      return [];
    }
    let rows: InspectorRow[] = [];
    let push = (label: string, value: unknown, mono = false) => {
      if (value !== undefined && value !== null && value !== '') {
        rows.push({ label, value: String(value), mono });
      }
    };
    push('Name', m.name, true);
    push('Content type', m.contentType, true);
    if (m.contentSize != null) {
      push(
        'Size',
        `${humanSize(m.contentSize)} · ${m.contentSize.toLocaleString()} bytes`,
      );
    }
    // A whole-content fingerprint is a plain md5, so it is worth naming as
    // one — it matches what `md5sum` reports. A sampled fingerprint covers
    // only the file's head and tail, so calling it an md5 would invite a
    // comparison that can never match.
    if (m.contentHash) {
      push(
        isSampledContentHash(m.contentHash) ? 'Checksum (sampled)' : 'MD5',
        m.contentHash,
        true,
      );
    }
    if (m.width && m.height) {
      push('Dimensions', `${m.width} × ${m.height} px`);
    }
    if (m.rowCount != null) {
      push('Rows', m.rowCount.toLocaleString());
    }
    if (m.columnCount != null) {
      push('Columns', `${m.columnCount} · ${m.columns.join(', ')}`);
    }
    push('Language', m.language);
    if (m.lineCount != null) {
      push('Lines', m.lineCount.toLocaleString());
    }
    if (m.exportCount != null) {
      push('Exports', m.exportCount.toLocaleString());
    }
    if (m.imports.length) {
      push('Imports', m.imports.join(' · '), true);
    }
    if (m.exportedModules.length) {
      push('Modules', m.exportedModules.join(' · '), true);
    }
    if (m.exportedFunctions.length) {
      push('Functions', m.exportedFunctions.join(' · '), true);
    }
    if (m.hasDefaultExport) {
      push('Default export', 'Yes');
    }
    push('Title', m.title);
    push('URL', m.url, true);
    // The displayed renditions are real linked FileDefs, so they are
    // inspectable rather than opaque pixels.
    push('Poster file', m.posterUrl, true);
    push('Thumbnail file', m.thumbnailUrl, true);
    return rows;
  }

  // A GTS module may export utilities only, so an empty schema is a real
  // answer rather than a missing one.
  get isSchemaSource() {
    return this.args.model?.previewKind === 'schema';
  }

  get schemaRows() {
    return this.args.model?.schemaRows ?? [];
  }

  // A `contains` FieldDef is always an instance, so presence has to mean "has
  // at least one meaningful value" rather than "is not null" — and the value
  // list must cover every field the pane's templates can render, or a thinly
  // tagged photo hides rows the pane would have shown.
  get hasExif() {
    let capture = this.args.model?.exif?.capture;
    let location = this.args.model?.exif?.location;
    return Boolean(
      capture?.cameraName ||
      capture?.lensModel ||
      capture?.focalLength?.display ||
      capture?.aperture?.display ||
      capture?.exposureTime?.display ||
      capture?.iso ||
      capture?.flash?.label ||
      capture?.orientation?.label ||
      capture?.capturedAt ||
      capture?.software ||
      location?.coordinates ||
      location?.altitude?.display ||
      location?.place ||
      location?.source?.label,
    );
  }

  get hasColorProfile() {
    let c = this.args.model?.colorProfile;
    return Boolean(
      c?.colorSpace?.code ||
      c?.bitDepth ||
      c?.channels ||
      c?.iccProfile ||
      c?.hasAlpha != null,
    );
  }

  get hasEncoding() {
    let e = this.args.model?.encoding;
    return Boolean(
      e?.container ||
      e?.videoCodec ||
      e?.audioCodec ||
      e?.sampleRate?.value ||
      e?.frames,
    );
  }

  get hasWaveform() {
    let w = this.args.model?.waveform;
    return Boolean(w?.decodeStatus || w?.barsJson || w?.decodeError);
  }

  get hasPosterMetadata() {
    let poster = this.args.model?.posterMetadata;
    return Boolean(poster?.status || poster?.frameSeconds || poster?.error);
  }

  get hasThumbnailMetadata() {
    let thumbnail = this.args.model?.thumbnailMetadata;
    return Boolean(
      thumbnail?.status || thumbnail?.generator || thumbnail?.error,
    );
  }

  get hasTags() {
    let t = this.args.model?.mediaTags;
    return Boolean(t?.trackTitle || t?.artist);
  }

  get hasDocInfo() {
    let d = this.args.model?.documentInfo;
    return Boolean(d?.author || d?.pageCount);
  }

  get hasModel3d() {
    let m = this.args.model?.model3d;
    return Boolean(m?.meshes || m?.triangles);
  }

  get hasFontMetadata() {
    let m = this.args.model?.fontMetadata;
    return Boolean(
      m?.familyName || m?.fullName || m?.postscriptName || m?.vendorId,
    );
  }

  get hasHtmlMetadata() {
    let m = this.args.model?.htmlMetadata;
    return Boolean(
      m?.documentTitle || m?.elementCount != null || m?.scriptCount != null,
    );
  }

  get hasArchiveContents() {
    return (this.args.model?.archiveEntryCount ?? 0) > 0;
  }

  // Values computed from parser output rather than read from it.
  get derivedRows(): InspectorRow[] {
    let m = this.args.model;
    if (!m) {
      return [];
    }
    let rows: InspectorRow[] = [];
    if (m.extension) {
      rows.push({
        label: 'Extension',
        value: `.${m.extension.toLowerCase()}`,
        mono: true,
      });
    }
    if (m.previewKind) {
      rows.push({ label: 'Preview kind', value: m.previewKind, mono: true });
    }
    if (m.aspectRatio != null && m.aspectLabel) {
      rows.push({
        label: 'Aspect ratio',
        value: `${m.aspectLabel} · ${m.aspectRatio}`,
      });
    }
    return rows;
  }

  // The source's aspect ratio shapes the hero, bounded so it can't become an
  // unusably short or tall band.
  get previewFrameStyle() {
    if (this.args.model?.previewKind !== 'video') {
      return undefined;
    }
    return htmlSafe(
      `aspect-ratio: ${boundedVideoFrameAspectRatio(this.args.model?.aspectRatio)}`,
    );
  }

  <template>
    <article
      class='iso'
      data-preview-kind={{@model.previewKind}}
      data-test-file-isolated
    >
      <header class='iso-bar'>
        <this.icon class='iso-icon' width='19' height='19' aria-hidden='true' />
        <h1 class='iso-name'>{{@model.baseName}}</h1>
        {{#if @model.extension}}
          <span class='ext-pill'>.{{@model.extension}}</span>
        {{/if}}
        {{#if @model.title}}
          <span class='iso-title'>
            <IconSearch width='10' height='10' aria-hidden='true' />
            “{{@model.title}}”
          </span>
        {{/if}}
        <span class='iso-actions'>
          {{#if @model.url}}
            <a
              class='act primary'
              href={{@model.url}}
              download={{this.downloadName}}
              data-test-file-download
            >Download</a>
            {{! The pressed control announces its own success without extra
            wrapper DOM. }}
            <button
              type='button'
              class='act'
              aria-live='polite'
              data-test-file-copy-link
              {{on 'click' this.copyLink}}
            >{{if this.copied 'Copied' 'Copy link'}}</button>
          {{/if}}
        </span>
      </header>

      <div class='iso-cols'>
        <section class='iso-stage-region' aria-label='Preview'>
          <div class='iso-stage' style={{this.previewFrameStyle}}>
            <FilePreviewStage
              @model={{@model}}
              @mode='isolated'
              @fields={{@fields}}
              @preview={{@preview}}
            />
          </div>
          {{#if this.srcTag}}
            <div class='prov-row'>
              <span class='prov-tag'>{{this.srcTag}}</span>
              <span class='prov-note'>
                {{#if (eq @model.previewSource 'native')}}The browser displays
                  the source directly.{{/if}}
                {{#if (eq @model.previewSource 'extracted')}}Structured
                  information derived from the source.{{/if}}
                {{#if (eq @model.previewSource 'generated')}}Rendered by Boxel
                  and captured as an artifact.{{/if}}
                {{#if (eq @model.previewSource 'fallback')}}No reader for this
                  format yet.{{/if}}
              </span>
            </div>
          {{/if}}
          {{#if this.rail.length}}
            <div class='rail' aria-label='Preview pages'>
              {{#each this.rail as |page|}}
                <div class='rail-item'>
                  <div class='rail-page'>
                    <div class='bar ink w70'></div>
                    <div class='bar w96'></div>
                    <div class='bar w90'></div>
                  </div>
                  <span class='rail-label'>p.{{page}}</span>
                </div>
              {{/each}}
            </div>
          {{/if}}
        </section>

        <section class='inspector' aria-label='File details'>
          {{#if @model.realmPath}}
            <div class='insp-path'>{{@model.realmPath}}</div>
          {{/if}}

          <h2 class='insp-group'>General</h2>
          <dl class='insp-rows'>
            <div class='insp-row'>
              <dt>Kind</dt>
              <dd>{{@model.kind}}</dd>
              <span class='mark' title='Realm-provided'><Folder
                  width='11'
                  height='11'
                  aria-hidden='true'
                /></span>
            </div>
            {{#if this.size}}
              <div class='insp-row'>
                <dt>Size</dt>
                <dd>{{this.size}}</dd>
                <span class='mark' title='Realm-provided'><Folder
                    width='11'
                    height='11'
                    aria-hidden='true'
                  /></span>
              </div>
            {{/if}}
            {{#if this.created}}
              <div class='insp-row'>
                <dt>Created</dt>
                <dd>{{this.created}}</dd>
                <span class='mark' title='Realm-provided'><Folder
                    width='11'
                    height='11'
                    aria-hidden='true'
                  /></span>
              </div>
            {{/if}}
            {{#if this.modified}}
              <div class='insp-row'>
                <dt>Modified</dt>
                <dd>{{this.modified}}</dd>
                <span class='mark' title='Realm-provided'><Folder
                    width='11'
                    height='11'
                    aria-hidden='true'
                  /></span>
              </div>
            {{/if}}
          </dl>

          {{#if (gt this.parsedRows.length 0)}}
            <h2 class='insp-group'>Parser output</h2>
            <dl class='insp-rows'>
              {{#each this.parsedRows as |row|}}
                <div class='insp-row'>
                  <dt>{{row.label}}</dt>
                  <dd
                    class='{{if row.mono "mono"}}'
                    title={{row.value}}
                  >{{row.value}}</dd>
                  <span class='mark' title='Parsed from the file'><IconSearch
                      width='11'
                      height='11'
                      aria-hidden='true'
                    /></span>
                </div>
              {{/each}}
            </dl>
          {{/if}}

          {{#if this.isSchemaSource}}
            <h2 class='insp-group'>Extracted schema</h2>
            {{#if (gt this.schemaRows.length 0)}}
              <div
                class='schema-table'
                role='table'
                aria-label='Extracted card fields'
              >
                {{#each this.schemaRows as |row|}}
                  <div class='schema-table-row' role='row'>
                    <strong role='cell'>{{row.fieldName}}</strong>
                    <span role='cell'>{{row.relationship}}</span>
                    <code role='cell'>{{row.fieldType}}</code>
                  </div>
                {{/each}}
              </div>
            {{else}}
              <div class='schema-empty'>No
                <code>@field</code>
                schema detected. This module may export utilities or components
                only.</div>
            {{/if}}
          {{/if}}

          {{#if (gt this.derivedRows.length 0)}}
            <h2 class='insp-group'>Derived</h2>
            <dl class='insp-rows'>
              {{#each this.derivedRows as |row|}}
                <div class='insp-row'>
                  <dt>{{row.label}}</dt>
                  <dd class='{{if row.mono "mono"}}'>{{row.value}}</dd>
                  <span
                    class='mark'
                    title='Computed from parser output'
                  ><IconInherit
                      width='13'
                      height='13'
                      aria-hidden='true'
                    /></span>
                </div>
              {{/each}}
            </dl>
          {{/if}}

          {{! Family metadata renders through its own declared FieldDef, so the
          same component serves this inspector and the default editor. }}
          {{#if this.hasExif}}
            <h2 class='insp-group'>EXIF metadata</h2>
            <div class='insp-family'><@fields.exif /></div>
          {{/if}}
          {{#if this.hasColorProfile}}
            <h2 class='insp-group'>Color profile</h2>
            <div class='insp-family'><@fields.colorProfile /></div>
          {{/if}}
          {{#if this.hasEncoding}}
            <h2 class='insp-group'>Encoding</h2>
            <div class='insp-family'><@fields.encoding /></div>
          {{/if}}
          {{#if this.hasPosterMetadata}}
            <h2 class='insp-group'>Poster rendition</h2>
            <div class='insp-family'><@fields.posterMetadata /></div>
          {{/if}}
          {{#if this.hasThumbnailMetadata}}
            <h2 class='insp-group'>Fitted thumbnail</h2>
            <div class='insp-family'><@fields.thumbnailMetadata /></div>
          {{/if}}
          {{#if this.hasWaveform}}
            <h2 class='insp-group'>Waveform analysis</h2>
            <div class='insp-family'><@fields.waveform /></div>
          {{/if}}
          {{#if this.hasTags}}
            <h2 class='insp-group'>Tags</h2>
            <div class='insp-family'><@fields.mediaTags /></div>
          {{/if}}
          {{#if this.hasDocInfo}}
            <h2 class='insp-group'>Document</h2>
            <div class='insp-family'><@fields.documentInfo /></div>
          {{/if}}
          {{#if this.hasArchiveContents}}
            <h2 class='insp-group'>Archive contents</h2>
            <div class='insp-family insp-archive'><@fields.archiveContents
              /></div>
          {{/if}}
          {{#if this.hasModel3d}}
            <h2 class='insp-group'>3D model</h2>
            <div class='insp-family'><@fields.model3d /></div>
          {{/if}}
          {{#if this.hasFontMetadata}}
            <h2 class='insp-group'>Font metadata</h2>
            <div class='insp-family'><@fields.fontMetadata /></div>
          {{/if}}
          {{#if this.hasHtmlMetadata}}
            <h2 class='insp-group'>HTML document</h2>
            <div class='insp-family'><@fields.htmlMetadata /></div>
          {{/if}}

          <div class='legend'>
            <span class='legend-item'><IconSearch
                width='10'
                height='10'
                aria-hidden='true'
              />
              extracted</span>
            <span class='legend-item'><Folder
                width='10'
                height='10'
                aria-hidden='true'
              />
              realm</span>
            <span class='legend-item'><IconInherit
                width='12'
                height='12'
                aria-hidden='true'
              />
              computed</span>
            <span class='legend-item'><IconCircle
                width='10'
                height='10'
                aria-hidden='true'
              />
              missing</span>
          </div>
        </section>
      </div>
    </article>

    <style scoped>
      .iso {
        padding: var(--boxel-sp-lg, 1.25rem);
        font-family: var(--font-sans);
        color: var(--foreground);
        display: flex;
        flex-direction: column;
        gap: 16px;
        container-type: inline-size;
      }
      .iso-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        flex-wrap: wrap;
      }
      .iso-icon {
        flex-shrink: 0;
      }
      .iso-name {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 600;
        letter-spacing: -0.01em;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ext-pill {
        flex-shrink: 0;
        font-family: var(--font-mono);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.03em;
        color: var(--fd-paper, var(--card, #f7f7f5));
        background: var(--fd-slate, var(--foreground));
        padding: 3px 8px;
        border-radius: 4px;
      }
      .iso-title {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.8125rem;
        font-style: italic;
        color: var(--muted-foreground);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .iso-actions {
        margin-left: auto;
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }
      .act {
        font-family: var(--font-sans);
        font-size: 0.71875rem;
        font-weight: 600;
        color: var(--foreground);
        background: transparent;
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 5px 12px;
        cursor: pointer;
        text-decoration: none;
        line-height: 1.4;
      }
      .act.primary {
        background: var(--fd-slate, var(--foreground));
        border-color: var(--fd-slate, var(--foreground));
        color: var(--fd-paper, var(--card, #f7f7f5));
      }
      .iso-cols {
        display: grid;
        grid-template-columns: minmax(0, 1.5fr) minmax(280px, 1fr);
        gap: 20px;
        align-items: start;
      }
      /* HTML and long-form text own a full-width document stage; a document is
         read top to bottom, so its metadata follows below in reading order
         rather than competing for width beside it. */
      .iso[data-preview-kind='html'] .iso-cols,
      .iso[data-preview-kind='markdown'] .iso-cols,
      .iso[data-preview-kind='doc'] .iso-cols {
        grid-template-columns: minmax(0, 1fr);
        gap: 24px;
      }
      .iso[data-preview-kind='html'] .inspector,
      .iso[data-preview-kind='markdown'] .inspector,
      .iso[data-preview-kind='doc'] .inspector {
        width: 100%;
      }
      @container (max-width: 760px) {
        .iso-cols {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .iso-stage-region {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
      }
      .iso-stage {
        position: relative;
        height: 380px;
        border: 1px solid var(--border);
        border-radius: var(--radius, 8px);
        overflow: hidden;
      }
      /* A real mockup or report needs a browser-sized viewport. */
      .iso[data-preview-kind='html'] .iso-stage {
        height: clamp(560px, 72vh, 920px);
        background: var(--card);
      }
      /* A prose document grows to its own length rather than scrolling inside a
         fixed hero: the whole point of the isolated view is to read it. It keeps
         a floor so a one-line file still presents as a page. */
      .iso[data-preview-kind='markdown'] .iso-stage,
      .iso[data-preview-kind='doc'] .iso-stage {
        height: auto;
        min-height: 240px;
        overflow: visible;
        background: var(--card);
      }
      /* Exact aspect ratio within useful limits; matte beyond them. */
      .iso[data-preview-kind='video'] .iso-stage {
        height: auto;
        min-height: 320px;
        max-height: 680px;
        background: var(--fd-slate, var(--foreground));
      }
      .prov-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
      }
      .prov-tag {
        flex-shrink: 0;
        font-family: var(--font-mono);
        font-size: 0.5rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        border: 1px solid var(--border);
        padding: 2px 6px;
        border-radius: 3px;
        color: var(--muted-foreground);
        text-transform: uppercase;
      }
      .prov-note {
        font-size: 0.6875rem;
        color: var(--muted-foreground);
      }
      .rail {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .rail-item {
        position: relative;
        text-align: center;
      }
      .rail-page {
        width: 58px;
        height: 76px;
        border-radius: 5px;
        background: var(--card, #fff);
        border: 1px solid var(--border);
        padding: 10px 8px;
        overflow: hidden;
      }
      .rail-label {
        display: block;
        margin-top: 4px;
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        color: var(--muted-foreground);
      }
      .bar {
        height: 3px;
        background: var(--fd-stage, var(--muted, #eceef1));
        border-radius: 1px;
        margin-bottom: 4px;
      }
      .bar.ink {
        height: 5px;
        background: var(--foreground);
        opacity: 0.78;
      }
      .w70 {
        width: 70%;
      }
      .w90 {
        width: 90%;
      }
      .w96 {
        width: 96%;
      }
      .inspector {
        border: 1px solid var(--border);
        border-radius: var(--radius, 8px);
        background: var(--card, #fff);
        padding: 14px 16px;
        min-width: 0;
      }
      .insp-path {
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        color: var(--muted-foreground);
        padding-bottom: 10px;
        border-bottom: 1px solid var(--border);
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .insp-group {
        margin: 14px 0 4px;
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .insp-family {
        padding: 2px 0 4px;
      }
      .schema-table {
        display: flex;
        flex-direction: column;
        padding: 2px 0 4px;
      }
      .schema-table-row {
        display: grid;
        grid-template-columns:
          minmax(84px, 1fr) minmax(72px, auto)
          minmax(84px, 1fr);
        gap: 9px;
        align-items: baseline;
        padding: 5px 0;
        border-top: 1px solid var(--border);
        font: 0.65625rem var(--font-mono);
      }
      .schema-table-row:first-child {
        border-top: 0;
      }
      .schema-table-row strong,
      .schema-table-row code {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .schema-table-row span {
        color: var(--muted-foreground);
      }
      .schema-table-row code {
        color: var(--primary, var(--foreground));
      }
      .schema-empty {
        padding: 8px 10px;
        border: 1px dashed var(--border);
        border-radius: 6px;
        color: var(--muted-foreground);
        font-size: 0.6875rem;
        line-height: 1.45;
      }
      .insp-archive {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .insp-rows {
        margin: 0;
        display: flex;
        flex-direction: column;
      }
      .insp-row {
        display: grid;
        grid-template-columns: 92px minmax(0, 1fr) auto;
        gap: 10px;
        align-items: baseline;
        padding: 5px 0;
        border-top: 1px solid var(--border);
      }
      .insp-row:first-child {
        border-top: 0;
      }
      .insp-row dt {
        font-family: var(--font-mono);
        font-size: 0.59375rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .insp-row dd {
        margin: 0;
        font-size: 0.75rem;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .insp-row dd.mono {
        font-family: var(--font-mono);
        font-size: 0.65625rem;
      }
      .mark {
        display: inline-grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border-radius: 5px;
        border: 1px solid var(--border);
        color: var(--muted-foreground);
        /* Some barrel glyphs paint from `--icon-color` rather than
           `currentColor`, so hand them the inherited color explicitly. */
        --icon-color: currentColor;
      }
      .legend {
        margin-top: 16px;
        padding-top: 10px;
        border-top: 1px solid var(--border);
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-family: var(--font-mono);
        font-size: 0.5rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--muted-foreground);
        --icon-color: currentColor;
      }
    </style>
  </template>
}
