/* A bounded set that automatically removes the oldest entries when it reaches a maximum size */
export default class LimitedSet<T> implements Iterable<T> {
  private itemMap = new Map<T, number>(); // Maps items to their insertion order
  private insertionOrder = 0; // Counter for tracking insertion order
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  add(item: T): void {
    // If item already exists, just update its position to be newest
    if (this.itemMap.has(item)) {
      this.itemMap.set(item, this.insertionOrder++);
      return;
    }

    // Add new item with current insertion order
    this.itemMap.set(item, this.insertionOrder++);

    // If we've exceeded max size, remove oldest item
    if (this.itemMap.size > this.maxSize) {
      let oldestItem: T | undefined;
      let oldestOrder = Infinity;

      // Find the item with the lowest insertion order
      for (const [mapItem, order] of this.itemMap.entries()) {
        if (order < oldestOrder) {
          oldestOrder = order;
          oldestItem = mapItem;
        }
      }

      if (oldestItem !== undefined) {
        this.itemMap.delete(oldestItem);
      }
    }
  }

  has(item: T): boolean {
    return this.itemMap.has(item);
  }

  delete(item: T): boolean {
    return this.itemMap.delete(item);
  }

  clear(): void {
    this.itemMap.clear();
    this.insertionOrder = 0;
  }

  get size(): number {
    return this.itemMap.size;
  }

  values(): IterableIterator<T> {
    return this.itemMap.keys();
  }

  toArray(): T[] {
    return Array.from(this.itemMap.keys());
  }

  [Symbol.iterator](): Iterator<T> {
    return this.itemMap.keys();
  }
}
