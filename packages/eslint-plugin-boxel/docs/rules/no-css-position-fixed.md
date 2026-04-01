# Disallow `position: fixed` in card CSS because cards should not break out of their bounding box (`@cardstack/boxel/no-css-position-fixed`)

💼 This rule is enabled in the ✅ `recommended` config.

<!-- end auto-generated rule header -->

Disallow `position: fixed` in CSS within card templates. Cards are rendered inside containers where fixed positioning doesn't behave as expected.
