/* eslint-env browser */
// Where the shell's pages send the window: another of the shell's modes,
// Google, or away, by closing it. Every navigation they make goes through
// here, so a test of a page can see where it would have gone without leaving
// the test.
export const navigation = {
  assign(url) {
    window.location.assign(url);
  },
  replace(url) {
    window.location.replace(url);
  },
  // Closes the window. A window the user opened themselves, rather than one
  // a page opened, can't be closed by script and stays as it is.
  close() {
    window.close();
  },
};
