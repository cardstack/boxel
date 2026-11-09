import {
  primitive,
  Component,
  FieldDef,
  queryableValue,
  assertDeclarable,
} from './card-api';
import type { BaseDef } from './card-api';
import { htmlSafe } from '@ember/template';
import ChartDotsIcon from '@cardstack/boxel-icons/chart-dots';
import {
  fieldSerializer,
  VectorSerializer,
  vectorSpace,
  isExactSpace,
  type Vector,
} from '@cardstack/runtime-common';

// How many leading components the embedded view draws as its fingerprint.
const FINGERPRINT_CELLS = 32;

// Qwen3-Embedding-8B as served on 2026-11-05. OpenRouter publishes no
// weights revision, so the revision is the date the space was fixed.
const STANDARD_TEXT_VECTORIZER = 'qwen/qwen3-embedding-8b@2026-11-05';

function describe(vector: Vector | null | undefined): string {
  if (vector == null) {
    return '';
  }
  return `${vector.dims}-d ${vector.encoding} vector`;
}

class Atom extends Component<typeof VectorField> {
  get label() {
    return describe(this.args.model);
  }
  <template>
    {{#if @model}}
      <span class='vector-atom' data-test-vector-atom>{{this.label}}</span>
    {{/if}}
    <style scoped>
      .vector-atom {
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
    </style>
  </template>
}

// The embedded view never prints the numbers: it shows the size and encoding
// and a fingerprint of the first components (cell opacity = |component|,
// colour = sign), enough to tell two vectors apart at a glance.
class Embedded extends Component<typeof VectorField> {
  get label() {
    return describe(this.args.model);
  }

  get cells() {
    let vector = this.args.model;
    if (vector == null) {
      return [];
    }
    let components = Array.from(VectorSerializer.decodeVector(vector)).slice(
      0,
      FINGERPRINT_CELLS,
    );
    let maxAbs = Math.max(...components.map((c) => Math.abs(c)), 0) || 1;
    return components.map((c) => ({
      negative: c < 0,
      style: htmlSafe(
        `opacity: ${(0.15 + 0.85 * (Math.abs(c) / maxAbs)).toFixed(2)}`,
      ),
    }));
  }

  <template>
    {{#if @model}}
      <div class='vector' data-test-vector>
        <span class='vector-label'>{{this.label}}</span>
        <span class='fingerprint' aria-hidden='true'>
          {{#each this.cells as |cell|}}
            <span
              class='cell {{if cell.negative "negative"}}'
              style={{cell.style}}
            ></span>
          {{/each}}
        </span>
      </div>
    {{else}}
      <span class='vector-empty'>No vector</span>
    {{/if}}
    <style scoped>
      .vector {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        max-width: 100%;
      }
      .vector-label {
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: var(--boxel-font-size-xs);
        white-space: nowrap;
      }
      .fingerprint {
        display: inline-grid;
        grid-template-columns: repeat(32, 4px);
        gap: 1px;
        height: 12px;
        overflow: hidden;
      }
      .cell {
        background-color: var(--primary, var(--boxel-highlight));
        border-radius: 1px;
      }
      .cell.negative {
        background-color: var(--foreground, var(--boxel-dark));
      }
      .vector-empty {
        color: var(--muted-foreground, var(--boxel-450));
        font-size: var(--boxel-font-size-xs);
      }
    </style>
  </template>
}

// A vector: a fixed number of components, stored as base64 int8 or float32.
// Cards rank by it with a `near` sort:
//
//   sort: [{ on: momentRef, by: 'textVector', near: [ ... ] }]
//
// A vector compares only with vectors from the same space: the exact
// vectorizer (id and revision), the provider that serves it, and the size.
// Every vector type names its space in full on a named subclass, and every
// field meant to be comparable uses that one type:
//
//   export class TalkText extends TextVectorField {
//     static vectorizer = 'qwen/qwen3-embedding-8b@2026-11-05';
//     static provider = 'openrouter:deepinfra';
//     static dimensions = 256;
//   }
//
// The kinds (`TextVectorField`, `MultimodalVectorField`,
// `SuppliedVectorField`) name no vectorizer, so a field typed with one
// directly, or with a subclass that leaves part of its space out, is refused
// when its module loads (`needs-vectorizer`). `StandardTextVector` is the
// pinned default for text. A newer default ships as a new type
// (`StandardTextVector2`); a type's space is never edited in place.
//
// `VectorField` itself names no space. It stays usable for small,
// hand-written cases, and its vectors compare only with other plain
// `VectorField` vectors of the same size.
export default class VectorField extends FieldDef {
  static displayName = 'Vector';
  static icon = ChartDotsIcon;
  static [primitive]: Vector;
  static [fieldSerializer] = 'vector';
  static dimensions = 1024;
  // The exact vectorizer id with its revision, as a Vectorizer registry card
  // names it. Never an alias or `latest`.
  static vectorizer: string | undefined = undefined;
  // Where calls go, including a pinned host: `openrouter:deepinfra`.
  static provider: string | undefined = undefined;
  // What the vectorizer accepts: 'text', 'multimodal' (text and images in
  // one space) or 'supplied' (written by a pipeline, never by the platform).
  static vectorKind: 'text' | 'multimodal' | 'supplied' | undefined = undefined;
  static embedded = Embedded;
  static atom = Atom;
  static edit = Embedded;

  // The full space every stored vector of this type records.
  static get space(): string {
    return vectorSpace(this);
  }

  static [assertDeclarable](fieldName: string) {
    if (this.vectorKind && !isExactSpace(this)) {
      let error = new Error(
        `field "${fieldName}": ${this.name} is a ${this.vectorKind} vector kind with no exact space; declare a subclass with static vectorizer (id@revision), provider and dimensions, or use StandardTextVector`,
      );
      (error as Error & { code: string }).code = 'needs-vectorizer';
      throw error;
    }
  }

  static [queryableValue](value: any, _stack: BaseDef[] = []): any {
    if (value == null) {
      return null;
    }
    if (value.dims !== this.dimensions) {
      throw new Error(
        `${this.name}: expected a ${this.dimensions}-dimension vector, got ${value.dims}`,
      );
    }
    return VectorSerializer.queryableValue(value);
  }

  static markdown = class Markdown extends Component<typeof this> {
    get text() {
      return describe(this.args.model);
    }
    <template>{{this.text}}</template>
  };
}

export { VectorField };

// Text in, one vector out. A field of this kind names its exact space on a
// subclass.
export class TextVectorField extends VectorField {
  static displayName = 'Text vector';
  static vectorKind = 'text' as const;
}

// Text and images in one shared space, so text finds images and images find
// each other.
export class MultimodalVectorField extends VectorField {
  static displayName = 'Multimodal vector';
  static vectorKind = 'multimodal' as const;
}

// Vectors a pipeline computes and writes with a vector operation (video,
// custom vectorizers). The platform never vectorizes them.
export class SuppliedVectorField extends VectorField {
  static displayName = 'Supplied vector';
  static vectorKind = 'supplied' as const;
}

// The standard text space, fixed for good: Qwen3-Embedding-8B through
// OpenRouter pinned to DeepInfra, at 1024 dimensions (the model emits 4,096
// and can be trimmed to any size from 32; 1024 stays under pgvector's
// 2,000-dimension index limit). A better default ships as a new type.
export class StandardTextVector extends TextVectorField {
  static displayName = 'Standard text vector';
  static vectorizer = STANDARD_TEXT_VECTORIZER;
  static provider = 'openrouter:deepinfra';
  static dimensions = 1024;
}
export type { Vector };
