## What it is

**OtpInput** under the name Mantine and Chakra use. The export is the same class — `import { PinInput } from './composites'` resolves to OtpInput — so the tile exists for a port of a Mantine `PinInput` or an agent whose first guess is that word. The contract and the depth, including a known focus defect, are on **OtpInput**; this page maps the Mantine and shadcn names onto it. For a code with a resend or expiry affordance, the surrounding form owns those.

## The contract

```
@length?         — segment count (default 6); Mantine length, shadcn maxLength
@value?, @defaultValue?
@type?           — allowed character class (default 'numeric'); Mantine type
@masked?         — password dots; Mantine mask
@disabled?
@label?          — group label announced by assistive tech (default 'One-time code')
@onValueChange?  — every edit, with the joined dense string
```

**There is no `onComplete`.** Mantine and Chakra fire a second callback when the last slot lands; here the caller compares the emitted string's length to `@length` inside `@onValueChange`.

## Prior art

**Mantine `PinInput`** has `length`, `type` (`'number' | 'alphanumeric'` or a RegExp), `mask`, `placeholder`, `oneTimeCode` (sets `autocomplete`), `onComplete`, `error`, `size` and `radius`. **Chakra `PinInput`** is the same shape with `otp`, `manageFocus` and `placeholder`. **shadcn `InputOTP`** wraps input-otp: one hidden input over rendered slots, `maxLength`, `pattern`, and groups with separators.

Where this is better: the emitted value is always dense, so a caller never compacts a string with holes, and completion is announced through a status region rather than carried by colour alone.

Where it is thinner: no `placeholder`, no separator groups, no `error` state, no size or radius knobs, and the defect the OtpInput writeup records — every keystroke recreates the slot inputs and drops focus to the document, which makes keyboard entry close to unusable until it is fixed.

## Accessibility

OtpInput's: the slots sit in a `role='group'` named by `@label`, each slot is named "Digit N of M", and completion is announced once, politely, through a visually hidden status region. The focus loss on every keystroke is an accessibility defect first, and it is the alias's too.

## Theming

OtpInput's: `--pretui-otp-size` and `--pretui-otp-gap` for slot dimensions and spacing, over the kit's `--pretui-shadow-control` and `--pretui-shadow-inset` for the slot surfaces. Nothing is themed under a PinInput name.

## React ecosystem

| Mantine / Chakra / shadcn                      | Pretui                                       |
| ---------------------------------------------- | -------------------------------------------- |
| `length` / `maxLength`                         | `@length`                                    |
| `value` / `onChange`                           | `@value` / `@onValueChange`                  |
| `onComplete`                                   | compare the emitted length to `@length`      |
| `type` / `pattern`                             | `@type` (`numeric`, `alpha`, `alphanumeric`) |
| `mask`                                         | `@masked`                                    |
| `oneTimeCode` / `otp`                          | not offered                                  |
| `placeholder`, `error`, groups with separators | not offered                                  |
