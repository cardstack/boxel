// An operation's `label`: a short, plain-text phrase for people, such as "List
// your open pull requests", shown wherever an operation is presented to
// someone — beside the request it makes, never in place of it. It is the
// author's description and nothing the realm acts on, so a fingerprint of what
// an operation sends or does leaves it out: rewording a label changes nothing
// anyone agreed to.
//
// The authoring decorator and lowering both read these, so a label the
// decorator accepts is exactly one lowering stores.

export const OPERATION_LABEL_MAX_LENGTH = 80;

// Characters that make a label something other than plain text: angle brackets,
// which open markup wherever a label is rendered as HTML, and control
// characters, line breaks among them, along with the Unicode line and paragraph
// separators.
const NOT_PLAIN_TEXT = /[<>\p{Cc}\u2028\u2029]/u;

// Why `value` is not a valid label, or undefined when it is one.
export function operationLabelProblem(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return 'a label must be a string';
  }
  if (value.trim() === '') {
    return 'a label must not be empty';
  }
  let length = [...value].length;
  if (length > OPERATION_LABEL_MAX_LENGTH) {
    return `a label must be at most ${OPERATION_LABEL_MAX_LENGTH} characters, and this one is ${length}`;
  }
  let found = NOT_PLAIN_TEXT.exec(value);
  if (found) {
    return /[<>]/.test(found[0])
      ? 'a label must be plain text, without markup'
      : 'a label must be a single line of plain text, without line breaks or control characters';
  }
  return undefined;
}

// The words an operation name is made of. An acronym stays one word, a plural
// one with its `s` (`PRs`, `URLs`), and so does a capital run that digits
// follow (`S3`, `MD5`); any other run of digits is a word of its own.
const NAME_WORD =
  /[A-Z]+\d+|[A-Z]{2,}s(?=[A-Z]|[^A-Za-z]|$)|[A-Z]{2,}(?=[A-Z][a-z]|[^A-Za-z]|$)|[A-Z]?[a-z]+|\d+|[A-Z]/g;

const KEPT_AS_WRITTEN = /^(?:[A-Z]{2,}s?|[A-Z]+\d+)$/;

// An operation's name split into words for people to read: `listOpenPRs` is
// "List open PRs", `getURL` is "Get URL". The first word is capitalized, the
// rest lowercased, and acronyms are kept as written.
export function operationNameAsWords(name: string): string {
  let words = name.match(NAME_WORD);
  if (!words) {
    return name;
  }
  return words
    .map((word, index) => {
      if (KEPT_AS_WRITTEN.test(word)) {
        return word;
      }
      let lower = word.toLowerCase();
      return index === 0 ? lower[0].toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

// What to show a person for an operation: its declared label, or its name split
// into words when it declares none.
export function operationDisplayLabel(
  name: string,
  operation?: { label?: string },
): string {
  return operation?.label ?? operationNameAsWords(name);
}
