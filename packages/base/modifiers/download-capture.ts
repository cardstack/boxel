// Makes a plain capture link work on a private realm:
//
//   <a href={{this.pdfURL}} {{downloadCapture}}>Download PDF</a>
//   <a href={{this.pdfURL}} target='_blank' {{downloadCapture}}>Open PDF</a>
//
// A left click is intercepted and the `href` is fetched through the auth
// service worker (which supplies the realm token). Without `target='_blank'`
// the bytes are saved straight to disk through a blob URL; with it, a new
// tab opens on that blob URL, so the browser's PDF viewer shows the document
// and its own download button works. That sidesteps both failures of a bare
// link: a tab navigation from another origin carries no token, and the
// viewer's download re-requests the realm URL outside the worker, receiving
// the 401 text it then offers to save as `.txt`. Modified clicks (a
// Cmd-click, a middle click) are left to the browser.
//
// While a save is in flight the element carries `aria-busy` and
// `data-download-state="pending"`; a failure leaves
// `data-download-state="error"` with the server's reason in `data-download-error`,
// and calls `onError` when given, so a card can show the message where it
// likes.
import { modifier } from 'ember-modifier';

import {
  downloadCapture as fetchAndSave,
  isPlainLeftClick,
  openCapture,
} from '../helpers/download-capture';

interface Named {
  filename?: string;
  onSaved?: (filename: string) => void;
  onError?: (message: string) => void;
}

interface Signature {
  Element: HTMLAnchorElement;
  Args: { Positional: []; Named: Named };
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
      let filename = named.filename || element.download || undefined;
      let opensTab = element.target === '_blank';
      filename = opensTab
        ? await openCapture(url, { filename })
        : await fetchAndSave(url, { filename });
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
