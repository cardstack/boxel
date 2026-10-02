// Pretui — keepStyle: a component's own custom properties alongside a
// caller's `style`.
//
// Glimmer merges only `class` across `...attributes`. A caller's `style`
// replaces the component's whole `style` attribute, so a component that paints
// from per-instance custom properties (a hue, a size) loses them. This
// modifier writes each property as a single declaration on top of whatever
// style the element ends up with, and a `MutationObserver` writes it again
// when the caller's style changes later. The caller's own declarations are
// kept. The modifier installs in the same render that writes the attribute, so
// nothing paints in between. The component still renders the same properties
// in its own `style` attribute: with no caller `style`, that attribute is what
// an argument change rewrites. With a caller `style`, it is not rendered at
// all.
//
// Each property has a strength:
//
// - `'arg'` — the value comes from an argument the caller passed, and it wins
//   over the same property in the caller's style. The caller's value comes
//   back when the argument is cleared.
// - `'default'` — the value is the component's own default (a hue derived from
//   a name), and it only fills in when the caller's style does not set the
//   property.
//
// The observer drains the record of each of the modifier's own writes as soon
// as it makes one. A record it delivers is either a caller rewrite or a
// single-property write by something else on the element (boxel-ui's
// `setCssVar`, passed through `...attributes`), which leaves our values in
// place. So the modifier remembers what it wrote, and a value equal to that is
// never adopted as the caller's. A later caller rewrite that repeats our value
// exactly is therefore treated as ours, and clearing the argument afterwards
// removes it.
//
// Values must already be safe: a validated `cssValue`, or a number the
// component formatted itself. Property names are authored literals.
import { modifier } from 'ember-modifier';

export type KeptStrength = 'arg' | 'default';

export interface KeptProperty {
  property: string;
  value: string | undefined;
  strength: KeptStrength;
}

export const keepStyle = modifier(
  (el: HTMLElement, [entries]: [KeptProperty[]]) => {
    let kept = entries.filter(
      (e): e is KeptProperty & { value: string } => e.value !== undefined,
    );
    if (kept.length === 0) {
      return;
    }
    let read = (property: string) =>
      el.style.getPropertyValue(property).trim() || undefined;
    let callerValues = new Map<string, string | undefined>();
    let ours = new Map<string, string>();
    let readCaller = () => {
      for (let { property } of kept) {
        let value = read(property);
        if (value === undefined || value !== ours.get(property)) {
          callerValues.set(property, value);
        }
      }
    };
    let write = (observer?: MutationObserver) => {
      let wrote = false;
      for (let { property, value, strength } of kept) {
        if (
          strength === 'default' &&
          callerValues.get(property) !== undefined
        ) {
          continue;
        }
        ours.set(property, value);
        if (read(property) !== value) {
          el.style.setProperty(property, value);
          wrote = true;
        }
      }
      if (wrote) {
        observer?.takeRecords();
      }
    };
    readCaller();
    write();
    let observer = new MutationObserver((_records, self) => {
      readCaller();
      write(self);
    });
    observer.observe(el, { attributes: true, attributeFilter: ['style'] });
    return () => {
      // A record still queued here is a caller rewrite in the same render as
      // this teardown, and what it left is the caller's, so nothing is put
      // back over it.
      let rewritten = observer.takeRecords().length > 0;
      observer.disconnect();
      if (rewritten) {
        return;
      }
      for (let { property, value } of kept) {
        if (read(property) !== value) {
          continue;
        }
        let callerValue = callerValues.get(property);
        if (callerValue) {
          el.style.setProperty(property, callerValue);
        } else {
          el.style.removeProperty(property);
        }
      }
    };
  },
);
