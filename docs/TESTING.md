# Testing

OrderStash v0.1.0 is in development. Automated checks use synthetic records and
isolated browser profiles, not a real Amazon account.

Run the checks from a fresh checkout:

```sh
npm ci
npm run build
npm test -- --no-coverage
npm run audit:publication
```

See [Development](DEVELOPMENT.md#browser-tests) for complete browser setup.

| Browser mode | Coverage |
| --- | --- |
| Default | Summaries, CSV, native PDFs, independent receipts, Orders search/status, pause/resume, closed controls, optional details, live year/page updates and HTTP 429 cooldowns. |
| `ORDERSTASH_PANELS_ONLY=1` | Actual dock, detach/redock, width, year navigation, cumulative deduplication and stable History interactions. |
| `ORDERSTASH_COLLECTION_ONLY=1` | 50 summaries over five pages; terminate the worker at 30, record paused history and resume from the checkpoint. |
| `ORDERSTASH_AUTO_ONLY=1` | Persist a budget break, replace the source tab, restart the worker and let a real Chrome alarm finish collection and export 50 records; cancel another break. |
| `ORDERSTASH_PARSER_ONLY=1` | Styled summaries, details, payments, inspection and categories; correct data, no parser CSP violations or embedded-resource requests. |

Select one specialized mode at a time. The automatic-break fixture advances its
persisted deadline to a near-future time; production delays stay unchanged.
The full export workflow also fails on parser CSP violations.

Results, screenshots, downloads and profiles go under `test-output/`, which is
ignored by Git and excluded from distributions. Each run prints its result path.
Never publish browser profiles or private exports as evidence.

## Manual acceptance before distribution

1. Load the build in a separate Chrome profile. Confirm a signed-in Orders page
   supplies the correct year, count and account context.
2. Browse years and pages. Check cumulative unique records and one presentation
   per source across docking, detaching and navigation.
3. Collect summaries and compare counts and representative totals with Amazon.
   Confirm extra detail, product and tracking visits require selection.
4. Export and inspect PDFs: order number, totals, page breaks, optional header and
   footer removal. Compare important invoices directly with Amazon.
5. Check each relevant CSV format and its separate completion tracking.
6. Pause, resume, close controls and restart Chrome. Check checkpoints, download
   reconciliation and receipt deduplication.
7. Confirm budget breaks continue automatically and user Pause cancels them.
   Review naturally encountered sign-in or verification stops; do not provoke
   rate limits on a real account.
8. Browse another site while exporting. Check the dedicated invoice attachment
   and that it ends when export pauses or finishes.
9. Search and filter Orders, inspect download badges, and copy text from expanded
   History issues during polling.
10. Check Chrome's extension Errors panel for new errors, including parser CSP
    violations, and confirm the installed version and path.

Business groups, digital orders, non-English pages, seller-native PDFs, multiple
invoices per order and every declared marketplace need targeted live validation.
Fixtures do not prove complete history coverage or Amazon's permission.

The source workflow also runs typechecking, unit tests and the publication audit
on GitHub. Real-Chrome fixtures remain a separate check. Publication tests use
disposable local repositories to verify private-file rejection, staged-content
scanning, local links and build boundaries; they do not prove marketplace coverage.
