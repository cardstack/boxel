## What it is

A value and its unit as one control: a number box beside a unit picker, where the unit decides the precision, the separators and the mark.

**MoneyInput** is this component with the units fixed to currencies. Use this one for anything else measured — weight, duration, distance, storage.

## The contract

```
@value?, @defaultValue?       — the amount, controlled or seeded
@unit?, @defaultUnit?, @units? — the unit; one entry renders a static mark,
                                 none renders a plain number
@locale?        — BCP-47 tag deciding separators, symbol placement and the readout
@precision?     — decimal places when the unit does not declare its own
@min?, @max?    — clamped on COMMIT, not while typing
@step?          — arrow-key step; a unit's own step wins
@disabled?, @invalid?, @required?
@controlId?     — supplied by Field; without it the control owns its id and label
@label?         — the amount box's name; ignored when @controlId is given
@hint?          — ghost text behind an empty box
@unitLabel?     — accessible name for the unit picker
@affix?         — 'auto' (default) draws the mark only for currencies | 'always' | 'never'
@unitControl?   — 'auto' (default) segments three or fewer units and drops to a
                  searchable select above that | 'select' | 'segmented' | 'static'
@quiet?         — suppress the spelled-out confirmation row
@onChange?      — fires with the parsed amount and the current unit
@onUnitChange?  — fires when the unit changes
```

**Bounds are clamped on commit, not while typing.** A reader halfway through `120` must be allowed to pass through `1` and `12`. Clamping on keystroke is the defect that makes a bounded number field impossible to type into.

**An empty or unparseable box reports `undefined`, never 0.** "Nothing" and "zero" are different facts, and a control that collapses them makes an empty required field indistinguishable from a deliberate zero.

**`@hint` is deliberately not a `placeholder` attribute.** A placeholder doubles as the accessible name, so a field named by its placeholder loses its name the moment you type in it.

**Changing the unit re-reports the amount in the same turn**, rounded to the new unit's precision — so a caller never holds a value at the wrong precision for a render.

**`@unitControl='auto'` picks the control from the list's length**: segmented up to three units, a searchable select above that.

## Prior art

The kit's own `fields-configuration` quantity field.

Where Pretui is better: commit-time clamping, the undefined-not-zero rule, and the unit control adapting to the number of choices rather than being one shape for two and for two hundred.

Where it is thinner: no unit conversion — changing the unit reinterprets the number, it does not convert it — no compound amounts ("5 ft 11 in"), and no per-unit min/max.

## Accessibility

- **The amount box and the unit picker are separately named**, through `@label` and `@unitLabel`, so a reader is never left with an unlabelled select beside a number.
- **`@controlId` hands naming to a wrapper.** Without one, the control renders its own visually-hidden label rather than going unnamed — the failure this arrangement exists to prevent.
- **The confirmation row spells out the value**, which is what makes locale-dependent separators safe: a reader can see that `1,200` was understood as twelve hundred and not as one point two.
- **`@quiet` removes that row**, and should only be used when the surrounding form shows the same confirmation.
- **`@invalid` paints the error and the readout still explains itself** — the state is not carried by colour alone.
- **Arrow-key stepping works on the amount box**, with the unit's own step preferred, so precision is reachable without typing.

## Theming

`--pretui-amount-align` (how the number sits against its mark), `--pretui-amount-mark-width` (the unit mark's column), `--pretui-amount-select-width` (the picker), `--pretui-destructive-ink`, `--pretui-shadow-control`, `--pretui-ease-snap`.

The two width tokens are what keep a column of amounts aligned: fixing the mark and picker widths means the digits line up down a table even when the units differ in length, which is the whole reason to have them as tokens rather than letting content size them.

The styles sit in `@layer PretComposite`, above the `PretComponent` layer that Select and SegmentedControl use, so what this component sets on them wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.
