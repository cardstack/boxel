// Keeps the test page visible. The credential frame hides its page until the
// app has sent it styles (`html:not(.styled) body`), and that rule is in the
// stylesheet the whole suite shares, so an unstyled test page is hidden, and
// nothing in a hidden page can take focus.
export function setupVisiblePage(hooks: NestedHooks) {
  let styled: boolean;
  hooks.beforeEach(function () {
    styled = document.documentElement.classList.contains('styled');
    document.documentElement.classList.add('styled');
  });
  hooks.afterEach(function () {
    document.documentElement.classList.toggle('styled', styled);
  });
}
