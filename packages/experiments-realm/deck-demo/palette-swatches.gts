import { htmlSafe } from '@ember/template';

import { CardDef, Component } from '@cardstack/base/card-api';

// The consumer. The whole demo hangs off the next line.
//
// `palette` is a BARE SPECIFIER. There is no such file in this realm, no
// relative path, no version, no URL — nothing here says which build of the
// library this card gets. The Version Lock card next door says it, and this
// module is bound to whatever that card currently pins.
//
// Two things follow that are worth saying out loud, because they are the
// reason any of this was built:
//
//   1. Changing the version changes NOTHING in this file. No rewrite, no
//      codemod, no copy of the realm. On main the only way to run a second
//      version of a library is to duplicate the tree that imports it.
//
//   2. Both builds stay live at their own immutable addresses. This is not
//      "upgrade and hope" — the old one is still there, still served, still
//      byte-identical to what it always was.
//
// v1 and v2 have deliberately incompatible APIs: v1's pick() takes an index,
// v2's takes a name. So the swatches below cannot render the same way under
// both by accident. What you see is what actually loaded.
import * as palette from 'palette';

const { VERSION, pick } = palette;

// A namespace import rather than `import { names }`, and the reason is
// version skew: 1.0.0 never exported `names`, and it is immutable, so a named
// import would be asking a sealed version for something it does not have.
// Off the namespace it is an ordinary undefined the card can branch on.
function suppliedNames(): string[] | undefined {
  let fn = (palette as { names?: () => string[] }).names;
  return typeof fn === 'function' ? fn() : undefined;
}

// The fallback for a version that has swatches but cannot enumerate them.
const ASSUMED_NAMES = ['red', 'blue', 'green', 'amber', 'plum'];

// The colour is the whole point of the card and it is only known at runtime,
// so it cannot live in a stylesheet. Built here and marked safe rather than
// interpolated in the template, which would be a concatenated inline style.
// The value comes from the pinned library, not from user input.
function swatchStyle(color: string) {
  return htmlSafe(`background: ${color}`);
}

export class PaletteSwatches extends CardDef {
  static displayName = 'Palette Swatches';

  static isolated = class Isolated extends Component<typeof PaletteSwatches> {
    // v1 has no names() and its pick() wants a number; v2 wants a name. Ask
    // each in its own language rather than papering over the break — the
    // difference IS the demonstration.
    private get swatches() {
      if (VERSION.startsWith('1.')) {
        return [0, 1, 2].map((i) => ({
          key: String(i),
          label: `pick(${i})`,
          color: pick(i as never),
          swatchStyle: swatchStyle(pick(i as never)),
        }));
      }
      // Ask the library what it holds instead of assuming five names. A
      // version can ship any number of swatches — a ten-step ramp reads
      // nothing like a five-colour set — and hardcoding the list here would
      // silently show a slice of whatever is actually pinned.
      let names = suppliedNames() ?? ASSUMED_NAMES;
      return names.map((n) => ({
        key: n,
        label: `pick('${n}')`,
        color: pick(n as never),
        swatchStyle: swatchStyle(pick(n as never)),
      }));
    }

    <template>
      <section class='swatches'>
        <header>
          <span class='badge'>palette v{{VERSION}}</span>
          <p>Hellow Hassan. This card imports <code>palette</code> with no version anywhere in
            its source. The Version Lock decides which build that is.</p>
        </header>

        <ul class='grid'>
          {{#each this.swatches key='key' as |s|}}
            <li>
              <span class='chip' style={{s.swatchStyle}}></span>
              <span class='api'>{{s.label}}</span>
              <span class='hex'>{{s.color}}</span>
            </li>
          {{/each}}
        </ul>
      </section>

      <style scoped>
        /* Light chrome on purpose. The card is a neutral surface; everything
           that changes between versions is the library's output, so the
           container stays out of the way and constant. */
        .swatches {
          padding: 1.5rem;
          font: 400 15px/1.5 system-ui, sans-serif;
        }
        .badge {
          display: inline-block;
          padding: 0.2rem 0.6rem;
          border-radius: 999px;
          background: #111;
          color: #fff;
          font-family: ui-monospace, monospace;
          font-size: 0.8rem;
        }
        header p {
          margin: 0.5rem 0 0;
          color: #666;
          font-size: 0.9rem;
          max-width: 32rem;
        }
        /* Dense enough for a ten-step ramp to read as a ramp. At the previous
           8rem minimum a ten-swatch palette wrapped into ragged rows and the
           progression — the thing a tonal scale exists to show — was lost at
           the line break. Narrow columns keep the steps adjacent and in
           order. */
        .grid {
          list-style: none;
          margin: 1.25rem 0 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
          gap: 0.5rem;
        }
        .grid li {
          display: flex;
          flex-direction: column;
          /* The label and the hex are two facts, and at a tight gap with a
             small monospace face they read as one run — "pick(0)#e5484d".
             Separate them properly and let each be its own line. */
          gap: 0.2rem;
          min-width: 0;
        }
        .chip {
          display: block;
          height: 2.75rem;
          border-radius: 0.35rem;
          /* Needed most at the pale end of a greyscale ramp, where the top
             steps are within a few percent of the card itself and would
             otherwise have no visible edge at all. */
          border: 1px solid rgb(0 0 0 / 0.12);
        }
        .api,
        .hex {
          font-family: ui-monospace, monospace;
          /* Each on its own line. Inline spans in a flex column still lay out
             as blocks, but saying so keeps a long label from ever sharing a
             line with the value beneath it. */
          display: block;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }
        .api {
          font-size: 0.72rem;
          color: #222;
        }
        .hex {
          font-size: 0.68rem;
          color: #8a8a8a;
          /* Uppercase hex reads as a value rather than a word, which is the
             fastest way to tell it apart from the call above it. */
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }
      </style>
    </template>
  };
}
