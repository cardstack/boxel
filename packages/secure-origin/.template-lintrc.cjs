'use strict';

// The secure origin's policy refuses `style` attributes, so no template may
// bind or set one. Code that styles an element at run time does it through
// the CSSOM (`element.style.setProperty`), which the policy allows.
module.exports = {
  extends: ['recommended'],
  rules: {
    'no-inline-styles': ['error', { allowDynamicStyles: false }],
  },
};
