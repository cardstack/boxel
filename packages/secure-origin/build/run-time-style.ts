// What code does at run time that the policy refuses as inline style. The
// build record marks each shipped module whose rendered code does one of
// these (`build-record.ts`), and `pret-ui-lint.ts` refuses them in the Pret UI
// modules the package imports.
export const STYLES_AT_RUN_TIME: [RegExp, string][] = [
  [/createElement\(\s*['"`]style['"`]\s*\)/, 'creates a <style> element'],
  [/setAttribute\(\s*['"`]style['"`]/, 'sets a style attribute'],
];

// A comment that mentions a `<style>` element is not one, so comment lines
// are left out.
export function withoutCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

// What `code` does, of `STYLES_AT_RUN_TIME`, in its order.
export function stylesAtRunTime(code: string): string[] {
  let found = withoutCommentLines(code);
  return STYLES_AT_RUN_TIME.filter(([pattern]) => pattern.test(found)).map(
    ([, does]) => does,
  );
}
