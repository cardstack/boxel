// What code does at run time that the policy refuses as inline style. The
// build record marks each shipped module whose rendered code does one of
// these (`build-record.ts`), and `pret-ui-lint.ts` refuses them in the Pret UI
// modules the package imports.
//
// Each pattern is a DOM call that names `style` literally: `createElement`
// and `createElementNS` with the tag, and `setAttribute` and `setAttributeNS`
// with the attribute. HTML ignores the case of both names, so the patterns
// do too. A name the code computes, or markup written as a string (through
// `innerHTML` or `insertAdjacentHTML`), isn't seen. The policy test catches
// those on the paths a page it loads takes.
const NAMED_STYLE = String.raw`['"\x60]style['"\x60]`;
// The namespace argument of a `…NS` call.
const NAMESPACE = String.raw`(?:[^,()]+,\s*)?`;

export const STYLES_AT_RUN_TIME = [
  {
    pattern: new RegExp(
      String.raw`createElement(?:NS)?\(\s*${NAMESPACE}${NAMED_STYLE}\s*\)`,
      'i',
    ),
    does: 'creates a <style> element',
    refusal:
      'creates a <style> element at run time, which the policy refuses as inline style',
  },
  {
    pattern: new RegExp(
      String.raw`setAttribute(?:NS)?\(\s*${NAMESPACE}${NAMED_STYLE}\s*,`,
      'i',
    ),
    does: 'sets a style attribute',
    refusal:
      'sets a style attribute at run time, which the policy refuses; set properties through the CSSOM (`element.style.setProperty`)',
  },
] as const;

export type StyleAtRunTime = (typeof STYLES_AT_RUN_TIME)[number];

// What `code` does, of `STYLES_AT_RUN_TIME`, in its order.
export function stylesAtRunTime(code: string): StyleAtRunTime[] {
  return STYLES_AT_RUN_TIME.filter(({ pattern }) => pattern.test(code));
}
