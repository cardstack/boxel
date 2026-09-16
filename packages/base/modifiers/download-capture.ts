// Turns a plain capture link into a fetch-and-save download:
//
//   <a href={{this.pdfURL}} {{downloadCapture}}>Download PDF</a>
//
// A left click is intercepted, the `href` is fetched through the auth
// service worker (which supplies the realm token), and the bytes are saved
// from memory through a blob URL. That sidesteps both failures of a bare
// link on a private realm: a tab navigation from another origin carries no
// token, and the PDF viewer's own download button re-requests the URL
// outside the worker, so it receives the realm's 401 text and offers to save
// it as `.txt`. Modified clicks (a new tab or window, a context menu) are left
// to the browser, so "open in a new tab" still works where the worker
// controls the new tab.
//
// While a save is in flight the element carries `aria-busy` and
// `data-download-state="pending"`; a failure leaves
// `data-download-state="error"` with the server's reason in `data-download-error`,
// and calls `onError` when given, so a card can show the message where it
// likes.
import { modifier } from 'ember-modifier';

import { downloadCapture as fetchAndSave } from '../components/capture-download-button';

interface Named {
  filename?: string;
  onSaved?: (filename: string) => void;
  onError?: (message: string) => void;
}

interface Signature {
  Element: HTMLAnchorElement;
  Args: { Positional: []; Named: Named };
}

function isPlainLeftClick(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

const downloadCapture = modifier<Signature>((element, _positional, named) => {
  let pending = false;
  let onClick = async (event: MouseEvent) => {
    if (!isPlainLeftClick(event) || event.defaultPrevented) {
      return;
    }
    let url = element.href;
    if (!url) {
      return;
    }
    event.preventDefault();
    if (pending) {
      return;
    }
    pending = true;
    element.setAttribute('aria-busy', 'true');
    element.dataset.downloadState = 'pending';
    delete element.dataset.downloadError;
    try {
      let filename = await fetchAndSave(url, {
        filename: named.filename || element.download || undefined,
      });
      delete element.dataset.downloadState;
      named.onSaved?.(filename);
    } catch (e) {
      let message =
        e instanceof Error && e.message
          ? e.message
          : 'Could not download the document.';
      element.dataset.downloadState = 'error';
      element.dataset.downloadError = message;
      named.onError?.(message);
    } finally {
      pending = false;
      element.removeAttribute('aria-busy');
    }
  };
  element.addEventListener('click', onClick);
  return () => element.removeEventListener('click', onClick);
});

export default downloadCapture;
