import { modifier } from "ember-modifier";

const sheetScopes = new WeakMap();
let scopeCounter = 0;

export function initStyleSheet(cssText: string) {
  let sheet: CSSStyleSheet | undefined;
  if (typeof CSSStyleSheet !== "undefined") {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
  }
  return sheet;
}

export const attachStyles = modifier<{
  Args: { Positional: [CSSStyleSheet | undefined] };
}>(
  (element, [sheet]) => {
    if (!sheet) {
      return;
    }

    let className = sheetScopes.get(sheet);
    for (let rule of Array.from(sheet.cssRules) as CSSStyleRule[]) {
      if (rule.selectorText === "this") {
        if (className == null) {
          className = "i" + scopeCounter++;
          sheetScopes.set(sheet, className);
        }
        rule.selectorText = "." + className;
      }
    }

    if (className) {
      element.classList.add(className);
    }

    let current: Node | null = element;
    while (current) {
      if ("adoptedStyleSheets" in current) {
        let root = current;
        root.adoptedStyleSheets = [...root.adoptedStyleSheets!, sheet];
        return () => {
          let newSheets = [...root.adoptedStyleSheets!];
          newSheets.splice(root.adoptedStyleSheets!.indexOf(sheet), 1);
          root.adoptedStyleSheets = newSheets;
        };
      }
      current = (current as Node).parentNode;
    }
    throw new Error(`bug: found no root to append styles into`);
  },
  { eager: false }
);
