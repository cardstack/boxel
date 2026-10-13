// An operation's `label`: a short, plain-text phrase for people, such as "List
// your open pull requests", for whatever presents an operation to someone to
// show beside the request it makes, never in place of it. It is the author's
// description and changes nothing about what the operation does.
//
// The authoring decorator and lowering both read these, so a label the
// decorator accepts is exactly one lowering stores.

export const OPERATION_LABEL_MAX_LENGTH = 80;

// Characters that make a label something other than plain text: angle brackets,
// which open markup wherever a label is rendered as HTML; control characters,
// line breaks among them, and the Unicode line and paragraph separators; and the
// bidirectional controls, which reorder how the text around them displays and
// so let a label read differently from what it says. Other invisible formatting
// characters, the joiners in an emoji sequence among them, are left alone.
const NOT_PLAIN_TEXT =
  /[<>\p{Cc}\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

// Half of a UTF-16 surrogate pair with no other half. It encodes no character,
// and the definition cache is stored as JSONB, which refuses one.
const LONE_SURROGATE = /\p{Cs}/u;

// What a label must have besides: something visible, not only whitespace and
// formatting characters.
const INVISIBLE = /[\s\p{Cf}]/gu;

// The part of `Intl.Segmenter` counting a label needs, described here because
// several packages compile this module against a `lib` that predates it.
interface GraphemeSegmenter {
  segment(input: string): Iterable<unknown>;
}
const { Segmenter } = Intl as unknown as {
  Segmenter: new (
    locales: undefined,
    options: { granularity: 'grapheme' },
  ) => GraphemeSegmenter;
};

// A label's length as a person counts it: one per character they see, so a
// flag or an emoji sequence counts once.
function visibleLength(value: string): number {
  let segmenter = new Segmenter(undefined, { granularity: 'grapheme' });
  return [...segmenter.segment(value)].length;
}

// Why `value` is not a valid label, or undefined when it is one.
export function operationLabelProblem(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return 'a label must be a string';
  }
  if (LONE_SURROGATE.test(value)) {
    return 'a label must be well-formed text, without unpaired surrogate halves';
  }
  if (value.replace(INVISIBLE, '') === '') {
    return 'a label must not be empty';
  }
  let length = visibleLength(value);
  if (length > OPERATION_LABEL_MAX_LENGTH) {
    return `a label must be at most ${OPERATION_LABEL_MAX_LENGTH} characters, and this one is ${length}`;
  }
  let found = NOT_PLAIN_TEXT.exec(value);
  if (found) {
    if (found[0] === '<' || found[0] === '>') {
      return 'a label must be plain text, without markup';
    }
    return /\p{Cc}|[\u2028\u2029]/u.test(found[0])
      ? 'a label must be a single line of plain text, without line breaks or control characters'
      : 'a label must be plain text, without bidirectional controls that reorder how it displays';
  }
  return undefined;
}

// The words an operation name is made of. An acronym stays one word, a plural
// one with its `s` (`PRs`, `URLs`), and so does a capital run that digits
// follow (`S3`, `MD5`); any other run of digits is a word of its own. Letters
// are any script's: a word is an optional capital and the uncased or lowercase
// letters after it, with their combining marks.
const NAME_WORD =
  /\p{Lu}+\p{Nd}+|\p{Lu}{2,}s(?=\p{Lu}|\P{L}|$)|\p{Lu}{2,}(?=\p{Lu}[\p{Ll}\p{Lo}]|\P{L}|$)|\p{Lu}?[\p{Ll}\p{Lo}\p{Lm}][\p{Ll}\p{Lo}\p{Lm}\p{M}]*|\p{Nd}+|\p{Lu}/gu;

const KEPT_AS_WRITTEN = /^(?:\p{Lu}{2,}s?|\p{Lu}+\p{Nd}+)$/u;

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
      if (index > 0) {
        return lower;
      }
      let [first, ...rest] = lower;
      return first.toUpperCase() + rest.join('');
    })
    .join(' ');
}

// What to show a person for an operation: its declared label, or its name split
// into words when it declares none. The operation is any entry naming its
// operations, a declaration, a lowered definition or a built-in nothing
// declared, which carries no label.
export function operationDisplayLabel(
  name: string,
  operation?: object,
): string {
  let label = (operation as { label?: unknown } | undefined)?.label;
  return typeof label === 'string' ? label : operationNameAsWords(name);
}
