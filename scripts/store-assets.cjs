// Render store artwork from the actual extension with synthetic sample records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const forge = require('node-forge');
const {Builder, By, until} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fixture = require('./fixtures.cjs');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'store/assets');
const output = path.join(root, 'test-output', 'store-assets-' + Date.now());
const host = process.env.ORDERSTASH_FIXTURE_HOST || '127.0.0.1';
const dataUrl = file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
const lightLogo = () => dataUrl(path.join(root, 'src/assets/orderstash-logo-light.png'));

function certificate() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60000);
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  cert.setSubject([{name: 'commonName', value: 'www.amazon.com'}]);
  cert.setIssuer(cert.subject.attributes);
  cert.setExtensions([{name: 'subjectAltName', altNames: [{type: 2, value: 'www.amazon.com'}]}]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert)};
}

function artwork(title, description, features, screenshot) {
  return `<!doctype html><html><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;width:1280px;height:800px;overflow:hidden}
    body{background:#183042;color:white;font-family:'Segoe UI',Arial,sans-serif}
    .copy{position:absolute;left:60px;top:47px;width:620px;height:710px}
    .logo{width:250px;height:auto;display:block;margin:0 0 56px}
    h1{font-size:70px;font-weight:700;line-height:1.04;letter-spacing:-2.5px;margin:0 0 25px;white-space:pre-line}
    .description{font-size:24px;line-height:1.45;color:#c8dee2;width:580px;margin:0 0 31px}
    ul{list-style:none;padding:0;margin:0}li{font-size:21px;line-height:1.4;margin:15px 0;padding-left:34px;position:relative}
    li:before{content:'✓';position:absolute;left:0;color:#67d6c4;font-weight:700}
    .caption{position:absolute;left:60px;bottom:30px;color:#afc8d1;font-size:14px}
    .stage{position:absolute;right:0;top:0;width:540px;height:800px;background:#d8ede9}
    .capture{position:absolute;left:48px;top:35px;width:440px;height:730px;border:1px solid #afc8ca;box-shadow:0 16px 40px #143b4526;display:block}
  </style><div class="copy"><img class="logo" src="${lightLogo()}" alt="OrderStash"><h1>${title}</h1>
  <p class="description">${description}</p><ul>${features.map(text => '<li>' + text + '</li>').join('')}</ul></div>
  <div class="caption">For Amazon order history. Actual OrderStash interface with sample data.</div>
  <div class="stage"><img class="capture" src="${dataUrl(screenshot)}" alt="OrderStash interface"></div></html>`;
}

function promo(width, height) {
  const small = width === 440;
  return `<!doctype html><html><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
    body{font-family:'Segoe UI',Arial,sans-serif;background:#183042;color:#fff}
    .logo{position:absolute;left:${small ? 30 : 74}px;top:${small ? 30 : 76}px;width:${small ? 249 : 390}px;height:auto}
    h1{position:absolute;left:74px;top:197px;font-size:57px;line-height:1.12;letter-spacing:-1.8px;margin:0;font-weight:700}
    .tag{position:absolute;left:${small ? 30 : 77}px;bottom:${small ? 24 : 70}px;font-size:${small ? 18 : 24}px;color:#c8dee2;margin:0}
    .paper{position:absolute;right:${small ? 38 : 140}px;top:${small ? 113 : 80}px;width:${small ? 102 : 252}px;height:${small ? 126 : 340}px;background:#fff;border-radius:3px;color:#183042;padding:${small ? 14 : 30}px;box-shadow:${small ? '-16px 12px 0 #2c5260' : '-34px 28px 0 #2c5260'}}
    .paper:after{content:'';position:absolute;left:0;right:0;bottom:-8px;height:12px;background:linear-gradient(135deg,#fff 25%,transparent 25%) -6px 0/12px 12px,linear-gradient(225deg,#fff 25%,transparent 25%) -6px 0/12px 12px}
    .pdf{font-size:${small ? 21 : 43}px;font-weight:750;color:#007f78}.rule{height:${small ? 4 : 8}px;background:#d4e3e6;margin-top:${small ? 10 : 22}px}.short{width:64%}
    .check{position:absolute;right:${small ? -10 : -26}px;bottom:${small ? 15 : 45}px;width:${small ? 34 : 80}px;height:${small ? 34 : 80}px;line-height:${small ? 34 : 80}px;background:#007f78;color:white;border:3px solid #183042;border-radius:50%;text-align:center;font-size:${small ? 20 : 47}px;font-weight:700}
  </style><img class="logo" src="${lightLogo()}" alt="OrderStash">${small ? '' : '<h1>Amazon invoices.<br>Saved as PDFs.</h1>'}
  <p class="tag">${small ? 'Invoice PDFs & order exports' : 'Free invoice PDFs. Local records. No account.'}</p>
  <div class="paper"><div class="pdf">PDF</div><div class="rule"></div><div class="rule short"></div><div class="rule"></div><div class="rule short"></div><div class="check">✓</div></div></html>`;
}

