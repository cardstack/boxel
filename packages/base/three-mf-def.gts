import GlimmerComponent from '@glimmer/component';
import PrinterIcon from '@cardstack/boxel-icons/printer';
import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import { DEFAULT_FILE_SIZE_LIMIT_BYTES } from '@cardstack/runtime-common/constants';
import {
  BaseDefComponent,
  Component,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
} from './card-api';
import NumberField from './number';
import TextAreaField from './text-area';
import {
  FileContentMismatchError,
  type ByteStream,
  type SerializedFile,
} from './file-api';
import {
  ThreeDModelDef,
  ModelIsolatedBody,
  ModelInspectorSection,
  getExtension,
  type ModelInspectorRow,
} from './three-d-model-def';
import { parseThreeMf, type ThreeMfMetadata } from './three-mf-meta-extractor';

export class ThreeMfPrintPartField extends FieldDef {
  static displayName = '3MF Print Part';
  @field name = contains(StringField);
  @field extruder = contains(NumberField);
  @field faceCount = contains(NumberField);

  static embedded = class Embedded extends Component<
    typeof ThreeMfPrintPartField
  > {
    <template>
      <div class='part'>
        <span>{{if @model.name @model.name 'Unnamed part'}}</span>
        {{#if @model.extruder}}<small>Extruder
            {{@model.extruder}}</small>{{/if}}
        {{#if @model.faceCount}}<small>{{@model.faceCount}} faces</small>{{/if}}
      </div>
      <style scoped>
        .part {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 4px 10px;
          min-width: 0;
        }
        .part span {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .part small {
          color: var(--boxel-450);
          font: 0.5625rem var(--boxel-monospace-font-family, monospace);
        }
      </style>
    </template>
  };
}

export class ThreeMfMetadataField extends FieldDef {
  static displayName = '3MF Package Metadata';
  static icon = PrinterIcon;
  @field unit = contains(StringField);
  @field language = contains(StringField);
  @field modelPart = contains(StringField);
  @field extensionCount = contains(NumberField);
  @field extensions = containsMany(StringField);
  @field title = contains(StringField);
  @field designer = contains(StringField);
  @field application = contains(StringField);
  @field bambuStudioVersion = contains(StringField);
  @field creationDate = contains(StringField);
  @field licenseTerms = contains(StringField);
  @field description = contains(TextAreaField);
  @field plateCount = contains(NumberField);
  @field printPartCount = contains(NumberField);
  @field configuredFaceCount = contains(NumberField);
  @field extruderCount = contains(NumberField);
  @field materialNames = containsMany(StringField);
  @field materialColors = containsMany(StringField);
  @field printParts = containsMany(ThreeMfPrintPartField);

  static embedded = class Embedded extends Component<
    typeof ThreeMfMetadataField
  > {
    get materialList() {
      return (this.args.model?.materialNames ?? []).join(', ');
    }
    <template>
      <dl class='three-mf-meta'>
        {{#if @model.unit}}<div><dt>Units</dt><dd
            >{{@model.unit}}</dd></div>{{/if}}
        {{#if @model.designer}}<div><dt>Designer</dt><dd
            >{{@model.designer}}</dd></div>{{/if}}
        {{#if @model.application}}<div><dt>Application</dt><dd
            >{{@model.application}}</dd></div>{{/if}}
        {{#if @model.licenseTerms}}<div><dt>License</dt><dd
            >{{@model.licenseTerms}}</dd></div>{{/if}}
        {{#if @model.bambuStudioVersion}}<div><dt>Bambu 3MF</dt><dd
            >{{@model.bambuStudioVersion}}</dd></div>{{/if}}
        {{#if @model.plateCount}}<div><dt>Plates</dt><dd
            >{{@model.plateCount}}</dd></div>{{/if}}
        {{#if @model.printPartCount}}<div><dt>Print parts</dt><dd
            >{{@model.printPartCount}}</dd></div>{{/if}}
        {{#if @model.extruderCount}}<div><dt>Extruders</dt><dd
            >{{@model.extruderCount}}</dd></div>{{/if}}
        {{#if @model.materialNames.length}}<div><dt>Materials</dt><dd
            >{{this.materialList}}</dd></div>{{/if}}
        {{#if @model.modelPart}}<div><dt>Model part</dt><dd
              class='mono'
            >{{@model.modelPart}}</dd></div>{{/if}}
        {{#if @model.printParts.length}}
          <div class='parts'><dt>Configured parts</dt><dd>{{#each
                @fields.printParts
                as |Part|
              }}<Part />{{/each}}</dd></div>
        {{/if}}
      </dl>
      <style scoped>
        .three-mf-meta {
          margin: 0;
          display: grid;
          gap: 5px;
        }
        .three-mf-meta div {
          display: grid;
          grid-template-columns: 88px minmax(0, 1fr);
          gap: 10px;
        }
        dt {
          color: var(--boxel-450);
          font: 0.5625rem var(--boxel-monospace-font-family, monospace);
          text-transform: uppercase;
        }
        dd {
          min-width: 0;
          margin: 0;
          overflow-wrap: anywhere;
        }
        .parts dd {
          display: grid;
          gap: 4px;
        }
        .mono {
          font-family: var(--boxel-monospace-font-family, monospace);
        }
      </style>
    </template>
  };
}

class ThreeMfIsolated extends GlimmerComponent<{
  Args: { model: ThreeMfDef };
}> {
  get threeMfRows(): ModelInspectorRow[] {
    let t = this.args.model.threeMfMetadata;
    let rows: ModelInspectorRow[] = [];
    if (!t) {
      return rows;
    }
    if (t.unit) {
      rows.push({ term: 'Units', detail: t.unit });
    }
    if (t.plateCount) {
      rows.push({ term: 'Plates', detail: t.plateCount });
    }
    if (t.printPartCount) {
      rows.push({ term: 'Print parts', detail: t.printPartCount });
    }
    if (t.extruderCount) {
      rows.push({ term: 'Extruders', detail: t.extruderCount });
    }
    if (t.designer) {
      rows.push({ term: 'Designer', detail: t.designer });
    }
    if (t.application) {
      rows.push({ term: 'Application', detail: t.application });
    }
    return rows;
  }

  <template>
    <ModelIsolatedBody @model={{@model}}>
      {{#if @model.threeMfMetadata}}
        <ModelInspectorSection
          @heading='3MF package'
          @rows={{this.threeMfRows}}
        />
      {{/if}}
    </ModelIsolatedBody>
  </template>
}

export class ThreeMfDef extends ThreeDModelDef {
  static displayName = '3MF Package';
  static icon = PrinterIcon;
  static acceptTypes = '.3mf,model/3mf,application/vnd.ms-3mfdocument';

  @field threeMfMetadata = contains(ThreeMfMetadataField);

  get displayUnit(): string {
    return this.threeMfMetadata?.unit ?? '';
  }

  static isolated: BaseDefComponent = ThreeMfIsolated;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: {
      contentHash?: string;
      contentSize?: number;
      // Backstop bound on the bytes we're willing to read at index time,
      // threaded from the host (see `FileDefAttributesExtractor`); defaults to
      // the realm's standard file-size limit (`DEFAULT_FILE_SIZE_LIMIT_BYTES`),
      // the same ceiling the write path enforces, so the two stay in step.
      fileSizeLimitBytes?: number;
    } = {},
  ): Promise<
    // `threeMfMetadata` is optional: over the size cap we skip the read and
    // return only the base file attributes (see below).
    SerializedFile<Partial<{ threeMfMetadata: ThreeMfMetadata }>>
  > {
    let extension = getExtension(url);
    if (extension !== '.3mf') {
      throw new FileContentMismatchError(
        `Expected .3mf file extension, got "${extension || 'none'}"`,
      );
    }

    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    // Over the size cap, skip the read but keep the ThreeMfDef type — the file
    // still renders via the live client-side viewer (which parses its own
    // geometry); it just has an empty inspector panel and the cube placeholder.
    // Do NOT throw FileContentMismatchError here: that would demote the file to
    // a plain FileDef and lose the 3D card entirely.
    let sizeCap = options.fileSizeLimitBytes ?? DEFAULT_FILE_SIZE_LIMIT_BYTES;
    if (bytes.byteLength > sizeCap) {
      console.warn(
        `[ThreeMfDef] skipping metadata extraction for ${url}: ${bytes.byteLength} bytes exceeds cap ${sizeCap}`,
      );
      return { ...base };
    }
    let parsed = parseThreeMf(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
    if (!parsed) {
      throw new FileContentMismatchError('File is not a parseable 3MF package');
    }
    return { ...base, ...parsed };
  }
}
