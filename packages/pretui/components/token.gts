// Pretui — Token: a machine value set as jewelry — an id, a key, a code (Law 3).
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';
import { hueStyle } from '../internal/ink';
import { cssValue } from '../pretui-css';
import {
  resolveSize,
  type PretuiSize,
  type PretuiSizeArg,
} from '../pretui-primitives';

export interface TokenSignature {
  Args: {
    value?: string;
    hue?: string;
    /** house scale xs|s|m|l|xl; omitted or 'default', the size follows `--text-body` */
    size?: PretuiSizeArg;
    /** let a long value wrap instead of overflowing on one line */
    wrap?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

const HUE_PROPERTY = '--pretui-token-hue';

// The declarations of a style as a sorted list of `property:value`, to tell
// whether a rewrite changed anything regardless of order.
function declarations(style: CSSStyleDeclaration): string {
  let list: string[] = [];
  for (let i = 0; i < style.length; i++) {
    let property = style.item(i);
    list.push(`${property}:${style.getPropertyValue(property).trim()}`);
  }
  return list.sort().join('\n');
}

// A caller's `style` replaces Token's own `style` attribute, so `@hue` is also
// written as a single property on top of whatever style the element ends up
// with. The observer puts it back when the caller's style changes later and
// the attribute is rewritten. The hue the caller's style last set comes back
// when `@hue` is cleared.
//
// The observer drains the record of each of the modifier's own writes as soon
// as it makes one, so the old value of the first record in a batch it
// delivers is the attribute as the modifier left it. What changed since is
// either a caller rewrite, which replaces the whole attribute, or a
// single-property write by something else on the element (boxel-ui's
// `setCssVar`, passed through `...attributes`), which leaves the hue in place.
// So a batch is taken as a caller rewrite when it changed the hue, or when it
// changed no declaration at all, which only a rewrite of the attribute does (a
// single-property write that changes nothing queues no record). After a
// caller rewrite, the hue the element now has is the caller's. After any other
// batch, the caller's hue stays as it was.
//
// The cost: a caller rewrite that sets the hue exactly as `@hue` wrote it, and
// changes some other declaration, looks like another modifier's write. Its hue
// is not taken as the caller's, so when `@hue` is cleared the caller's earlier
// hue comes back, or the hue is removed if the caller had none.
const keepHue = modifier((el: HTMLElement, [hue]: [string | undefined]) => {
  let value = cssValue(hue);
  if (value === undefined) {
    return;
  }
  let read = () => el.style.getPropertyValue(HUE_PROPERTY).trim() || undefined;
  let callerHue = read();
  let isCallerRewrite = (records: MutationRecord[]) => {
    if (records.length === 0) {
      return false;
    }
    let before = el.ownerDocument.createElement('span').style;
    before.cssText = records[0].oldValue ?? '';
    let changedHue =
      (before.getPropertyValue(HUE_PROPERTY).trim() || undefined) !== read();
    return changedHue || declarations(before) === declarations(el.style);
  };
  let write = (observer?: MutationObserver) => {
    if (read() !== value) {
      el.style.setProperty(HUE_PROPERTY, value);
      observer?.takeRecords();
    }
  };
  write();
  let observer = new MutationObserver((records, self) => {
    if (isCallerRewrite(records)) {
      callerHue = read();
    }
    write(self);
  });
  observer.observe(el, {
    attributes: true,
    attributeFilter: ['style'],
    attributeOldValue: true,
  });
  return () => {
    // Records still queued here were written in the same render, before this
    // teardown: Glimmer sets the caller's style and runs the caller's
    // modifiers ahead of this one. If they make a caller rewrite, the hue the
    // element has now is the caller's, so nothing is put back over it. If not
    // (another modifier wrote its own property), the caller's hue is put back
    // as usual.
    let rewritten = isCallerRewrite(observer.takeRecords());
    observer.disconnect();
    if (!rewritten && read() === value) {
      if (callerHue) {
        el.style.setProperty(HUE_PROPERTY, callerHue);
      } else {
        el.style.removeProperty(HUE_PROPERTY);
      }
    }
  };
});

// Law 3 — a machine value set like jewelry: mono pill, inline in prose.
// Carries .35ch side margins; flush (margin 0) as a direct cell/dd child.
export class Token extends Component<TokenSignature> {
  get style() {
    return hueStyle(HUE_PROPERTY, this.args.hue);
  }
  // 'default' is the component's own default, which for Token is no step.
  get size(): PretuiSize | undefined {
    let { size } = this.args;
    return size === undefined || size === 'default'
      ? undefined
      : resolveSize(size);
  }
  <template>
    <code
      class='pretui-token'
      style={{this.style}}
      data-size={{this.size}}
      data-wrap={{if @wrap 'true'}}
      data-test-pretui-token
      {{keepHue @hue}}
      ...attributes
    >
      {{#if @value}}{{@value}}{{else}}{{yield}}{{/if}}
    </code>
    <style scoped>
      @layer PretComponent {
        .pretui-token {
          --_th: var(--pretui-token-hue, var(--pretui-primary-ink, var(--primary)));
          display: inline-block;
          margin-inline: 0.35ch;
          vertical-align: baseline;
          font-family: var(--font-mono);
          font-size: var(
            --pretui-token-font-size,
            calc(var(--text-body, 15px) - 3.5px)
          );
          line-height: 1.5;
          padding: 0 5px;
          border-radius: 4px;
          background: color-mix(in oklch, var(--_th) 8%, var(--card));
          color: color-mix(in oklch, var(--foreground) 26%, var(--_th));
          box-shadow: 0 0 0 1px color-mix(in oklch, var(--_th) 30%, var(--border));
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        /* size scale — the same steps as Button's @size */
        .pretui-token[data-size='xs'] {
          font-size: var(--pretui-size-xs, var(--text-ui-xs, 0.66rem));
        }
        .pretui-token[data-size='s'] {
          font-size: var(--pretui-size-s, var(--text-ui-sm, 0.72rem));
        }
        .pretui-token[data-size='m'] {
          font-size: var(--pretui-size-m, var(--text-ui-md, 0.78rem));
        }
        .pretui-token[data-size='l'] {
          font-size: var(--pretui-size-l, var(--text-ui-lg, 0.875rem));
        }
        .pretui-token[data-size='xl'] {
          font-size: var(--pretui-size-xl, var(--text-ui-xl, 1rem));
        }
        .pretui-token[data-wrap] {
          white-space: normal;
          overflow-wrap: anywhere;
        }
        :where(td, dd) > .pretui-token {
          margin-inline: 0;
        }
      }
    </style>
  </template>
}
