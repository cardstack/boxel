// Pretui — keepStyle: a component's own custom properties alongside a
// caller's `style`.
//
// Glimmer merges only `class` across `...attributes`. A caller's `style`
// replaces the component's whole `style` attribute, so a component that paints
// from per-instance custom properties (a hue, a size) loses them. This
// modifier writes each property as a single declaration on top of whatever
// style the element ends up with, and a `MutationObserver` writes it again
// when the caller's style changes later. The caller's own declarations are
// kept. The component still renders the same properties in its own `style`
// attribute, so the first paint does not wait for the modifier.
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
// as it makes one, so every record it delivers is a caller rewrite, and the
// value that rewrite leaves is the caller's value, even when it equals ours.
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
    let readCaller = () => {
      for (let { property } of kept) {
        callerValues.set(property, read(property));
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
      // A caller rewrite in the same render as this teardown is still queued,
      // and what it left is the caller's, so nothing is put back over it.
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
