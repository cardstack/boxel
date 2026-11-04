import { primitive, Component, FieldDef, queryableValue } from './card-api';
import type { BaseDef } from './card-api';
import { htmlSafe } from '@ember/template';
import ChartDotsIcon from '@cardstack/boxel-icons/chart-dots';
import {
  fieldSerializer,
  VectorSerializer,
  type Vector,
} from '@cardstack/runtime-common';

// How many leading components the embedded view draws as its fingerprint.
const FINGERPRINT_CELLS = 32;

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

// An embedding vector: fixed dimension, stored as base64 int8 (default) or
// float32. Cards rank by it with a `near` sort:
//
//   sort: [{ on: momentRef, by: 'embedding', near: [ ... ] }]
//
// The default dimension is 256. Declare another with a subclass:
//
//   class Embedding1024 extends VectorField { static dimensions = 1024; }
//
// A stored vector of any other dimension fails indexing with an error on the
// card. Vectors are written by code (an embedding command), so the edit
// format shows the same read-only summary.
export default class VectorField extends FieldDef {
  static displayName = 'Vector';
  static icon = ChartDotsIcon;
  static [primitive]: Vector;
  static [fieldSerializer] = 'vector';
  static dimensions = 256;
  static embedded = Embedded;
  static atom = Atom;
  static edit = Embedded;

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
export type { Vector };
