// AN APP SURFACE — the collections app that has not been re-qualified.
//
// Same realm as `apps/rfq-to-payment/`, DELIBERATELY OLDER PINS. This app was
// signed off against northwind 1.0 and ledgerworks 1.0 and its operators have
// not re-tested against anything since. It sits beside a fully current app, in
// one realm, and neither disturbs the other.
//
// That is the whole reason app surfaces are per-app. With one shared adoption
// file this app would be dragged forward the moment its neighbour upgraded,
// and the realm lock would be governing apps rather than serving them.
//
// The difference is visible rather than notional: northwind's 1.0 line has no
// fitted or embedded format, so a linked invoice here renders as a bare title
// chip where the current app draws a real card; and
// cardstack/contracts@1.0.0 stamps its version into every money value
// unconditionally, which 1.1.0 made opt-in. Both are what those Versions
// actually were.
//
// ─── ON THE MAINTENANCE LINE, NOT FROZEN AT .0 ──────────────────────────────
//
// The scope pins `northwind/records@1.0.1` and `ledgerworks/billing-kit@1.0.1`
// — backports published AFTER the 1.2/1.3 releases, carrying one fix each and
// no features. That is what a supported old release actually looks like, and
// it is a better demonstration than freezing at `.0` would be: this app took a
// patch and declined a feature release, which is a decision its operators can
// make precisely because the two are separable.
//
// The fix in question was that every card here reported itself as "Untitled
// Invoice" / "Untitled Collection Case". Worth backporting because "old" and
// "broken" read very differently to somebody being shown this, and only one of
// them is true. The 1.0 line is still visibly poorer than the current app.
// It is no longer lying about its own name.
//
// ─── `Invoice` COMES FROM THE KIT ───────────────────────────────────────────
//
// Same reason as the neighbouring app, and the reason is worth reading there:
// a card TYPE must have one resolution across everything that exchanges its
// instances, or `linksTo` fails an `instanceof` check between two classes that
// are each individually correct. The kit re-exports the `Invoice` it sealed,
// so `CollectionCase.invoice` and this app's `Invoice` are the same class by
// construction.

export { CollectionCase } from 'ledgerworks/billing-kit';
export { Invoice, LineItem } from 'ledgerworks/billing-kit';
