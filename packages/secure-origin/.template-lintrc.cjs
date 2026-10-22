'use strict';

// The secure origin's policy refuses `style` attributes, so no template may
// bind or set one. Code that styles an element at run time does it through
// the CSSOM (`element.style.setProperty`), which the policy allows.
//
// A component styles itself with `<style scoped>`, which the build compiles
// into the page's stylesheet files (ADR 008 §1.4), so `<style>` is allowed in
// a template.
module.exports = {
  extends: ['recommended'],
  rules: {
    'no-inline-styles': ['error', { allowDynamicStyles: false }],
    'no-forbidden-elements': ['error', ['script', 'html', 'meta']],
  },
};
