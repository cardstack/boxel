// Every themed CardContainer emits its own copy of the theme stylesheet, and
// prerendered fragments carry the copies baked in, so each fragment is
// self-contained. Copies that share a `data-boxel-theme-scope` are
// byte-identical (the scope embeds a hash of the theme CSS), so only one
// needs to participate in style matching. This deduper watches the document
// and disables the redundant copies, promoting a survivor whenever the
// active copy leaves the DOM or its content changes.
//
// It disables via the `disabled` property (not an attribute), so serializing
// a container's HTML — which is how prerendered fragments are captured —
// still yields the full stylesheet.

const THEME_SCOPE_SELECTOR_PREFIX = '[data-boxel-theme-scope=';

function isThemeStyle(el: HTMLStyleElement): boolean {
  return (
    el.textContent?.trimStart().startsWith(THEME_SCOPE_SELECTOR_PREFIX) ?? false
  );
}

export class ThemeStyleDeduper {
  #observer: MutationObserver | undefined;
  #doc: Document | undefined;
  #scheduled = false;

  start(doc: Document = document): void {
    if (this.#observer) {
      return;
    }
    this.#doc = doc;
    this.#observer = new MutationObserver(() => this.#schedule());
    this.#observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    this.#sync();
  }

  stop(): void {
    this.#observer?.disconnect();
    this.#observer = undefined;
    if (this.#doc) {
      for (let el of this.#doc.querySelectorAll('style')) {
        if (isThemeStyle(el)) {
          el.disabled = false;
        }
      }
    }
    this.#doc = undefined;
  }

  #schedule(): void {
    if (this.#scheduled) {
      return;
    }
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#sync();
    });
  }

  // One full pass: group theme style elements by content and keep only the
  // first copy (in document order) of each group enabled. A full pass keeps
  // the logic immune to reordering, removal of the active copy, and content
  // rewrites (a theme edit changes the scope hash, forming a new group).
  #sync(): void {
    if (!this.#doc) {
      return;
    }
    let seen = new Set<string>();
    for (let el of this.#doc.querySelectorAll('style')) {
      if (!isThemeStyle(el)) {
        continue;
      }
      let key = el.textContent!;
      let redundant = seen.has(key);
      seen.add(key);
      if (el.disabled !== redundant) {
        el.disabled = redundant;
      }
    }
  }
}
