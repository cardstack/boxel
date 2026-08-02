import Service from '@ember/service';

interface StylesheetEntry {
  consumers: number;
  element: HTMLStyleElement;
}

// SES cards share the host document, but their compiled selectors are already
// scoped. Keep one document stylesheet per distinct compiled payload instead
// of cloning the same <style> element into every fitted/embedded card.
export default class RealmSandboxStylesService extends Service {
  private entries = new Map<string, StylesheetEntry>();

  acquire(stylesheets: readonly string[]): () => void {
    let acquired = [...new Set(stylesheets)];
    for (let css of acquired) {
      let entry = this.entries.get(css);
      if (entry) {
        entry.consumers++;
        continue;
      }
      let element = document.createElement('style');
      element.setAttribute('data-realm-sandbox-stylesheet', '');
      element.textContent = css;
      document.head.append(element);
      this.entries.set(css, { consumers: 1, element });
    }

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      for (let css of acquired) {
        let entry = this.entries.get(css);
        if (!entry) {
          continue;
        }
        entry.consumers--;
        if (entry.consumers === 0) {
          entry.element.remove();
          this.entries.delete(css);
        }
      }
    };
  }

  willDestroy() {
    for (let entry of this.entries.values()) {
      entry.element.remove();
    }
    this.entries.clear();
    super.willDestroy();
  }
}

declare module '@ember/service' {
  interface Registry {
    'realm-sandbox-styles': RealmSandboxStylesService;
  }
}
