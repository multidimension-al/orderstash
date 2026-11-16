# Development

## Setup

Use Node.js 22 or later with npm, and Chrome 120 or later. Browser tests also
need a matched Chrome for Testing and ChromeDriver pair.

From a Git checkout:

```sh
npm ci
npm run build
npm test -- --no-coverage
npm run audit:publication
```

In Windows PowerShell, use `npm.cmd` if policy blocks `npm.ps1`. There are no
production npm dependencies. Load `build/` through **Load unpacked** at
`chrome://extensions`. Keep the path stable. To update, finish or pause, rebuild,
reload the extension and refresh Amazon. Reload picks up manifest/permission changes.

The current development version is 0.1.0.

An extracted source archive can be installed with `npm ci` and `npm run build`.
Initialize a Git repository if you also want to run the publication audit.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check source and test TypeScript. |
| `npm test -- --no-coverage` | Run unit tests. |
| `npm run build` | Typecheck and generate the unpacked extension. |
| `npm run audit:publication` | Check all Git-eligible files, staged contents, documentation, versions and the generated build. Requires a Git checkout. |
| `npm run test:browser` | Exercise real Chrome APIs against local HTTPS fixtures. |
| `npm run package` | Audit the build and create an extension ZIP under `artifacts/`. |

## Browser tests

Synthetic fixtures run on local HTTPS with isolated Chrome profiles. The test
browser maps `www.amazon.com` to loopback and does not use a real Amazon account.
Port 443 must be available on the selected loopback address and the system must
permit that binding.

Install matched executables from [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/).
They are not bundled in this repository. Set your own paths:

```powershell
$env:ORDERSTASH_CHROME = 'C:\Tools\ChromeForTesting\chrome.exe'
$env:ORDERSTASH_DRIVER = 'C:\Tools\ChromeDriver\chromedriver.exe'
$env:ORDERSTASH_PANELS_ONLY = '0'
$env:ORDERSTASH_COLLECTION_ONLY = '0'
$env:ORDERSTASH_AUTO_ONLY = '0'
$env:ORDERSTASH_PARSER_ONLY = '0'
npm.cmd run test:browser
```

Unix-like shells use the same variables with appropriate executable paths:

```sh
ORDERSTASH_CHROME=/opt/chrome/chrome \
ORDERSTASH_DRIVER=/opt/chromedriver/chromedriver \
npm run test:browser
```

All mode variables unset or `0` runs the full export workflow. Set exactly one
to `1` for a specialized check:

| Variable | Workflow |
| --- | --- |
| `ORDERSTASH_PANELS_ONLY` | Native dock, handoff, History and live context. |
| `ORDERSTASH_COLLECTION_ONLY` | 50 summaries and interruption at 30. |
| `ORDERSTASH_AUTO_ONLY` | Real break alarm, restart and replacement source tab. |
| `ORDERSTASH_PARSER_ONLY` | Styled snapshots, extraction and CSP. |

`ORDERSTASH_FIXTURE_HOST` selects a loopback address, default `127.0.0.1`.
Separate addresses can isolate parallel servers where supported. Each run prints
its result path under `test-output/`. Profiles, logs and private exports stay out of Git.

## Structure

| Path | Responsibility |
| --- | --- |
| `src/app/background.ts` | Chrome messages, source context, jobs and alarms. |
| `src/app/engine.ts` | Collection, enrichment, exports and checkpoints. |
| `src/app/vault.ts` | Local orders, receipts and run history. |
| `src/app/content.ts` | Visible-page capture and embedded presentation. |
| `src/app/panel.ts` | Shared docked, embedded and detached controls. |
| `src/app/extract.ts` | Inert HTML extraction. |
| `src/app/pace.ts` | Randomized visits, budgets and cooldowns. |
| `src/invoices/` | Invoice validation and native PDF generation. |
| `scripts/fixtures.cjs` | Synthetic public test data. |
| `scripts/build.cjs` | Generated extension and documentation. |

The current interface uses the fixed internal profile ID `personal`; it has no
profile manager or Amazon-account selector. Library keys combine that ID, the
Amazon hostname and order number. IndexedDB holds records, export settings,
checkpoints and category caches; Chrome extension local storage holds sidebar,
job, pacing and invoice-attachment state. Account greetings supply display context
and are not an account-isolation boundary.

Read [Testing](TESTING.md) and [Contributing](../CONTRIBUTING.md)
before changing behavior. Keep local notes, prompts, transcripts and generated
test output out of commits. The publication audit also rejects known private
paths that have been force-added despite `.gitignore`.

## Public source checks

The publication check requires Git and stops if the Git inventory cannot be read.
Building an extracted source archive still works without Git; initialize a local
repository first if you also want to run the publication check.

The public inventory is defined in `scripts/publication-files.cjs`. New files
outside that inventory require a deliberate update. The audit scans working files,
staged contents and the generated extension for prior branding outside the required
notice, likely credentials, workstation paths and conversation records. It also
checks local documentation links and rejects private or generated files even when
force-added. Pattern checks supplement a manual review; they cannot identify every
kind of private information.

Keep development notes and experimental assets in the ignored `.private/` folder.
Use synthetic records in committed fixtures. Do not commit real exports, captured
account pages, browser profiles or local test output.

Before making the first public commit, run the checks above and the relevant
real-Chrome fixtures. Stage only the reviewed public source, then run
`npm run audit:publication` again to check exactly what is staged. The audit does
not inspect historical commits; review history separately before publishing an
existing repository. Publishing source to GitHub does not publish a Chrome Web
Store release.
