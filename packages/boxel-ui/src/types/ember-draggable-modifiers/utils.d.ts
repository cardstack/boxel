declare module 'ember-draggable-modifiers/utils/array' {
  export function insertAfter<T>(array: T[], index: number, element: T): T[];
  export function insertAt<T>(array: T[], index: number, element: T): T[];
  export function insertBefore<T>(array: T[], index: number, element: T): T[];
  export function removeAt<T>(array: T[], index: number): T[];
  export function removeItem<T>(array: T[], item: T): T[];
}
