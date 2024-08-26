const noDirectLocalStorage = require('./mock-window-only');

module.exports = {
  rules: {
    'mock-window-only': noDirectLocalStorage,
  },
};
