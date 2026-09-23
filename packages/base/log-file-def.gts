import LogsIcon from '@cardstack/boxel-icons/logs';
import StringField from './string';
import { bxl, operation, type OperationDeclaration } from './operations';
import { TextFileDef } from './text-file-def';

// A `.log` file: plain text that grows one line at a time.
//
// Reading one is the text family's job, so this inherits `TextFileDef`'s
// extraction and rendering whole and adds the one thing a log needs that a
// text file does not — a way to write to it where the realm, not the caller,
// says when and by whom.
export class LogFile extends TextFileDef {
  static displayName = 'Log File';
  static icon = LogsIcon;
  // mime-db resolves `.log` to `text/plain`, so the file chooser offers logs
  // by extension first and by that type second.
  static acceptTypes = '.log,text/plain';
  static textExtensions: readonly string[] = ['.log'];
  static fileKind = 'Log';

  // The caller says what happened. The realm says when, and who.
  //
  // An `appendLine` usually declares a `line` param, which makes the whole
  // line the caller's to write — including the part naming who wrote it. An
  // `input` program is the other spelling: it *produces* the line, so the
  // timestamp and the authenticated actor are composed where a caller cannot
  // reach them, and a `line` in the payload is overwritten rather than
  // honoured.
  //
  // `. +` merges into the payload rather than replacing it, which is the form
  // that leaves the declared params in place beside the line it adds.
  //
  // `NOW()` answers an Excel serial rather than a timestamp, so it is
  // formatted here; unformatted it would append a number like `46023.518`.
  @operation static record = {
    base: 'appendLine',
    params: { what: StringField },
    input: bxl`. + { line: (TEXT(NOW(); "yyyy-mm-dd hh:mm:ss") + " " + actor() + " " + params("what")) }`,
  } satisfies OperationDeclaration;
}

export default LogFile;
