/* eslint-env browser */
// The pieces the secure origin's pages are built from, drawn as the app draws
// its sign-in screens (see `shell.css`): the page around a form, its fields,
// buttons and icons. The icons' paths are boxel-ui's icon components' own,
// copied in; the realm server's `secure-origin-test.ts` checks them against
// boxel-ui's. Text is only ever set as text, never as markup, and
// nothing here sets an inline style, which the page's policy refuses.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Builds an element. An attribute that is undefined or false is left off;
// `on…` attributes add event listeners.
export function h(tag, attributes = {}, ...children) {
  let element = document.createElement(tag);
  for (let [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) {
      continue;
    }
    if (name.startsWith('on')) {
      element.addEventListener(name.slice(2), value);
    } else {
      element.setAttribute(name, value === true ? '' : value);
    }
  }
  element.append(
    ...children.filter((child) => child !== undefined && child !== false),
  );
  return element;
}

function svg(name, attributes = {}, ...children) {
  let element = document.createElementNS(SVG_NS, name);
  for (let [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  element.append(...children);
  return element;
}

// boxel-ui's BoxelIcon, the logo the app's sign-in screens show top left.
export function boxelIcon() {
  return svg(
    'svg',
    {
      width: '22',
      height: '22',
      viewBox: '0 0 22 22',
      'aria-hidden': 'true',
      'data-test-boxel-logo': '',
    },
    svg('path', {
      class: 'boxel-icon-shape',
      transform: 'translate(0 -.001)',
      d: 'M17 22H5a5.006 5.006 0 0 1-5-5V5a5.006 5.006 0 0 1 5-5h12a5.005 5.005 0 0 1 5 5v12a5.006 5.006 0 0 1-5 5M3.271 2.425a.907.907 0 0 0-.682 1.515 1 1 0 0 0 .047.052L5.85 7.18a1.68 1.68 0 0 1 .433 1.039v5.566a1.68 1.68 0 0 1-.433 1.039l-3.215 3.188a1 1 0 0 0-.049.057.923.923 0 0 0 .7 1.509.9.9 0 0 0 .673-.3l3.15-3.128a1.7 1.7 0 0 1 1.042-.429h5.7a1.7 1.7 0 0 1 1.042.429l3.187 3.16a1 1 0 0 0 .051.045.9.9 0 0 0 .58.213.924.924 0 0 0 .7-1.508l-.037-.041-.007-.007-.036-.037-3.179-3.152a1.68 1.68 0 0 1-.432-1.039V8.219a1.68 1.68 0 0 1 .433-1.039l3.118-3.092a.923.923 0 0 0-.559-1.645.9.9 0 0 0-.492.148.6.6 0 0 0-.139.1l-3.187 3.16a1.7 1.7 0 0 1-1.042.429h-5.7a1.7 1.7 0 0 1-1.042-.429L3.922 2.694l-.053-.047a.92.92 0 0 0-.598-.222',
    }),
    svg('path', {
      class: 'boxel-icon-shape',
      transform: 'translate(7.968 8.018)',
      d: 'M1.117 0H4.97a1.117 1.117 0 0 1 1.117 1.117V4.97A1.117 1.117 0 0 1 4.97 6.087H1.117A1.117 1.117 0 0 1 0 4.97V1.117A1.117 1.117 0 0 1 1.117 0',
    }),
  );
}

// boxel-ui's CheckMark icon, beside a field's "valid" hint.
function checkMarkIcon() {
  return svg(
    'svg',
    { viewBox: '5 6 10.73 8', class: 'validation-hint-icon' },
    svg('path', {
      fill: 'none',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-width': '2',
      d: 'm14.727 7-6 6L6 10.273',
    }),
  );
}

// boxel-ui's LoadingIndicator.
export function loadingIndicator(className = '') {
  return h(
    'span',
    {
      class: `loading-indicator ${className}`.trim(),
      role: 'presentation',
      'data-loading-indicator': true,
    },
    svg(
      'svg',
      { width: '15.5', height: '15.5', viewBox: '0 0 15.5 15.5' },
      svg(
        'g',
        {
          fill: 'none',
          stroke: 'currentColor',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'stroke-width': '1.5',
        },
        svg('path', {
          d: 'M7.75.75v2.8M7.75 11.95v2.8M2.801 2.801l1.981 1.981M10.718 10.718l1.981 1.981M.75 7.75h2.8M11.95 7.75h2.8M2.801 12.699l1.981-1.981M10.718 4.782l1.981-1.981',
        }),
      ),
    ),
  );
}

// A page's title. The app's is a span, laid out by where it sits, so this is
// one too, marked as the page's heading.
export function title(attributes, ...children) {
  return h(
    'span',
    {
      class: 'title',
      role: 'heading',
      'aria-level': '1',
      'data-test-secure-title': true,
      ...attributes,
    },
    ...children,
  );
}

// The app's AuthContainer: the logo top left and the page's content in a
// centred column. Replaces whatever the page showed. The page sits in a
// `plain-page` root, which `shell.css` scopes its rules to.
export function renderPage(root, ...content) {
  root.replaceChildren(
    h(
      'div',
      { class: 'plain-page' },
      h(
        'div',
        { class: 'auth', 'data-test-secure-page': true },
        h('div', { class: 'logo', 'aria-hidden': 'true' }, boxelIcon()),
        h(
          'div',
          { class: 'container' },
          h('div', { class: 'content' }, ...content),
        ),
      ),
    ),
  );
}

// The app's AuthButton: a full-width boxel-ui Button of the touch size.
// `kind` is 'primary', 'secondary' or undefined for the default.
export function authButton(
  { kind, type = 'button', className = '', ...attributes },
  ...children
) {
  let button = h(
    'button',
    {
      type,
      class:
        `boxel-button auth-btn size-touch kind-${kind ?? 'default'} ${className}`.trim(),
      ...attributes,
    },
    ...children,
  );
  return button;
}

// Shows a button busy, as a boxel-ui Button's `@loading` does, until
// `setLoading(button, false)`.
export function setLoading(button, loading) {
  button.classList.toggle('loading', loading);
  button.querySelector(':scope > [data-loading-indicator]')?.remove();
  if (loading) {
    button.prepend(loadingIndicator());
  }
}

let fieldIds = 0;

// The app's AuthFormField around a BoxelInput: a label above an input, with
// an error message under it once `setError` gives one, and a hint shown with
// a check mark while `setHint` gives one. `input` takes the input's own
// attributes. `group` draws it as a boxel-ui InputGroup instead, with text
// before and after the input.
export function field({ label, input: inputAttributes, group, testId }) {
  let id = `secure-field-${++fieldIds}`;
  let input = h('input', {
    id,
    class: group ? 'form-control' : 'boxel-input',
    ...inputAttributes,
  });
  // A BoxelInput is a grid around its input; an InputGroup is a bordered row
  // of its accessories and input, with any error under it.
  let control = group
    ? h(
        'div',
        { class: 'boxel-input-group' },
        h('span', { class: 'text-accessory username-prefix' }, group.prefix),
        input,
        h(
          'span',
          {
            class: 'text-accessory',
            'data-input-group-suffix': '',
            'data-test-input-group-suffix': '',
          },
          group.suffix,
        ),
      )
    : input;
  let container = h(
    'div',
    { class: group ? 'input-group-container' : 'input-container' },
    control,
  );
  let content = h('div', { class: 'content' }, container);
  let element = h(
    'div',
    {
      class: 'boxel-field auth-form-field vertical',
      'data-test-boxel-field': true,
      'data-test-secure-field': testId,
    },
    h(
      'div',
      { class: 'label-container' },
      h(
        'label',
        { class: 'boxel-label', for: id, 'data-test-boxel-field-label': true },
        label,
      ),
    ),
    content,
  );

  let errorElement;
  let hintElement;
  return {
    element,
    input,
    get error() {
      return errorElement?.textContent || undefined;
    },
    setError(message) {
      errorElement?.remove();
      errorElement = undefined;
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-errormessage');
      if (group) {
        control.classList.toggle(
          'boxel-input-group--invalid',
          Boolean(message),
        );
      } else {
        input.classList.toggle('invalid', Boolean(message));
      }
      input.setAttribute(
        'data-test-boxel-input-validation-state',
        message ? 'invalid' : 'initial',
      );
      if (!message) {
        return;
      }
      errorElement = h(
        'div',
        {
          class: 'error-message',
          id: `${id}-error`,
          'aria-live': 'polite',
          'data-test-boxel-input-error-message': true,
        },
        message,
      );
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-errormessage', errorElement.id);
      container.append(errorElement);
    },
    setHint(hint) {
      hintElement?.remove();
      hintElement = undefined;
      if (!hint) {
        return;
      }
      hintElement = h(
        'p',
        { class: 'validation-hint', [`data-test-${hint.testId}`]: true },
        checkMarkIcon(),
        hint.text,
      );
      content.append(hintElement);
    },
  };
}

// An error under a form, hidden while it has nothing to say.
export function errorLine(className = 'error') {
  return h('div', {
    class: className,
    role: 'alert',
    'data-test-secure-error': true,
    hidden: true,
  });
}

export function showError(element, message) {
  element.textContent = message ?? '';
  element.hidden = !message;
}

// The value of a parameter in the page's URL fragment, where a value that
// mustn't reach a server's access log travels.
export function fragmentParams() {
  return new URLSearchParams(window.location.hash.replace(/^#/, ''));
}
