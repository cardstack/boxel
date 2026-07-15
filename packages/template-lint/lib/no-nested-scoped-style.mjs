import { Rule } from 'ember-template-lint';

// A `<style scoped>` element must be a direct child of the template root.
// glimmer-scoped-css throws during module transpilation for any other
// placement ("<style> tags must be at the root of the template, they cannot be
// nested"), so catch it here at lint time instead. We track the enclosing
// container nodes (elements and blocks) as we descend; a scoped style is only
// valid when that stack is empty (i.e. its immediate parent is the template).
export default class NoNestedScopedStyle extends Rule {
  visitor() {
    let containers = [];

    let checkStyle = (node) => {
      if (node.tag !== 'style') {
        return;
      }
      let hasScoped = node.attributes.some((attr) => attr.name === 'scoped');
      if (!hasScoped) {
        return;
      }
      if (containers.length > 0) {
        this.log({
          message:
            '`<style scoped>` must be a direct child of `<template>`, not nested inside another element or block. Nested scoped styles fail module transpilation.',
          node,
        });
      }
    };

    return {
      ElementNode: {
        enter(node) {
          checkStyle(node);
          containers.push(node);
        },
        exit() {
          containers.pop();
        },
      },
      Block: {
        enter(node) {
          containers.push(node);
        },
        exit() {
          containers.pop();
        },
      },
    };
  }
}
