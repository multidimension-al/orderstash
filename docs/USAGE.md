# User guide

## Connect and select

Open Amazon's **Your Orders** page and sign in normally. Click the pinned
OrderStash icon for Chrome's native side panel. If enabled, the automatic sidebar
appears beside order-history pages. The same controls can detach into a window.

Detaching closes the dock; docking closes the detached window. Choosing the dock
disables the automatic sidebar until re-enabled in Settings. There is no floating
button over Amazon's controls.

The site, greeting, available years and displayed count come from the Orders
page. Choose **This page** or a year. A year change navigates Amazon's filter but
does not start an export. Recognizable visible summaries join your local library
without extra requests, deduplicated by site and order number.

The greeting provides page context; it does not select an account-specific
library. Different Amazon logins on the same site share this extension's library
within a Chrome profile. Use separate Chrome profiles to keep their records apart.

## PDFs and CSV

**Save invoice PDFs** reads the relevant summaries and opens invoices in a dedicated
worker tab. Chrome prints the Amazon invoice page to a PDF; this is not a direct
download of a seller-supplied PDF. Files go under
`Downloads/OrderStash/personal/<Amazon hostname>/`, with the order date and number
in each filename. The `personal` folder is fixed in the current interface; there
is no profile setup step. Chrome may add a suffix if a filename already exists.

Settings choose Letter or A4 and the optional **Exported with OrderStash** header,
which includes order number, site and export time. OrderStash hides Amazon's
navigation footer for printing; the remaining page layout follows Amazon's print
styles. Inspect important invoices against Amazon. Seller-supplied PDFs and
multiple invoices for an order may require manual export.

Chrome's debugging banner is expected during PDF printing. The permission is
broad; the code targets its dedicated invoice tab and detaches on pause or
completion. See [Permissions](PERMISSIONS.md).

For CSV, select Orders, Items, Shipments or Payments and choose **Export CSV**.
Saved summaries are reused where available. Fields absent from those summaries
stay blank unless you request additional collection.

**Export only records not saved before** keeps PDF and each CSV format independent.
An Orders CSV does not mark a PDF or Items CSV as exported. Payment activity is
collected through **Collection options → Read payment activity separately**;
choose a year first. Export the saved activity with **Payments CSV**. If no
separately collected activity is available, that CSV uses payment descriptions
from requested order details instead. The columns differ between these sources.

CSV files go directly under `Downloads/OrderStash`, named for the format and
export date. Chrome may add a suffix to preserve earlier downloads.

## Saved orders and history

**Orders** shows dates, numbers, item descriptions, totals and separate export
statuses. Search by number, item or date. Show the current selection or all saved
years for this site. The order number opens the order on Amazon.

Choose **PDF not exported** to find remaining invoices. Select an exported badge
to show its Chrome download when an identifier is available. These statuses mean
Chrome confirmed completion; they do not track later file moves or deletions.
Other CSV formats appear on the record when exported.

The export-status filter can show all orders, PDFs exported or not exported,
and Orders CSV not exported. It does not offer a separate filter for every CSV
format. Saved orders are displayed 50 at a time with **Previous** and **Next**.

Search and filters make no Amazon requests. Records and receipts outlive the
shorter recent-run History list. **History** shows collections, exports, pauses,
downloads and real issues. Expanded issues and copied text survive status polling.

## Optional collection

**Load summaries without exporting** follows actual history pagination for the
selection. It does not fetch each order's detail page by default.

- **Read extra order details:** adds requested tax, refund, payment and shipment fields.
- **Look up product categories:** adds product-page visits; requires extra details.
- **Look up tracking IDs:** adds tracking-page visits; requires extra details.

Missing fields can remain blank. Summary collection pauses when it cannot
establish page coverage. Individual detail or PDF failures can be recorded in
History while other orders continue; check the issues before treating an export
as complete. The cumulative library count differs from the count for the selected
page or year.

## Pauses, breaks and resume

**Pause** finishes the current page or download, saves progress and stops visits.
It is a normal status, not an issue. **Resume** finds a valid open Orders tab and
uses saved checkpoints and receipts without a separate refresh action.

By default, visits are randomly spaced 6–9 seconds apart. After 60 visits,
OrderStash takes a five-minute break and continues automatically. Settings change
the minimum delay and budget. Pause during a break cancels its continuation.

Amazon HTTP 403, 429 or 503 responses stop work with at least a 30-minute access
cooldown, extended by a longer Retry-After response. Sign-in and verification
challenges require review. These conditions do not auto-retry.

Closing the controls does not stop active work. Chrome must stay open. If Chrome
or its background worker stops, saved progress is retained and running History
entries become paused on restart. Resume reconciles pending downloads and finishes
interrupted summary collection before starting an export.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Open Orders prompt | Open a signed-in Orders tab. Resume can recover a closed or changed source tab. |
| No new PDFs | Check Orders statuses. Disable only-new exports if another copy is intended. |
| Budget break | Wait for its continuation time or Pause to cancel. Chrome must be running. |
| Amazon verification/cooldown | Review Amazon, wait for the indicated cooldown, then Resume. Repeated starts do not bypass it. |
| Previous download in progress | Finish or cancel it in Chrome Downloads before resuming. |
| Debugging banner | Expected while printing PDFs; cancelling the attachment can interrupt export. |
| Code changes not reflected | Pause or finish, rebuild, reload at `chrome://extensions`, and refresh Amazon. Clear old Errors entries before checking for new ones. |
| Missing or wrong fields | Compare with Amazon and report a redacted layout example. Some digital, seller, Business or localized layouts need manual export. |

**Settings → Clear saved records and export history** clears the library across
Amazon sites and resets completion tracking. It keeps downloaded files,
preferences, cached product categories and access cooldowns. Visible orders can
join the library again while you browse. Read [Privacy](../PRIVACY.md) for
retention and sharing details.
