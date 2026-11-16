# OrderStash privacy policy

Applies to v0.1.0. Last updated: November 15, 2026.

## Local information

OrderStash stores summaries, requested details, item and shipment information,
payment activity, export completion receipts and recent run history in IndexedDB
within the extension's Chrome profile. Records may include order numbers, dates,
item descriptions and identifiers, totals, recipient names, payment labels,
transaction amounts, vendors, invoice and tracking links, download filenames and
download identifiers. IndexedDB also holds export preferences, collection
checkpoints, summary-cache markers and cached product categories.

Chrome extension local storage holds the automatic-sidebar preference, pacing
and cooldown state, the last job's status and request, and the dedicated
invoice-tab identifier. These support resume and cleanup after an interrupted
background worker. The panel can display Amazon's account greeting; that greeting
does not create a separate library for each Amazon login.

The library separates Amazon sites within a Chrome profile, but does not separate
different Amazon logins on the same site. Use separate Chrome profiles when you
need separate libraries for different people or accounts.

Page HTML is processed transiently as inert template contents. It is not retained
as a page archive or rendered into the interface. Embedded scripts, styles and
resources are not activated by the parser.

## Sharing and network requests

OrderStash does not upload orders, run analytics or telemetry, sell data, add
affiliate tags, collect passwords, read cookie values or contact an OrderStash
server or payment service. There is no OrderStash account or subscription.

Amazon receives normal browser requests when you navigate or explicitly start
collection or invoice export, using your existing signed-in session. Amazon's
pages may make additional resource requests of their own.

Visible history summaries are saved without additional Amazon visits. Selecting
a year navigates that tab once. Collection, optional detail/category/tracking
lookups and invoice export require an explicit action. OrderStash's budget breaks
can continue that action automatically. Amazon blocks and sign-in challenges do not auto-retry.

## Permissions and debugging

Normal page access and content scripts cover the Amazon sites in the manifest.
Other permissions support local storage, downloads, access-block detection,
offscreen parsing, the side panel and break timers. See [Permissions](docs/PERMISSIONS.md).

**Chrome's debugger permission is broader than Amazon-only access; host
permissions do not restrict it to Amazon.** The code attaches it only to the
dedicated invoice tab, detaches on pause or completion, and releases it if that
tab leaves Amazon. A stored identifier supports worker-restart cleanup.

Chrome's debugging warning may remain visible while you browse another tab.
Opening that tab does not move OrderStash's attachment to it.

## Retention and control

Records remain in this Chrome profile until you clear them, clear extension data
or uninstall. Recent run history is bounded; export completion receipts remain
independent so older completed files can still be skipped. No remote backup or
account-recovery service is provided.

Use **Settings → Clear saved records and export history** to delete saved orders,
payment activity, run history, receipts and collection checkpoints across the
Amazon sites in this extension's library. Downloaded files stay on disk. Cleared
records count as unexported again, and visible orders can be saved again while
you browse Amazon.

This control keeps preferences, cached product categories, and pacing and access
cooldowns. To remove all extension-held data, clear the extension's storage or
uninstall it. Clearing records does not bypass access cooldowns.

Files are saved under `Downloads/OrderStash` through Chrome. Moving or deleting a
file does not remove its completion receipt. Shared Chrome profiles and download
directories may expose records to other people using them.

Loading the extension from a different directory may change its identity and
separate its local storage. For privacy questions, see [Security](SECURITY.md).
