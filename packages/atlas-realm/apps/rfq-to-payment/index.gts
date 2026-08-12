// AN APP SURFACE — acme's rfq-to-payment, and only that app.
//
// Instances of this app adopt from HERE, and the app decides its own versions.
// That is one line of indirection and it is what makes the §7 UPDATE button
// possible at all — but the indirection has to be PER APP, not per realm.
//
// WHY NOT ONE ADOPTION FILE FOR THE WHOLE REALM. Because a realm can host
// competing apps. A single shared surface would force every app in the realm
// onto one version of every package, so upgrading one app would silently move
// all of them — which is the exact failure §7 exists to prevent, rebuilt one
// layer up. `apps/legacy-collections/` next door pins older versions on
// purpose, and it must be able to keep them.
//
// WHY NOT LET EACH INSTANCE NAME ITS OWN VERSION. `meta.adoptsFrom.module` is
// resolved WITHOUT the realm's import map — verified: a bare specifier there
// fails with "Cannot resolve bare package specifier … no matching prefix
// mapping registered". So an instance can only carry an absolute pin, which
// writes the version into EVERY INSTANCE: a realm with forty thousand invoices
// would need forty thousand rewrites to move one package.
//
// HOW THE PINS GET HERE. The realm's `importmap.json` carries a SCOPE keyed by
// this directory, so the specifiers below resolve to this app's chosen
// Versions rather than the realm's defaults. Longest matching scope wins, which
// is the import-maps rule — no new precedence to invent.
//
// The cost, stated: this file is a hand-maintained list, and an export missing
// from it is invisible to this app's instances.
//
// ─── WHY `Invoice` COMES FROM THE KIT AND NOT FROM `northwind/records` ───────
//
// This line used to read `export { Invoice, LineItem } from 'northwind/records'`
// and it was a real bug, of the kind this corpus exists to find. It failed at
// runtime with:
//
//     field validation error: tried set Invoice as field 'invoice'
//     but it is not an instance of Invoice
//
// which reads like nonsense until you see that there were TWO `Invoice`
// classes. `ledgerworks/billing-kit` sealed `northwind/records: ^1.0.0` on a
// day when 1.1.0 was the answer, so `CollectionCase.invoice` is
// `linksTo(Invoice)` against the 1.1.0 class. The realm's map resolved this
// file's own `northwind/records` to 1.1.1. Both resolutions are CORRECT — each
// is exactly what its own seal says — and the instances they produce are
// nevertheless different types, so assigning one to the other's field fails an
// `instanceof` check that is doing its job.
//
// THE RULE THIS TEACHES, and it is the sharpest thing the slice has found:
//
//     Two versions of a COMPONENT can coexist on one page. Two versions of a
//     TYPE cannot, wherever instances of one are assigned to fields typed by
//     the other.
//
// The slice proves the first half elsewhere and on purpose — two majors of
// `openkit/controls` render side by side on the payment run, neither degraded.
// A component is called; the caller never asks what it is. A card type is
// ASSIGNED, and assignment is checked by identity, so a second copy of the
// class is not a second opinion about styling, it is a different type.
//
// So a type must have ONE resolution across everything that exchanges its
// instances, and the way to guarantee that is to take it from the package
// whose fields link to it. The kit re-exports the `Invoice` it sealed; this
// app takes that one; `CollectionCase.invoice` and this app's `Invoice` are
// then the same class by construction rather than by two maps agreeing.
//
// The alternative — pinning the realm's `northwind/records` to whatever the
// kit happened to seal — works until the kit's next release, and then breaks
// somewhere far from the edit that caused it.

export { PaymentRun } from 'acme/rfq-to-payment';
export { CollectionCase } from 'ledgerworks/billing-kit';
// Re-exported BY THE KIT, from the Version the kit sealed. See the note above:
// importing these from `northwind/records` directly resolves through the
// realm's map instead, which is a different Version and therefore a different
// class.
export { Invoice, LineItem } from 'ledgerworks/billing-kit';
