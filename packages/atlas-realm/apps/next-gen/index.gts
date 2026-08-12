// AN APP SURFACE — the next-generation records app, on northwind 2.x.
//
// A third app in the same realm, pinned across a MAJOR boundary from its two
// neighbours. Its invoices have a different shape: `items` rather than `lines`,
// `label` rather than `description`, `currency` as a plain string rather than a
// field with a `.code`, plus a `billTo` that 1.x has no equivalent for.
//
// `Invoice` COMES STRAIGHT FROM THE RECORD VENDOR HERE, not from a kit, and
// that is not an exception to the rule the other two apps follow — it is the
// rule with its premise absent. A type must be taken from whatever package
// declares the fields that LINK to it, and nothing in this app links to an
// invoice: there is no collections process on 2.x yet. With no `linksTo` there
// is no identity to keep aligned, so the shortest honest path is the direct
// import. The moment a 2.x kit exists this line has to move.
export { Invoice, Charge } from 'northwind/records';
