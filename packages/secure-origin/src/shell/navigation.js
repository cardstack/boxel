/* eslint-env browser */
// Where the sign-in pages send the window: another of the shell's modes, or
// Google. Every navigation they make goes through here, so a test of a page
// can see where it would have gone without leaving the test.
export const navigation = {
  assign(url) {
    window.location.assign(url);
  },
  replace(url) {
    window.location.replace(url);
  },
};
