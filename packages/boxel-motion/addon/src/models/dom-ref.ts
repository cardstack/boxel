import { assert } from '@ember/debug';

import { AnimationParticipant } from './animation-participant.ts';

// How do we make it possible to easily move DOMRefNodes around?
export class DOMRefNode {
  animationParticipant!: AnimationParticipant;
  parent: DOMRefNode | undefined = undefined;
  children: Array<DOMRefNode> = [];

  constructor(readonly element: HTMLElement) {}

  delete() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((v) => v !== this);
    }
  }
}

export function addToDOMRefTrees(
  existingNodes: Array<DOMRefNode>,
  toAdd: DOMRefNode[],
) {
  let newNodes = [...existingNodes];
  let DOMRefLookup = new Map<HTMLElement, DOMRefNode>();
  let addToDOMRefLookup = (node: DOMRefNode) => {
    DOMRefLookup.set(node.element, node);
    node.children.forEach((child) => addToDOMRefLookup(child));
  };
  for (let node of existingNodes) {
    addToDOMRefLookup(node);
  }

  // The DOMRef insertion code is optimizable... but I think it's fine for now
  // We must make sure that ancestors are added before descendants
  toAdd.sort((a, b) => {
    let bitmask: number = a.element.compareDocumentPosition(b.element);

    assert(
      'Sorting DOMRefNode additions - Document position of two compared nodes is implementation-specific or disconnected',
      !(
        bitmask & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC ||
        bitmask & Node.DOCUMENT_POSITION_DISCONNECTED
      ),
    );

    return bitmask & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  for (let node of toAdd) {
    let maybeParent: DOMRefNode | undefined;
    let searchedElement = node.element;
    while (searchedElement.parentElement) {
      maybeParent = DOMRefLookup.get(searchedElement);
      if (maybeParent) {
        break;
      }
      searchedElement = searchedElement.parentElement;
    }
    if (!maybeParent) {
      newNodes.push(node);
      DOMRefLookup.set(node.element, node);
    } else {
      maybeParent.children.push(node);
      node.parent = maybeParent;
      DOMRefLookup.set(node.element, node);
    }
  }

  return newNodes;
}
