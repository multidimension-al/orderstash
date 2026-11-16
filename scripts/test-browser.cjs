// Real Chrome + local HTTPS Amazon fixtures. Never touches a real account.
/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const forge = require('node-forge');
const {Builder, By, Key, until} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fixture = require('./fixtures.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-output', `orderstash-${Date.now()}`);
fs.mkdirSync(output, {recursive: true});
const requests = [];
const fixtureHost = process.env.ORDERSTASH_FIXTURE_HOST || '127.0.0.1';
let blocked = false;
let releaseInvoice;
let holdInvoice = true;
const longCollection = process.env.ORDERSTASH_COLLECTION_ONLY === '1';
const autoResume = process.env.ORDERSTASH_AUTO_ONLY === '1';
const parserOnly = process.env.ORDERSTASH_PARSER_ONLY === '1';
let releaseCollection;
let holdCollection = true;
function serve(req, res) {
  const url = new URL(req.url, fixture.origin);
  if (url.pathname.includes('favicon')) {
    res.writeHead(204);
    res.end();
    return;
  }
  requests.push({path: url.pathname + url.search, time: Date.now(), blocked});
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (blocked) {
    res.writeHead(429, {'Retry-After': '3600'});
    res.end(fixture.html('<h1>Too many requests</h1>'));
    return;
  }
  const id = url.searchParams.get('orderID');
  if (url.pathname.includes('/yourpayments/transactions')) {
    res.end(fixture.transactions(url.searchParams.get('page') === '2' ? 1 : 0));
  } else if (url.pathname.includes('/order-details')) {
    res.end(fixture.details(id));
  } else if (url.pathname.includes('/summary/print')) {
    if (holdInvoice) {
      holdInvoice = false;
      releaseInvoice = () => {
        releaseInvoice = undefined;
        res.end(fixture.invoice(id));
      };
    } else {
      res.end(fixture.invoice(id));
    }
  } else if (url.pathname === '/your-orders/orders' || url.pathname === '/gp/css/order-history') {
    if (longCollection || autoResume) {
      const index = Number(url.searchParams.get('startIndex') || 0) / 10;
      if (!autoResume && index === 3 && holdCollection) {
        holdCollection = false;
        releaseCollection = () => {
          releaseCollection = undefined;
          res.end(fixture.longListing(index));
        };
      } else res.end(fixture.longListing(index));
      return;
    }
    res.end(
      fixture.listing(url.searchParams.get('startIndex') === '10' ? 1 : 0,
        Number((url.searchParams.get('timeFilter') || url.searchParams.get('orderFilter'))?.replace('year-', '')) || 2026),
    );
  } else {
    res.end(fixture.html('<h1>Unknown fixture route</h1>'));
  }
}
function certificate() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60000);
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  cert.setSubject([{name: 'commonName', value: 'www.amazon.com'}]);
  cert.setIssuer(cert.subject.attributes);
  cert.setExtensions([
    {name: 'subjectAltName', altNames: [{type: 2, value: 'www.amazon.com'}]},
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  };
}
async function main() {
  const browser = process.env.ORDERSTASH_CHROME;
  const driverPath = process.env.ORDERSTASH_DRIVER;
  assert.ok(
    browser && driverPath,
    'Set ORDERSTASH_CHROME and ORDERSTASH_DRIVER to Chrome for Testing executables.',
  );
  const server = https.createServer(certificate(), serve);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(443, fixtureHost, resolve);
  });
  let driver;
  try {
    const options = new chrome.Options()
      .setChromeBinaryPath(browser)
      .addArguments(
        '--headless=new',
        '--no-first-run',
        '--no-sandbox',
        '--disable-gpu',
        '--remote-debugging-pipe',
        '--no-default-browser-check',
        '--ignore-certificate-errors',
        '--user-data-dir=' + path.join(output, 'profile'),
        '--no-proxy-server',
        '--host-resolver-rules=MAP www.amazon.com ' + fixtureHost,
        '--disable-extensions-except=' + path.join(root, 'build'),
        '--load-extension=' + path.join(root, 'build'),
        '--window-size=1440,1050',
      )
      .setUserPreferences({
        'download.default_directory': output,
        'download.prompt_for_download': false,
        'profile.default_content_setting_values.automatic_downloads': 1,
      });
    options.get('goog:chromeOptions').enableExtensionTargets = true;
    console.log('Starting isolated Chrome for the Amazon sidebar…');
    driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .setChromeService(
        new chrome.ServiceBuilder(driverPath).loggingTo(
          path.join(output, 'chromedriver.log'),
        ),
      )
      .build();
    await driver.get(
      fixture.origin +
        (process.env.ORDERSTASH_PANELS_ONLY === '1'
          ? '/gp/css/order-history?ref_=nav_orders_first&orderFilter=year-2026&startIndex=0'
          : '/your-orders/orders?timeFilter=year-2026&startIndex=0&language=en_US'),
    );
    const amazonHandle = await driver.getWindowHandle();
    async function sidebar() {
      await driver.switchTo().defaultContent();
      const frame = await driver.wait(
        () =>
          driver.executeScript(
            'return document.getElementById("orderstash-panel-host")?.shadowRoot.querySelector("iframe")',
          ),
        15000,
      );
      await driver.switchTo().frame(frame);
      await driver.wait(
        until.elementLocated(By.css('#scope option[value="year-2026"]')),
        15000,
      );
    }
    const click = async (id) => {
      const e = await driver.findElement(By.id(id));
      await driver.wait(until.elementIsVisible(e), 10000);
      await driver.wait(until.elementIsEnabled(e), 10000);
      await driver.executeScript(
        'arguments[0].scrollIntoView({block:"center"})',
        e,
      );
      await e.click();
    };
    const status = () =>
      driver.executeAsyncScript(function (done) {
        chrome.runtime.sendMessage(
          {
            target: 'background',
            action: 'status',
            origin: 'https://www.amazon.com',
          },
          done,
        );
      });
    const idle = () =>
      driver.wait(
        async () => !(await status()).job.busy,
        120000,
        'Background work did not finish',
      );
    const screenshot = async (name) =>
      fs.writeFileSync(
        path.join(output, name + '.png'),
        await driver.takeScreenshot(),
        'base64',
      );
    async function findPanel(query) {
      let result;
      await driver.wait(async () => {
        for (const handle of await driver.getAllWindowHandles()) {
          try {
            await driver.switchTo().window(handle);
            if ((await driver.getCurrentUrl() || '').includes(query)) { result = handle; return true; }
          } catch (error) {
            // A successful handoff can close a target after enumeration.
            if (!/no such window|target.*closed/i.test(String(error))) throw error;
          }
        }
        return false;
      }, 15000, 'Panel did not appear: ' + query);
      await driver.wait(until.elementLocated(By.css('#scope option[value="year-2026"]')), 15000);
      return result;
    }
    async function assertParserCsp() {
      const logs = await driver.manage().logs().get('browser');
      const violations = logs.filter(entry => /parser\.(?:js|html)/i.test(entry.message) &&
        /content security policy|inline style/i.test(entry.message));
      fs.writeFileSync(path.join(output, 'browser.log'), JSON.stringify(logs, null, 2));
      assert.deepEqual(violations, [], 'Page snapshots must not trigger CSP errors in the local parser');
    }
    if (parserOnly) {
      await sidebar();
      await driver.wait(async () => (await status()).orders.length === 1, 10000);
      const before = requests.length;
      const styled = html => html.replace('<head>', `<head><style>@import url("${fixture.origin}/parser-css-probe"); p{color:blue}</style>`)
        .replace('<body>', '<body style="color: red"><img src="/parser-image-probe" onerror="window.parserSnapshotExecuted=true"><iframe src="/parser-frame-probe"></iframe>')
        .replace('class="order-card', 'style="color:green" class="order-card');
      const page = (html, url) => ({html: styled(html), url: fixture.origin + url, text: html.replace(/<[^>]+>/g, ' ')});
      const cases = [
        ['listing', [page(fixture.listing(), '/your-orders/orders?timeFilter=year-2026'), 'personal']],
        ['details', [page(fixture.details(fixture.ids[0]), '/your-orders/order-details?orderID=' + fixture.ids[0]), (await status()).orders[0]]],
        ['payments', [page(fixture.transactions(), '/cpe/yourpayments/transactions'), 'personal', fixture.origin]],
        ['inspect', [page(fixture.listing(), '/your-orders/orders'), fixture.origin]],
        ['enrichment', [styled(fixture.html('<div id="wayfinding-breadcrumbs_feature_div" style="font-size:12px">Tools &amp; parts</div>')), 'category']],
      ];
      const responses = await driver.executeAsyncScript(async (cases, done) => {
        try {
          const result = [];
          for (const [method, args] of cases) result.push(await chrome.runtime.sendMessage({target: 'parser', method, args}));
          done({result, csp: chrome.runtime.getManifest().content_security_policy.extension_pages});
        } catch (error) { done({error: String(error)}); }
      }, cases);
      assert.equal(responses.error, undefined);
      assert.ok(responses.result.every(response => response?.ok), JSON.stringify(responses));
      assert.equal(responses.result[0].value.orders[0].orderId, fixture.ids[0]);
      assert.equal(responses.result[0].value.orders[0].date, '2026-10-31');
      assert.equal(new URL(responses.result[0].value.next).searchParams.get('startIndex'), '10');
      assert.equal(responses.result[1].value.items[0].description, 'Proton pack parts');
      assert.equal(responses.result[2].value[0].amount, 21.5);
      assert.equal(responses.result[4].value, 'Tools & parts');
      assert.doesNotMatch(responses.csp, /unsafe-inline|unsafe-eval/);
      await driver.sleep(300);
      assert.equal(requests.length, before, 'Parsing must not load snapshot stylesheets, images, or frames');
      await assertParserCsp();
      fs.writeFileSync(path.join(output, 'parser-result.json'), JSON.stringify({responses, requests}, null, 2));
      console.log('PASS: styled order, detail, payment, inspection and category snapshots parse with no CSP violations or embedded-resource requests; CSP stays strict.');
      console.log('Artifacts: ' + output);
      return;
    }
    if (autoResume) {
      await sidebar();
      await click('native-panel');
      await findPanel('docked=1');
      await driver.executeAsyncScript(done => {
        const request = indexedDB.open('orderstash', 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('meta', 'readwrite');
          // A tiny visit budget makes this fixture reach the real budget path
          // without hundreds of pages or shortening production delays.
          tx.objectStore('meta').put({key: 'settings', value: {navigationLimit: 2}});
          tx.oncomplete = () => { db.close(); done(); };
        };
      });
      await click('save-csv');
      await driver.wait(async () => Boolean((await status()).job.resumeAt), 45000);
      let state = await status();
      assert.equal(state.orders.length, 30);
      assert.equal(state.job.busy, false);
      const scheduled = await driver.executeAsyncScript(done =>
        chrome.alarms.get('orderstash-resume').then(done));
      assert.ok(scheduled.scheduledTime > Date.now());
      assert.ok(scheduled.scheduledTime - Date.now() <= 300000);
      const beforeWait = requests.length;
      await driver.sleep(1000);
      assert.equal(requests.length, beforeWait, 'The budget break must not make Amazon requests');
      const recoveredSource = await driver.executeAsyncScript(async done => {
        const prior = await chrome.runtime.sendMessage({target: 'background', action: 'context'});
        const tab = await chrome.tabs.create({url: 'https://www.amazon.com/your-orders/orders?timeFilter=year-2026&startIndex=0', active: true});
        await chrome.tabs.remove(prior.context.tabId);
        done({old: prior.context.tabId, current: tab.id});
      });
      await driver.wait(async () => {
        const context = await driver.executeAsyncScript((old, done) =>
          chrome.runtime.sendMessage({target: 'background', action: 'context', tabId: old}).then(done), recoveredSource.old);
        return context.context?.ordersPage && context.context.tabId === recoveredSource.current;
      }, 15000, 'A stale panel source must recover to the replacement Orders tab');
      const beforeResume = requests.length;
      await driver.executeAsyncScript(async done => {
        // Advance the persisted five-minute deadline, then restart the actual
        // worker. This checks alarm recovery without a five-minute test sleep.
        const saved = await chrome.storage.local.get(['orderstash_job', 'orderstash_pace_www.amazon.com']);
        saved.orderstash_job.resumeAt = Date.now() + 5000;
        saved['orderstash_pace_www.amazon.com'].cooldownUntil = Date.now() - 1000;
        await chrome.storage.local.set(saved);
        done();
      });
      await driver.sendDevToolsCommand('ServiceWorker.enable', {});
      await driver.sendDevToolsCommand('ServiceWorker.stopAllWorkers', {});
      const restored = await status();
      assert.equal(restored.job.busy, false, 'Restoring a future alarm must wait for its deadline');
      assert.ok(restored.job.resumeAt > Date.now());
      await driver.wait(async () => (await status()).orders.length === 50, 75000,
        'Chrome’s actual alarm did not continue collection');
      await driver.wait(async () => (await status()).orderReceipts.filter(receipt => receipt.kind === 'orders').length === 50, 15000);
      await idle();
      state = await status();
      assert.equal(state.job.resumeAt, undefined);
      assert.deepEqual(requests.slice(beforeResume).map(request => new URL(request.path, fixture.origin).searchParams.get('startIndex')), ['30', '40']);
      // Cancel a newly scheduled break and prove a restarted worker honors it.
      await driver.findElement(By.css('.options summary')).click();
      await click('collect-only');
      await driver.wait(async () => Boolean((await status()).job.resumeAt), 10000);
      await click('pause-job');
      assert.equal((await status()).job.resumeAt, undefined);
      assert.equal(await driver.executeAsyncScript(done => chrome.alarms.get('orderstash-resume').then(done)), null);
      fs.writeFileSync(path.join(output, 'auto-result.json'), JSON.stringify({requests, state, recoveredSource}, null, 2));
      console.log('PASS: a budget break schedules continuation, survives worker restart, finds a replacement Orders tab, completes all 50 CSV records, and can be cancelled.');
      console.log('Artifacts: ' + output);
      return;
    }
    if (longCollection) {
      await sidebar();
      await click('save-csv');
      await driver.wait(() => Boolean(releaseCollection), 45000, 'Collection never reached page four');
      let state = await status();
      assert.equal(state.orders.length, 30);
      assert.equal(state.job.busy, true);
      assert.equal(state.runs[0].status, 'running');
      const beforeReload = requests.length;
      // Terminate the actual worker; the next status message starts a fresh
      // instance with no live engine or promises from the interrupted job.
      await driver.sendDevToolsCommand('ServiceWorker.enable', {});
      await driver.sendDevToolsCommand('ServiceWorker.stopAllWorkers', {});
      releaseCollection();
      state = await status();
      assert.equal(state.job.busy, false);
      assert.equal(state.job.paused, true);
      assert.equal(state.orders.length, 30);
      assert.ok(state.runs.every(run => run.status !== 'running'));
      assert.equal(state.runs[0].issues.length, 0);
      assert.match(state.runs[0].pauseReason, /worker stopped/);
      await click('resume-job');
      await driver.wait(async () => (await status()).orders.length === 50, 45000);
      await idle();
      state = await status();
      assert.equal(new Set(state.orders.map(order => order.key)).size, 50);
      assert.equal(state.runs[0].status, 'complete');
      assert.ok(state.orders.every(order => !order.detailsAt));
      assert.equal(state.orderReceipts.filter(receipt => receipt.kind === 'orders').length, 50,
        'Resume must finish interrupted summary collection before exporting CSV');
      assert.equal(state.orderReceipts.filter(receipt => receipt.kind === 'pdf').length, 0);
      assert.deepEqual(requests.slice(beforeReload).map(request =>
        new URL(request.path, fixture.origin).searchParams.get('startIndex')), ['30', '40'],
        'Resume visits only the saved next page and its successor');
      assert.ok(requests.every(request => request.path.includes('/your-orders/orders')));
      const visits = requests.filter(request => !new URL(request.path, fixture.origin).searchParams.has('ref_'));
      assert.ok(visits.every(request => !request.path.includes('order-details')));
      await driver.findElement(By.css('nav [data-page="orders"]')).click();
      await driver.wait(async () => await driver.findElements(By.css('.order-entry')).then(rows => rows.length) === 50, 10000);
      await driver.wait(async () => await driver.findElements(By.css('.order-entry [data-format="orders"].saved')).then(rows => rows.length) === 50, 10000);
      await driver.executeScript('window.scrollTo(0,0)');
      await screenshot('orders-library-50');
      assert.equal(await driver.executeScript('return document.documentElement.scrollWidth <= innerWidth'), true,
        'The order library must fit the sidebar width');
      fs.writeFileSync(path.join(output, 'collection-result.json'), JSON.stringify({
        chrome: (await driver.getCapabilities()).get('browserVersion'), requests, state,
      }, null, 2));
      console.log('PASS: 50 summaries over five pages; terminate worker at 30, show paused history, resume only remaining pages, deduplicate, no detail requests.');
      console.log('Artifacts: ' + output);
      return;
    }
    if (process.env.ORDERSTASH_PANELS_ONLY === '1') {
      await sidebar();
      await click('native-panel');
      let docked = await findPanel('docked=1');
      await driver.executeScript('window.panelIdentity = "original-docked-document"');
      const config = await driver.executeAsyncScript(done => Promise.all([
        chrome.action.getPopup({}), chrome.sidePanel.getPanelBehavior(),
      ]).then(([popup, behavior]) => done({popup, behavior})));
      assert.equal(config.popup, '', 'The toolbar must not create another popup');
      assert.equal(config.behavior.openPanelOnActionClick, true);
      await driver.findElement(By.id('scope')).sendKeys(Key.END, Key.ENTER);
      await driver.wait(async () =>
        (await driver.findElement(By.id('scope')).getAttribute('value')) === 'year-2024' &&
        (await status()).orders.some(order => order.orderId === '234-1234567-1234567'), 15000);
      assert.equal(await driver.executeScript('return window.panelIdentity'), 'original-docked-document');
      await driver.switchTo().window(amazonHandle);
      const changedYearUrl = new URL(await driver.getCurrentUrl());
      assert.equal(changedYearUrl.pathname, '/your-orders/orders');
      assert.equal(changedYearUrl.searchParams.get('timeFilter'), 'year-2024');
      assert.equal(changedYearUrl.searchParams.has('orderFilter'), false);
      assert.equal(await driver.executeScript('return !!document.getElementById("orderstash-panel-host")?.shadowRoot.querySelector("iframe")'), false);
      await driver.get(fixture.origin + '/your-orders/orders?timeFilter=year-2026&startIndex=10');
      await driver.switchTo().window(docked);
      await driver.wait(async () => (await status()).orders.length === 3, 15000);
      await driver.wait(async () => (await driver.findElement(By.id('library-count')).getText()).includes('3 unique orders'), 10000);
      await driver.switchTo().window(amazonHandle);
      await driver.get(fixture.origin + '/your-orders/orders?timeFilter=year-2026&startIndex=0');
      assert.equal(await driver.executeScript('return !!document.getElementById("orderstash-panel-host")?.shadowRoot.querySelector("iframe")'), false);
      await driver.switchTo().window(docked);
      await driver.wait(async () => (await driver.findElement(By.id('scope')).getAttribute('value')) === 'year-2026', 15000);
      assert.equal((await status()).orders.length, 3, 'Rereading an order must update, not duplicate it');
      assert.equal((await status()).receipts.length, 0);
      await screenshot('native-year-and-library');
      console.log('PASS: actual docked panel survives year changes and pagination without another sidebar; library accumulates and deduplicates.');

      await driver.executeAsyncScript(done => {
        const opening = indexedDB.open('orderstash', 1);
        opening.onsuccess = () => {
          const tx = opening.result.transaction('runs', 'readwrite');
          tx.objectStore('runs').put({id: 'history-interaction', profileId: 'personal', origin: 'https://www.amazon.com',
            kind: 'scan', startedAt: '1970-01-01T00:00:00.000Z', status: 'failed', selected: [], completed: [],
            issues: [{orderId: '', message: 'Synthetic issue text to expand and copy'}], navigations: 0, label: 'History interaction fixture'});
          tx.oncomplete = () => done(true);
        };
      });
      await driver.findElement(By.css('[data-page="history"]')).click();
      const issue = await driver.wait(until.elementLocated(By.css('[data-run-id="history-interaction"] details summary')), 10000);
      await issue.click();
      await driver.executeScript(() => {
        window.savedHistoryRow = document.querySelector('[data-run-id="history-interaction"]');
        const range = document.createRange();
        range.selectNodeContents(window.savedHistoryRow.querySelector('details p'));
        getSelection().removeAllRanges(); getSelection().addRange(range);
      });
      await new Promise(resolve => setTimeout(resolve, 4500));
      const interaction = await driver.executeScript(() => ({
        sameRow: window.savedHistoryRow === document.querySelector('[data-run-id="history-interaction"]'),
        expanded: window.savedHistoryRow.querySelector('details').open,
        selected: getSelection().toString(),
      }));
      assert.equal(interaction.sameRow, true); assert.equal(interaction.expanded, true);
      assert.match(interaction.selected, /Synthetic issue text/);
      await screenshot('history-selection-stable');
      await driver.executeScript('getSelection().removeAllRanges()');
      await driver.findElement(By.css('[data-page="export"]')).click();
      console.log('PASS: expanded issues and selected text survive multiple status polls.');

      await click('detach');
      const detached = await findPanel('detached=1');
      await driver.manage().window().setRect({width: 460, height: 850});
      await driver.wait(async () => (await driver.executeAsyncScript(done => chrome.runtime.getContexts({}).then(done)))
        .filter(context => context.contextType === 'SIDE_PANEL').length === 0, 10000);
      const width = await driver.executeScript('return {body: document.body.getBoundingClientRect().width, viewport: document.documentElement.clientWidth}');
      assert.ok(Math.abs(width.body - width.viewport) <= 1, JSON.stringify(width));
      await click('detach');
      assert.equal((await driver.executeAsyncScript(done => chrome.runtime.getContexts({}).then(done)))
        .filter(context => context.documentUrl?.includes('detached=1')).length, 1);
      await screenshot('detached-full-width');
      await driver.switchTo().window(amazonHandle);
      await driver.navigate().refresh();
      assert.equal(await driver.executeScript('return !!document.getElementById("orderstash-panel-host")?.shadowRoot.querySelector("iframe")'), false);
      await driver.switchTo().window(detached);
      await click('native-panel');
      docked = await findPanel('docked=1');
      await driver.wait(async () => (await driver.executeAsyncScript(done => chrome.runtime.getContexts({}).then(done)))
        .filter(context => context.documentUrl?.includes('detached=1')).length === 0, 10000);
      const finalState = await status();
      assert.equal(finalState.orders.length, 3);
      fs.writeFileSync(path.join(output, 'panel-result.json'), JSON.stringify({config, width, interaction, requests, state: finalState}, null, 2));
      console.log('PASS: detaching closes the dock; docking closes the detached window; both use their full width.');
      console.log('Artifacts: ' + output);
      return;
    }
    await sidebar();
    await driver.wait(async () => (await status()).orders.length === 1, 15000);
    assert.equal(requests.length, 1, 'Visible orders are captured without extra visits');
    assert.equal((await status()).receipts.length, 0, 'Passive reads never mark exports complete');
    assert.equal(
      await driver.findElement(By.id('scope')).getAttribute('value'),
      'year-2026',
    );
    assert.match(
      await driver.findElement(By.id('page-context')).getText(),
      /2 orders/,
    );
    assert.equal(
      await driver.findElement(By.id('extra-details')).isSelected(),
      false,
    );
    assert.equal(
      await driver.findElement(By.id('categories')).isSelected(),
      false,
    );
    assert.equal(
      await driver.findElement(By.id('tracking')).isSelected(),
      false,
    );
    await driver.switchTo().defaultContent();
    await screenshot('01-sidebar-on-amazon');
    assert.equal(await driver.executeScript(
      'return document.getElementById("orderstash-panel-host").shadowRoot.querySelector("button") === null',
    ), true, 'No floating button may cover Amazon controls');
    await sidebar();
    const cue = await driver.executeAsyncScript(function(done) {
      const tabId = Number(new URLSearchParams(location.search).get('sourceTab'));
      chrome.runtime.sendMessage({target: 'background', action: 'panel-visibility', tabId, open: false})
        .then(async () => done({
          text: await chrome.action.getBadgeText({tabId}),
          title: await chrome.action.getTitle({tabId}),
        }));
    });
    assert.equal(cue.text, 'OPEN');
    assert.match(cue.title, /Open OrderStash/);
    await click('close-panel');
    await driver.switchTo().defaultContent();
    await driver.wait(async () => driver.executeScript(
      'return !document.getElementById("orderstash-panel-host").shadowRoot.querySelector("iframe") && document.body.style.marginRight === ""',
    ), 10000, 'Closing the sidebar must unload its controls and restore Amazon layout');
    await driver.navigate().refresh();
    await sidebar();
    await driver.findElement(By.css('.options summary')).click();
    const beforeCollect = requests.length;
    await click('collect-only');
    await driver.wait(async () => (await status()).orders.length === 2, 45000);
    await idle();
    let state = await status();
    assert.ok(state.orders.every((o) => !o.detailsAt && o.items.length === 1));
    assert.equal(
      requests.length,
      beforeCollect + 1,
      'Only one next index is added to the user-opened page, without detail visits',
    );
    assert.ok(requests.every((r) => r.path.includes('/your-orders/orders')));
    console.log(
      'PASS: sidebar discovers Amazon years/counts; default collection uses the open index plus one next page only.',
    );
    await driver.findElement(By.css('nav [data-page="orders"]')).click();
    await driver.wait(async () => await driver.findElements(By.css('.order-entry')).then(rows => rows.length) === 2, 10000);
    assert.equal(await driver.findElements(By.css('.order-entry [data-format="pdf"]:not(.saved)')).then(rows => rows.length), 2);
    assert.equal(await driver.findElements(By.css('.order-entry [data-format="orders"]:not(.saved)')).then(rows => rows.length), 2);
    await driver.findElement(By.css('nav [data-page="export"]')).click();
    const beforeCsv = requests.length;
    await click('save-csv');
    await driver.wait(
      async () =>
        (await status()).receipts.filter((r) => r.kind === 'orders').length ===
        2,
      20000,
    );
    await idle();
    assert.equal(
      requests.length,
      beforeCsv,
      'Fresh summaries export CSV with no Amazon requests',
    );
    await click('save-pdfs');
    await driver.wait(() => Boolean(releaseInvoice), 30000);
    await click('pause-job');
    releaseInvoice();
    await idle();
    state = await status();
    assert.equal(state.receipts.filter((r) => r.kind === 'pdf').length, 1);
    assert.equal(state.remaining.length, 1);
    assert.equal(await driver.executeAsyncScript(done => chrome.storage.local.get('orderstash_invoice_debugger_tab').then(value => done(value.orderstash_invoice_debugger_tab ?? null))), null,
      'Pausing must release the dedicated invoice debugger attachment');
    await driver.findElement(By.css('nav [data-page="orders"]')).click();
    await driver.wait(async () => await driver.findElements(By.css('.order-entry [data-format="orders"].saved')).then(rows => rows.length) === 2, 10000);
    await driver.wait(async () => await driver.findElements(By.css('.order-entry [data-format="pdf"].saved')).then(rows => rows.length) === 1, 10000);
    assert.equal(await driver.findElements(By.css('.order-entry [data-format="pdf"].saved')).then(rows => rows.length), 1,
      'Orders show PDF completion separately from CSV completion');
    const firstRow = await driver.findElement(By.css('.order-entry'));
    await driver.executeScript('window.orderRowIdentity = arguments[0]', firstRow);
    await driver.sleep(3200);
    assert.equal(await driver.executeScript('return window.orderRowIdentity === document.querySelector(".order-entry")'), true,
      'Unchanged status polls preserve order rows');
    await screenshot('orders-export-status');
    await driver.findElement(By.css('#order-status option[value="pdf-pending"]')).click();
    assert.equal(await driver.findElements(By.css('.order-entry')).then(rows => rows.length), 1);
    assert.equal(await driver.findElement(By.css('.order-entry')).getAttribute('data-order-id'), fixture.ids[1]);
    await driver.findElement(By.css('#order-status option[value="all"]')).click();
    await driver.findElement(By.id('order-search')).sendKeys(fixture.ids[0]);
    assert.equal(await driver.findElements(By.css('.order-entry')).then(rows => rows.length), 1);
    await driver.findElement(By.id('order-search')).clear();
    await driver.findElement(By.css('nav [data-page="export"]')).click();
    console.log('PASS: Orders lists saved summaries with independent PDF/CSV status, pending filter, search, and stable rows during polling.');
    assert.equal(state.runs.find(run => run.kind === 'pdf' && run.status === 'paused').issues.length, 0,
      'A user pause is a normal status, not an issue');
    console.log(
      'PASS: explicit PDF action opens the invoice; pause finishes the current file and records completion.',
    );
    await click('detach');
    let detachedHandle;
    await driver.wait(
      async () => {
        for (const handle of await driver.getAllWindowHandles()) {
          await driver.switchTo().window(handle);
          if ((await driver.getCurrentUrl()).includes('detached=1')) {
            detachedHandle = handle;
            return true;
          }
        }
        return false;
      },
      10000,
      'Detached extension window did not appear',
    );
    assert.ok(detachedHandle, 'Detached extension window expected');
    await driver.wait(until.elementLocated(By.id('resume-job')), 10000);
    await driver.wait(
      until.elementIsVisible(await driver.findElement(By.id('resume-job'))),
      10000,
    );
    await screenshot('02-detached-controls');
    await click('resume-job');
    await driver.close();
    await driver.switchTo().window(amazonHandle);
    assert.equal(await driver.executeScript(
      'return document.getElementById("orderstash-panel-host").shadowRoot.querySelector("iframe") === null',
    ), true, 'Detaching unloads the embedded controls');
    // No extension UI or status polling keeps the worker alive during this visit.
    await driver.wait(() => requests.filter(r => r.path.includes('/summary/print')).length === 2,
      60000, 'Background export did not reach the second invoice with all controls closed');
    await driver.navigate().refresh();
    await sidebar();
    await driver.wait(async () => {
      const s = await status();
      return (
        !s.job.busy && s.receipts.filter((r) => r.kind === 'pdf').length === 2
      );
    }, 90000);
    state = await status();
    assert.equal(state.receipts.filter((r) => r.kind === 'orders').length, 2);
    const pdfs = state.receipts
      .filter((r) => r.kind === 'pdf')
      .map((r) => r.filename);
    for (const file of pdfs)
      assert.equal(fs.readFileSync(file).subarray(0, 5).toString(), '%PDF-');
    assert.equal(
      requests.filter(r => r.path.includes('/order-details') || r.path.includes('/summary/print')).length,
      4,
      'Exactly two detail/invoice pairs',
    );
    console.log(
      'PASS: detached controls close while background export continues; completed PDFs are skipped on resume.',
    );
    await driver.findElement(By.css('[data-page="history"]')).click();
    await screenshot('03-history');
    await driver.findElement(By.css('[data-page="export"]')).click();
    const beforeDetails = requests.length;
    await driver.findElement(By.css('.options summary')).click();
    // Reopening controls may preserve an expanded options section; open only if needed.
    const extra = await driver.findElement(By.id('extra-details'));
    if (!(await extra.isDisplayed()))
      await driver.findElement(By.css('.options summary')).click();
    await click('extra-details');
    await click('collect-only');
    await driver.wait(
      async () =>
        (await status()).orders.filter((o) => o.detailsAt).length === 2,
      60000,
    );
    await idle();
    state = await status();
    assert.equal(
      requests.length - beforeDetails,
      3,
      'Extra details explicitly add one index and two detail visits',
    );
    assert.ok(state.orders.every((o) => o.shipments.length === 1));
    assert.ok(
      !requests.some(
        (r) => r.path.includes('/gp/product/') || r.path.includes('ship-track'),
      ),
    );
    console.log(
      'PASS: extra order details are opt-in; no product or tracking pages are fetched.',
    );
    await click('extra-details');
    const beforeYear = requests.length;
    await driver.findElement(By.css('#scope option[value="year-2025"]')).click();
    await driver.switchTo().defaultContent();
    await driver.wait(until.urlContains('timeFilter=year-2025'), 15000);
    await sidebar();
    await driver.wait(async () =>
      (await driver.findElement(By.id('scope')).getAttribute('value')) === 'year-2025' &&
      (await status()).orders.some(o => o.orderId === '789-1234567-1234567'), 15000);
    assert.match(await driver.findElement(By.id('page-context')).getText(), /1 orders/);
    assert.equal(requests.length, beforeYear + 1, 'Changing years opens only its first history page');
    assert.equal((await status()).receipts.length, 4, 'Browsing never marks new orders as exported');
    await driver.findElement(By.css('#scope option[value="page"]')).click();
    await driver.switchTo().defaultContent();
    const beforeDomUpdate = requests.length;
    await driver.executeScript(function(html) {
      const page = new DOMParser().parseFromString(html, 'text/html');
      const card = page.querySelector('.order-card');
      const second = card.cloneNode(true);
      second.innerHTML = second.innerHTML.replaceAll('890-1234567-1234567', '901-1234567-1234567');
      page.body.append(second);
      page.querySelector('.num-orders').textContent = '3 orders';
      document.body.replaceChildren(...page.body.childNodes);
      history.pushState({}, '', '/your-orders/orders?timeFilter=year-2025&startIndex=10');
    }, fixture.listing(0, 2025).replaceAll('789-1234567-1234567', '890-1234567-1234567'));
    await sidebar();
    await driver.wait(async () =>
      (await driver.findElement(By.id('page-context')).getText()).includes('3 orders') &&
      (await driver.findElement(By.css('#scope option[value="page"]')).getText()).includes('2 orders') &&
      (await status()).orders.filter(o => o.date.startsWith('2025')).length === 3, 15000);
    assert.equal(await driver.findElement(By.id('scope')).getAttribute('value'), 'page', 'A page scope survives pagination');
    assert.equal(requests.length, beforeDomUpdate, 'SPA navigation and DOM updates read only existing page data');
    await driver.switchTo().defaultContent();
    await screenshot('04-live-history-sync');
    await sidebar();
    await click('detach');
    await driver.wait(async () => {
      for (const handle of await driver.getAllWindowHandles()) {
        await driver.switchTo().window(handle);
        if ((await driver.getCurrentUrl()).includes('detached=1')) {
          detachedHandle = handle;
          return true;
        }
      }
      return false;
    }, 10000);
    await driver.wait(until.elementLocated(By.id('scope')), 10000);
    await driver.switchTo().window(amazonHandle);
    await driver.get(fixture.origin + '/your-orders/orders?timeFilter=year-2026&startIndex=0');
    await driver.switchTo().window(detachedHandle);
    await driver.wait(async () =>
      (await driver.findElement(By.id('scope')).getAttribute('value')) === 'year-2026' &&
      (await driver.findElement(By.id('page-context')).getText()).includes('2 orders'), 15000);
    await screenshot('05-detached-live-sync');
    await driver.close();
    await driver.switchTo().window(amazonHandle);
    await driver.navigate().refresh();
    await sidebar();
    await driver.wait(async () => (await driver.findElement(By.id('scope')).getAttribute('value')) === 'year-2026', 15000);
    console.log('PASS: year selections navigate Amazon; history changes and SPA pagination sync automatically with no background crawl.');
    await driver.findElement(By.css('.options summary')).click();
    blocked = true;
    const beforeBlock = requests.length;
    await click('collect-only');
    await driver.wait(
      async () => (await status()).job.message.includes('429'),
      30000,
    );
    await idle();
    assert.equal(requests.length, beforeBlock + 1);
    await click('collect-only');
    await driver.wait(
      async () => (await status()).job.message.includes('cooling down'),
      10000,
    );
    await idle();
    assert.equal(
      requests.length,
      beforeBlock + 1,
      'Persistent cooldown prevents another request',
    );
    await driver.wait(async () => (await driver.findElement(By.id('job-message')).getText()).includes('cooling down'), 10000);
    await driver.switchTo().defaultContent();
    await screenshot('06-cooldown-sidebar');
    await sidebar();
    state = await status();
    fs.writeFileSync(
      path.join(output, 'result.json'),
      JSON.stringify(
        {
          chrome: (await driver.getCapabilities()).get('browserVersion'),
          requests,
          state,
          pdfs,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS: HTTP 429 stops work and cooldown prevents repeated automated requests.',
    );
    await assertParserCsp();
    console.log('Artifacts: ' + output);
  } catch (error) {
    if (driver) {
      try {
        const handles = await driver.getAllWindowHandles();
        if (handles.length) await driver.switchTo().window(handles[0]);
        fs.writeFileSync(
          path.join(output, 'failure.png'),
          await driver.takeScreenshot(),
          'base64',
        );
        fs.writeFileSync(
          path.join(output, 'failure.txt'),
          await driver.findElement(By.css('body')).getText(),
        );
        fs.writeFileSync(
          path.join(output, 'requests.json'),
          JSON.stringify(requests, null, 2),
        );
        fs.writeFileSync(
          path.join(output, 'browser.log'),
          JSON.stringify(await driver.manage().logs().get('browser'), null, 2),
        );
      } catch {}
    }
    console.error('Failure artifacts: ' + output);
    throw error;
  } finally {
    if (driver) await driver.quit().catch(() => undefined);
    if (releaseInvoice) releaseInvoice();
    if (releaseCollection) releaseCollection();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
