import Helper from '@ember/component/helper';

interface Signature {
  Args: {
    Positional: [classNames?: string];
  };
  Return: void;
}

// Reference counts per class name, shared across helper instances so
// concurrent users (e.g. stacked modals) don't clear each other's classes.
const refCounts = new Map<string, number>();

function addNames(names: string[]) {
  for (const name of names) {
    const count = refCounts.get(name) ?? 0;
    refCounts.set(name, count + 1);
    if (count === 0) {
      document.body.classList.add(name);
    }
  }
}

function removeNames(names: string[]) {
  for (const name of names) {
    const count = refCounts.get(name) ?? 0;
    if (count === 0) {
      // never tracked — not ours to remove
      continue;
    }
    if (count === 1) {
      refCounts.delete(name);
      document.body.classList.remove(name);
    } else {
      refCounts.set(name, count - 1);
    }
  }
}

// Adds the given space-separated class names to <body> while the helper is
// rendered, removing them when it is torn down.
export default class SetBodyClass extends Helper<Signature> {
  private current: string[] = [];

  compute([classNames]: [string?]): void {
    const next = classNames ? classNames.split(/\s+/).filter(Boolean) : [];
    // Acquire before releasing so a name present in both lists keeps a
    // nonzero refcount and never leaves <body> during a recompute.
    addNames(next);
    removeNames(this.current);
    this.current = next;
  }

  override willDestroy(): void {
    super.willDestroy();
    removeNames(this.current);
    this.current = [];
  }
}