async function main() {
  assert.ok(process.env.ORDERSTASH_CHROME && process.env.ORDERSTASH_DRIVER,
    'Set ORDERSTASH_CHROME and ORDERSTASH_DRIVER to Chrome for Testing executables.');
  fs.mkdirSync(assets, {recursive: true});
  fs.mkdirSync(output, {recursive: true});
  const server = https.createServer(certificate(), (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fixture.listing(req.url.includes('startIndex=10') ? 1 : 0)
      .replaceAll('Synthetic Test', 'Sample account').replaceAll('Proton pack parts', 'USB-C docking station')
      .replace('2 orders', '6 orders'));
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(443, host, resolve);});
  let driver;
  try {
    const options = new chrome.Options().setChromeBinaryPath(process.env.ORDERSTASH_CHROME).addArguments(
      '--headless=new', '--no-first-run', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe',
      '--no-default-browser-check', '--ignore-certificate-errors', '--no-proxy-server',
      '--user-data-dir=' + path.join(output, 'profile'),
      '--host-resolver-rules=MAP www.amazon.com ' + host,
      '--disable-extensions-except=' + path.join(root, 'build'), '--load-extension=' + path.join(root, 'build'),
      '--window-size=1440,1000');
    options.get('goog:chromeOptions').enableExtensionTargets = true;
    driver = await new Builder().forBrowser('chrome').setChromeOptions(options)
      .setChromeService(new chrome.ServiceBuilder(process.env.ORDERSTASH_DRIVER)).build();
    await driver.get(fixture.origin + '/your-orders/orders?timeFilter=year-2026');
    const frame = await driver.wait(() => driver.executeScript(
      'return document.getElementById("orderstash-panel-host")?.shadowRoot.querySelector("iframe")'), 15000);
    await driver.switchTo().frame(frame);
    await driver.wait(until.elementLocated(By.id('detach')), 15000);
    await driver.wait(async () => driver.executeAsyncScript(done => chrome.runtime.sendMessage({
      target: 'background', action: 'status', origin: 'https://www.amazon.com',
    }).then(value => done(value.orders.length > 0))), 15000);
    await driver.findElement(By.id('detach')).click();
    await driver.switchTo().defaultContent();
    await driver.wait(async () => {
      for (const handle of await driver.getAllWindowHandles()) {
        await driver.switchTo().window(handle);
        if ((await driver.getCurrentUrl()).includes('detached=1')) return true;
      }
      return false;
    }, 15000);
    await driver.wait(until.elementLocated(By.css('#scope option[value="year-2026"]')), 15000);
    await driver.sendDevToolsCommand('Emulation.setDeviceMetricsOverride', {
      width: 440, height: 730, deviceScaleFactor: 1, mobile: false,
    });
    // Only fixture records are inserted; the UI and its rendering are unchanged.
    const seeded = await driver.executeAsyncScript(async done => {
      try {
        const state = await chrome.runtime.sendMessage({target: 'background', action: 'status', origin: 'https://www.amazon.com'});
        const base = state.orders[0];
        const descriptions = ['USB-C docking station', 'Wireless keyboard', 'LED desk lamp', 'Reusable storage bags', 'Notebook set', 'USB-C charging cable'];
        const totals = ['$129.99', '$49.99', '$34.95', '$18.50', '$12.99', '$15.99'];
        const dates = ['2026-11-12', '2026-11-08', '2026-10-24', '2026-10-10', '2026-09-18', '2026-08-03'];
        const orders = descriptions.map((description, index) => {
          const orderId = index ? '123-1234567-' + (1000000 + index) : base.orderId;
          const key = 'personal|www.amazon.com|' + orderId;
          return {...base, key, orderId, date: dates[index], year: 2026, total: totals[index], recipient: 'Sample account',
            detailUrl: 'https://www.amazon.com/your-orders/order-details?orderID=' + orderId,
            invoiceUrl: '', items: [{...base.items[0], description}], shipments: []};
        });
        const receipts = orders.flatMap((order, index) => (index < 4 ? ['orders', ...(index < 2 ? ['pdf'] : [])] : [])
          .map(kind => ({key: order.key + '|' + kind, orderKey: order.key, kind, runId: 'sample-' + kind,
            exportedAt: '2026-11-15T17:00:00.000Z', filename: 'OrderStash/sample-' + kind + (kind === 'pdf' ? '.pdf' : '.csv')})));
        const runs = [
          {id: 'sample-orders', label: 'Export orders CSV', kind: 'orders', status: 'complete', completed: orders.slice(0, 4).map(order => order.key)},
          {id: 'sample-pdf', label: 'Save invoice PDFs', kind: 'pdf', status: 'paused', completed: orders.slice(0, 2).map(order => order.key), pauseReason: 'Paused. Your progress has been saved.'},
          {id: 'sample-scan', label: 'Load order summaries', kind: 'scan', status: 'complete', completed: orders.map(order => order.key)},
        ].map((run, index) => ({...run, profileId: 'personal', origin: base.origin,
          startedAt: '2026-11-15T16:' + (50 - index * 10) + ':00.000Z', selected: orders.map(order => order.key), issues: [], navigations: 0}));
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open('orderstash', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const tx = database.transaction(['orders', 'receipts', 'runs'], 'readwrite');
          for (const [name, rows] of [['orders', orders], ['receipts', receipts], ['runs', runs]]) {
            tx.objectStore(name).clear();
            for (const row of rows) tx.objectStore(name).put(row);
          }
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
        });
        database.close(); done({ok: true});
      } catch (error) { done({error: String(error)}); }
    });
    assert.equal(seeded.ok, true, seeded.error);
    await driver.wait(async () => (await driver.findElement(By.id('library-count')).getText()).includes('6 unique'), 15000);
    const capture = async name => {
      await driver.executeScript('window.scrollTo(0,0)');
      const file = path.join(output, name + '.png');
      fs.writeFileSync(file, await driver.takeScreenshot(), 'base64');
      return file;
    };
    const captures = {};
    captures.export = await capture('export');
    await driver.findElement(By.css('nav [data-page="orders"]')).click();
    await driver.wait(async () => (await driver.findElements(By.css('.order-entry'))).length === 6, 15000);
    captures.orders = await capture('orders');
    await driver.findElement(By.css('#order-status option[value="pdf-pending"]')).click();
    await driver.wait(async () => (await driver.findElements(By.css('.order-entry'))).length === 4, 15000);
    captures.pending = await capture('pending');
    await driver.findElement(By.css('nav [data-page="history"]')).click();
    await driver.wait(until.elementLocated(By.css('.history-entry')), 15000);
    captures.history = await capture('history');
    await driver.findElement(By.css('nav [data-page="settings"]')).click();
    captures.settings = await capture('settings');

    await driver.switchTo().newWindow('tab');
    const render = async (name, html, width, height) => {
      const file = path.join(output, name + '.html');
      fs.writeFileSync(file, html);
      await driver.sendDevToolsCommand('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
      await driver.get(require('node:url').pathToFileURL(file).href);
      await driver.executeAsyncScript(done => Promise.all([document.fonts.ready,
        ...Array.from(document.images).map(img => img.decode())]).then(() => done(true)));
      const target = path.join(assets, name + '.png');
      fs.writeFileSync(target, await driver.takeScreenshot(), 'base64');
      console.log(target);
    };
    const slides = [
      ['screenshot-1-invoice-pdfs', 'Your invoices.\nReady to keep.', 'Save Amazon invoice pages as PDFs directly from your order history.', ['Free invoice PDFs', 'Optional export header', 'Letter or A4 paper size'], captures.export],
      ['screenshot-2-saved-orders', 'Find the order.\nKeep the record.', 'Search the orders you have saved without loading Amazon pages.', ['A local library across years', 'Search by order, item or date', 'PDF and CSV status on each order'], captures.orders],
      ['screenshot-3-export-status', 'Know what is\nalready saved.', 'PDF and CSV completion are tracked separately, so you can avoid repeat exports.', ['Filter PDFs still to export', 'Skip completed downloads', 'Keep receipts across sessions'], captures.pending],
      ['screenshot-4-history', 'Pick up where\nyou left off.', 'Review recent collections and exports, with progress saved when you pause.', ['PDFs and four CSV formats', 'Separate completion tracking', 'Resume interrupted work'], captures.history],
      ['screenshot-5-local-records', 'Your records.\nKept locally.', 'No account or subscription. Your saved orders stay in this Chrome profile.', ['No analytics or telemetry', 'No OrderStash server', 'You control saved records'], captures.settings],
    ];
    for (const [name, title, description, features, capture] of slides) await render(name, artwork(title, description, features, capture), 1280, 800);
    await render('promo-small-440x280', promo(440, 280), 440, 280);
    await render('promo-marquee-1400x560', promo(1400, 560), 1400, 560);
    fs.copyFileSync(path.join(root, 'src/assets/icon128.png'), path.join(assets, 'store-icon-128.png'));
    fs.copyFileSync(path.join(root, 'docs/brand/orderstash-logo.png'), path.join(assets, 'orderstash-logo.png'));
    console.log('Store assets rendered from isolated fixtures. Local captures: ' + output);
  } finally {
    if (driver) await driver.quit().catch(() => undefined);
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
