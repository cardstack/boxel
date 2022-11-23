export interface Constructable<T = unknown> {
  new (...args: unknown[]): T;
}
