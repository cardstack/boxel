# Reordering Lists and Grids

Reordering combines two responsibilities: an item follows the hand, and the surrounding layout makes room for its new position. `ReorderGroup` and `ReorderItem` provide that coordination while your component remains responsible for the actual ordered collection. Stable values make the moving item the same item before, during, and after the gesture.

## Binding the Collection

Give the group its current values and an update callback. The group yields its context; pass that context to each item through `@group`, along with the corresponding `@value`. Each item renders its own draggable list element. Read the existing list and grid examples for the exact template composition used in this repository; these components are list elements, rather than generic wrappers with a React-style `as` prop.

The essential data flow is simple:

```ts title="Component logic excerpt"
// Component state and callback used by a ReorderGroup:
@tracked items = ['Atlas', 'Ember', 'Flux'];
reorder = (next: string[]) => { this.items = next; };
```

Use stable object identities or stable primitive values. Recreating every object during a drag makes identity harder to preserve and can turn a move into a series of removals and insertions. The component's rendered order should follow the same collection that the group uses to calculate reordering.

## Understanding the Layout

The group provides the layout observation needed for neighboring items to move as the dragged item crosses them. Keep the actual item dimensions representative of production content. Equal-height sample rows can hide problems that appear when a row expands, wraps onto multiple lines, or contains an editor.

A grid adds another dimension to the placement decision. The repository's grid demo demonstrates the existing implementation, including a button that changes order without a drag. That second path is valuable: it checks that the data model and layout animation agree independently of pointer input, and it can form the basis of an accessible alternate control.

## Testing the Interaction

Verify more than the final array. During the drag, the active item's position should remain continuous, adjacent items should move into useful openings, and the pointer should remain attached to the same item. After release, wait with `animationsSettled()` before checking the final arrangement. Use the test-support bounds helpers when asserting geometry inside QUnit.

Also test scrolling near the edge of a long list, dragging within a transformed parent, and removing an item while another transition is active. Those conditions expose ownership and measurement errors that a short static list will not reveal. Keep styles that Motion must correct, such as a projected border radius, in the modifier's style values. The reorder feature is built on the same motion and projection system as the rest of the library, so its style and lifecycle rules still apply.

## API Coverage

**glimmer-motion**: `ReorderGroup`, `ReorderItem`, `ReorderAxis`, `ReorderContextProps`.

Read the implementation: [`group.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/reorder/group.gts), [`item.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/reorder/item.gts), [`types.ts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/reorder/types.ts).
