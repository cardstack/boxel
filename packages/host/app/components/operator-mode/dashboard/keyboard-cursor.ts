import { cached, tracked } from '@glimmer/tracking';

import { nearestNavIndexInRow } from '@cardstack/host/lib/workspace-list';

interface Walk {
  // One key per `[data-nav-index]` element, in page order, so the index of a
  // key is that element's nav index. A key names what the element shows, so
  // it stays put when the walk changes around it.
  keys(): string[];
  // Where the cursor rests before the user moves it.
  defaultIndex(): number;
}

// The dashboard's keyboard cursor: one item in the walk of workspaces and
// catalogs. It rests on an item, focused, from the moment the dashboard opens,
// so Enter works at once. Its ring is the keyboard's: Tab or the first
// arrow key shows it without moving it, and a pointer press hides it again.
// Left and Right step through the walk; Up and Down move to the nearest item
// in the row above or below, whatever the layout.
export default class KeyboardCursor {
  // The item the user moved to, and where it was, for when it leaves the walk.
  @tracked private selected: { key: string; index: number } | null = null;
  @tracked private keyboardEngaged = false;

  constructor(private walk: Walk) {}

  // Follows the selected item when the walk changes without a keypress, as
  // when favoriting one adds a desk ahead of it. An item that left the walk,
  // as when Hosted hides it, gives way to whatever now holds its place.
  // Every item reads it, so it is cached, and the default is only worked out
  // when nothing is selected.
  @cached
  get currentIndex() {
    let keys = this.walk.keys();
    if (keys.length === 0) {
      return 0;
    }
    let index: number;
    if (this.selected) {
      let found = keys.indexOf(this.selected.key);
      index = found >= 0 ? found : this.selected.index;
    } else {
      index = this.walk.defaultIndex();
    }
    return Math.min(Math.max(index, 0), keys.length - 1);
  }

  get isRingShown() {
    return this.keyboardEngaged;
  }

  private select(index: number) {
    let key = this.walk.keys()[index];
    if (key !== undefined) {
      this.selected = { key, index };
    }
  }

  onPointerUp = () => {
    this.keyboardEngaged = false;
  };

  // Focus anywhere in an item, its star or menu included, moves the cursor
  // there, so the ring never marks one item while another has focus.
  onFocusIn = (event: Event) => {
    let target = event.target as HTMLElement;
    let item =
      target.closest<HTMLElement>('[data-nav-index]') ??
      target
        .closest('[data-workspace-tile]')
        ?.querySelector<HTMLElement>('[data-nav-index]');
    if (!item) {
      return;
    }
    let index = Number(item.dataset.navIndex);
    if (Number.isNaN(index)) {
      return;
    }
    // Compared with the effective position: the selected item's focus
    // modifier re-enters here in the render that read `currentIndex`, and a
    // write then would trip the backtracking-rerender assertion. A control
    // inside the default item is recorded all the same, since only the user
    // focuses those; otherwise favoriting it would move the default, and the
    // cursor with it.
    if (index !== this.currentIndex || (!this.selected && target !== item)) {
      this.select(index);
    }
  };

  onKeydown = (keydown: Event) => {
    let event = keydown as KeyboardEvent;
    let container = event.currentTarget as HTMLElement;
    let count = this.walk.keys().length;
    if (count === 0) {
      return;
    }
    if (event.key === 'Tab') {
      this.keyboardEngaged = true;
    }
    // An item's own controls (star, menu, site link) handle their own keys.
    if (!(event.target as HTMLElement).closest('[data-nav-index]')) {
      return;
    }
    if (!this.keyboardEngaged && event.key.startsWith('Arrow')) {
      event.preventDefault();
      this.keyboardEngaged = true;
      this.itemAt(container, this.currentIndex)?.scrollIntoView({
        block: 'nearest',
      });
      return;
    }
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        this.select(Math.min(this.currentIndex + 1, count - 1));
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.select(Math.max(this.currentIndex - 1, 0));
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        let index = nearestNavIndexInRow(
          container,
          this.currentIndex,
          event.key === 'ArrowDown' ? 1 : -1,
        );
        if (index !== undefined) {
          this.select(index);
        }
        break;
      }
      case 'Enter':
        event.preventDefault();
        // New Workspace opens a modal whose Create button listens for Enter
        // on the document; this keystroke must not reach it.
        event.stopPropagation();
        this.itemAt(container, this.currentIndex)?.click();
        break;
    }
  };

  private itemAt(container: HTMLElement, index: number) {
    return container.querySelector<HTMLElement>(`[data-nav-index='${index}']`);
  }
}
