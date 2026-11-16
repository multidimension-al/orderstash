# Permissions

OrderStash helps users save their own Amazon order records and invoice PDFs locally.

| Permission | Use |
| --- | --- |
| Amazon host access | Reads visible history and requested detail, invoice, product or tracking pages using the existing browser session. |
| `scripting` | Captures page data and prepares the dedicated invoice page for printing. |
| `storage` | Uses Chrome extension local storage for the sidebar preference, last job, pacing, cooldowns and invoice-tab identifier. Order records, export preferences and collection checkpoints use IndexedDB. |
| `downloads` | Saves PDF/CSV files, verifies completion and shows recorded downloads when requested. |
| `debugger` | Uses Chrome's native `Page.printToPDF` API. The permission is broad and is not confined to Amazon by host permissions. |
| `webRequest` | Observes access blocks in owned worker tabs on supported Amazon sites; does not rewrite requests or replace links. |
| `offscreen` | Provides a local document for inert snapshot parsing and temporary export blobs. |
| `sidePanel` | Provides the docked controls. |
| `alarms` | Continues work after OrderStash's own budget break; does not retry Amazon blocks or challenges. |

## Debugger behavior

The code creates a dedicated invoice tab, attaches by its identifier and sends
PDF commands to that identifier. It detaches on pause or completion, releases the
attachment if that tab leaves Amazon, and records the identifier for worker-restart cleanup.

The warning can remain visible while another tab is active. Opening another site
does not move the attachment. This implementation choice does not narrow the
capabilities of the underlying permission. See Chrome's [debugger reference](https://developer.chrome.com/docs/extensions/reference/api/debugger).

## Declared sites

Content scripts and ordinary host access cover the `www` HTTPS hosts on:

`amazon.com`, `amazon.ca`, `amazon.co.uk`, `amazon.co.jp`, `amazon.com.au`,
`amazon.com.be`, `amazon.com.mx`, `amazon.ae`, `amazon.de`, `amazon.es`,
`amazon.fr`, `amazon.in`, `amazon.ie`, `amazon.it`, `amazon.nl`, `amazon.sa`.

The manifest is the source of truth. Host coverage is not proof that every layout
has been validated. See [Testing](TESTING.md) and [Privacy](../PRIVACY.md).
