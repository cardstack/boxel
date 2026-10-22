// Pretui — MediaInspector: the metadata panel for one asset, composed from KeyValue.
import Component from '@glimmer/component';
import { formatBytes, resolveAsset } from '../internal/media-viewer';
import type { MediaAssetSpec, ResolvedMediaAsset } from '../internal/media-viewer';
import { formatClock } from '../internal/reading-format';
import { KeyValue } from './key-value';
import type { KeyValueItem } from './key-value';
import { Token } from './token';
import { KIND_WORD } from '../internal/media-assets';

// ── MediaInspector ───────────────────────────────────────────────────────
//
// The metadata panel. It composes KeyValue rather than growing its own definition list. The only
// thing it adds is the derived row set: kind, dimensions, duration and size
// are computed from the asset the same way the grid computes them, so the
// panel and the tile can never disagree.

export interface MediaInspectorSignature {
  Args: {
    /** The asset to describe. */
    asset: MediaAssetSpec;
    /** Heading above the rows. @default 'Details' */
    title?: string;
    /** Hide the derived rows and show only `asset.meta`. @default false */
    metaOnly?: boolean;
  };
  Blocks: {
    /** Extra rows or controls under the table. */
    footer: [];
  };
  Element: HTMLElement;
}

export class MediaInspector extends Component<MediaInspectorSignature> {
  get asset(): ResolvedMediaAsset {
    return resolveAsset(this.args.asset);
  }
  get title(): string {
    return this.args.title ?? 'Details';
  }
  get items(): KeyValueItem[] {
    const asset = this.asset;
    const rows: KeyValueItem[] = [];
    if (!(this.args.metaOnly ?? false)) {
      rows.push({ key: 'Kind', value: KIND_WORD[asset.kind] });
      if (asset.width && asset.height) {
        rows.push({
          key: 'Dimensions',
          value: `${asset.width} × ${asset.height}`,
        });
      }
      if (asset.duration) {
        rows.push({ key: 'Duration', value: formatClock(asset.duration) });
      }
      const size = formatBytes(asset.bytes);
      if (size) {
        rows.push({ key: 'Size', value: size });
      }
      if (asset.tracks && asset.tracks.length > 0) {
        rows.push({
          key: 'Captions',
          value: asset.tracks.map((part) => part.label).join(', '),
        });
      }
    }
    const extra = asset.meta;
    if (extra) {
      for (const key of Object.keys(extra)) {
        rows.push({ key, value: extra[key] });
      }
    }
    return rows;
  }

  <template>
    <section
      class='pretui-minspector'
      aria-label={{this.title}}
      data-test-pretui-media-inspector
      ...attributes
    >
      <header class='pretui-minspector-head'>
        <h3 class='pretui-minspector-title'>{{this.title}}</h3>
        <span class='pretui-minspector-name'>{{this.asset.label}}</span>
      </header>
      <KeyValue @items={{this.items}}>
        <:value as |item|>
          {{#if (isMachineRow item.key)}}
            <Token @value={{item.value}} />
          {{else}}
            {{item.value}}
          {{/if}}
        </:value>
      </KeyValue>
      <div class='pretui-minspector-footer'>{{yield to='footer'}}</div>
    </section>

    <style scoped>
      @layer PretComponent {
        .pretui-minspector {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
          padding: 12px 14px;
          border-radius: var(--radius);
          background: var(--card);
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        }
        .pretui-minspector-head {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .pretui-minspector-title {
          margin: 0;
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .pretui-minspector-name {
          font-size: var(--text-body, 14px);
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--foreground);
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-minspector-footer:empty {
          display: none;
        }
      }
    </style>
  </template>
}

// Machine values get the Law-3 treatment; prose does not. One predicate,
// used from the KeyValue value slot.
const MACHINE_ROWS = new Set(['Dimensions', 'Size', 'Duration', 'Format']);
function isMachineRow(key: string): boolean {
  return MACHINE_ROWS.has(key);
}
