import { modifier } from "ember-modifier";

const sheetScopes = new WeakMap();
let scopeCounter = 0;

export const attachStyles = modifier<{
  Args: { Positional: [CSSStyleSheet | undefined] };
}>(
  (element, [sheet]) => {
    if (!sheet) {
      return;
    }

    for (let rule of Array.from(sheet.cssRules)) {
      if (rule.selectorText === "this") {
        let className = sheetScopes.get(sheet);
        if (className == null) {
          className = "i" + scopeCounter++;
          sheetScopes.set(sheet, className);
        }
        rule.selectorText = "." + className;
        element.classList.add(className);
      }
    }

    let current: Node | null = element;
    while (current) {
      if ("adoptedStyleSheets" in current) {
        let root = current as any;
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        return () => {
          let newSheets = [...root.adoptedStyleSheets];
          newSheets.splice(root.adoptedStyleSheets.indexOf(sheet), 1);
          root.adoptedStyleSheets = newSheets;
        };
      }
      current = current.parentNode;
    }
    throw new Error(`bug: found no root to append styles into`);
  },
  { eager: false }
);
