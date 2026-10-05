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
// as it makes one, so the old value of the first record in a batch it
// delivers is the attribute as the modifier left it. What changed since is
// either a caller rewrite, which replaces the whole attribute, or a
// single-property write by something else on the element (boxel-ui's
// `setCssVar`, passed through `...attributes`), which leaves the kept
// properties in place. So a batch is taken as a caller rewrite when it changed
// one of the kept properties, or when it changed no declaration at all, which
// only a rewrite of the attribute does (a single-property write that changes
// nothing queues no record). After a caller rewrite, the kept properties as the
// element now has them are the caller's. After any other batch, the caller's
// values stay as they were.
//
// The cost: a caller rewrite that sets each kept property exactly as the
// modifier wrote it, and changes some other declaration, looks like another
// modifier's write. Its values are not taken as the caller's, so when an
// argument is cleared the caller's earlier value comes back, or the property
// is removed if the caller had none; and a default it repeats is still
// replaced when the default changes.
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
    // Each caller value keeps its priority, so a caller's `!important` comes
    // back with it.
    let callerValues = new Map<
      string,
      { value: string; priority: string } | undefined
    >();
    let readCaller = () => {
      for (let { property } of kept) {
        let value = read(property);
        callerValues.set(
          property,
          value === undefined
            ? undefined
            : { value, priority: el.style.getPropertyPriority(property) },
        );
      }
    };
    let isCallerRewrite = (records: MutationRecord[]) => {
      if (records.length === 0) {
        return false;
      }
      let before = el.ownerDocument.createElement('span').style;
      before.cssText = records[0].oldValue ?? '';
      let changedKept = kept.some(
        ({ property }) =>
          (before.getPropertyValue(property).trim() || undefined) !==
          read(property),
      );
      return changedKept || declarations(before) === declarations(el.style);
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
    let observer = new MutationObserver((records, self) => {
      if (isCallerRewrite(records)) {
        readCaller();
      }
      write(self);
    });
    observer.observe(el, {
      attributes: true,
      attributeFilter: ['style'],
      attributeOldValue: true,
    });
    return () => {
      // Records still queued here were written in the same render, before
      // this teardown: Glimmer sets the caller's style and runs the caller's
      // modifiers ahead of this one. If they make a caller rewrite, what the
      // element has now is the caller's, so nothing is put back over it. If
      // not (another modifier wrote its own property), the caller's values
      // are put back as usual.
      let rewritten = isCallerRewrite(observer.takeRecords());
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
          el.style.setProperty(
            property,
            callerValue.value,
            callerValue.priority,
          );
        } else {
          el.style.removeProperty(property);
        }
      }
    };
  },
);
