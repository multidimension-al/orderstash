# OrderStash

![OrderStash logo](docs/brand/orderstash-logo.png)

Save Amazon invoice PDFs and export orders to CSV, directly beside your order
history in Chrome. PDFs are free. Your records stay in your Chrome profile.

**v0.1.0 · In development · Not yet published to the Chrome Web Store**

## Features

- Save original Amazon invoice pages as PDFs, with an optional OrderStash header.
- Export orders, items, shipments and payment records to CSV.
- Build a local library as you browse, deduplicated by Amazon site and order number.
- Search saved orders and check separate PDF and CSV completion statuses.
- Skip completed exports, pause safely, and resume interrupted work.
- Read history summaries first; extra details, categories and tracking are optional.
- Use randomized sequential visits and automatic budget breaks. Amazon blocks
  and sign-in challenges require review and do not auto-retry.

Use Chrome's native side panel, the automatic order-history sidebar, or a
detached window. No separate account, subscription or hosted dashboard is needed.

## Install from source

Requirements: **Chrome 120 or later** and **Node.js 22 or later** with npm.

1. Clone this repository or download and extract its source archive.
2. Open a terminal in the repository directory and run:

   ```sh
   npm ci
   npm run build
   ```

   In Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

3. Open `chrome://extensions` and enable **Developer mode**.
4. Choose **Load unpacked** and select the generated **build** directory.
5. Pin OrderStash to the toolbar and open Amazon's **Your Orders** page.

The source archive must be built before installation. Keep the unpacked path
stable: moving it can change the extension's identity and separate its local records.

## Start exporting

1. Open **Your Orders** on Amazon, then click OrderStash's toolbar icon.
2. Select the current page or an available year. Selecting a year navigates
   Amazon's filter; it does not begin an export.
3. Choose **Save invoice PDFs**, or select a CSV format and **Export CSV**.
4. Open **Orders** to search saved records and inspect each export status.
5. Use **Pause** or **Resume** as needed. Closing the controls does not cancel
   active work; closing Chrome interrupts it and preserves saved progress.

Files go under `Downloads/OrderStash`. **Export only records not saved before**
tracks PDF and each CSV format independently. Read the [user guide](docs/USAGE.md)
for controls, optional collection and troubleshooting.

PDFs are printed from Amazon's invoice pages. Seller-supplied PDF files may need
manual download. The library separates Amazon sites, but different Amazon logins
on the same site share records within a Chrome profile; use separate Chrome
profiles when you need account separation.

## Privacy and permissions

OrderStash stores records locally. It does not upload orders, collect passwords,
read cookie values, run analytics or add affiliate tags. Amazon requests use
your existing signed-in browser session.

Native PDF printing requires Chrome's **debugger** permission. Chrome displays a
browser-wide warning while it is attached. That permission is broad; the code
uses it only on the dedicated invoice tab and detaches on pause, completion or
navigation away from Amazon. Opening another site does not move the attachment.

Read the [privacy policy](PRIVACY.md) and [permission explanations](docs/PERMISSIONS.md).

## Limitations

Amazon changes its layouts. Not every marketplace, Business group, digital order,
seller-provided invoice or payment layout has been validated. Multiple invoices
for an order may require manual export. Compare important records with Amazon.

Export status records completed downloads; it does not check whether you later
moved or deleted a file. Clearing local records also clears completion tracking.

Randomized pacing does not establish Amazon's permission or guarantee that an
account will avoid restrictions. Review Amazon's [Conditions of Use](https://www.amazon.com/gp/help/customer/display.html?nodeId=GLSBYFE9MGKKQXXM)
before choosing automated collection.

## Documentation

- [Development and browser tests](docs/DEVELOPMENT.md)
- [Testing and manual checks](docs/TESTING.md)
- [Contributing](CONTRIBUTING.md)
- [Security reports](SECURITY.md)
- [Changes](CHANGELOG.md)

## Repository layout

| Folder | Contents |
| --- | --- |
| `src/` | Extension code, pages, styles and finished assets. |
| `tests/` | Unit tests with synthetic order data. |
| `scripts/` | Build, browser fixtures and publication checks. |
| `docs/` | User, permission, development and testing guides. |

`build/` is generated locally. Downloads, browser profiles and test results are
excluded from the public source. GitHub checks build and audit the source on
pushes and pull requests; real-Chrome checks are described in the testing guide.

Licensed under [Apache-2.0](LICENSE). Required third-party acknowledgments are
retained in [NOTICE](NOTICE).
