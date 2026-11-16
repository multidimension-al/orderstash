import 'fake-indexeddb/auto';
import {JSDOM} from 'jsdom';
import {
  csvCell,
  csvRows,
  DEFAULT_SETTINGS,
  OrderRecord,
  orderKey,
  pendingOrders,
  Receipt,
  Run,
  SiteBlocked,
  WorkPaused,
  BudgetCooldown,
} from '../src/app/model';
import {RequestPacer, PaceState, retryAfterMs} from '../src/app/pace';
import {parseDetails, parseListing, parsePayments} from '../src/app/extract';
import {checkDocument} from '../src/app/extract';
import {Vault} from '../src/app/vault';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fixture = require('../scripts/fixtures.cjs');
const origin = fixture.origin as string;
const page = (html: string) => ({
  url: origin + '/your-orders/orders',
  html,
  text: new JSDOM(html).window.document.body.textContent || '',
});
const dom = new JSDOM('');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XPathResult: dom.window.XPathResult,
});

beforeAll(() => {
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('OrderStash document collection', () => {
  test('reads real-shaped cards and only follows the provided next link', () => {
    const first = parseListing(page(fixture.listing()), 'personal');
    expect(first.orders).toHaveLength(1);
    expect(first.next).toContain('startIndex=10');
    expect(first.orders[0]).toMatchObject({
      orderId: fixture.ids[0],
      date: '2026-10-31',
      total: '$21.50',
      recipient: 'Synthetic Test',
    });
    expect(first.orders[0].items[0]).toMatchObject({
      quantity: 2,
      url: origin + '/gp/product/B000000000',
      asin: 'B000000000',
    });
    const second = parseListing(page(fixture.listing(1)), 'personal');
    expect(second.next).toBeUndefined();
    expect(second.orders[0].items[0].description).toBe('Replacement cable');
  });
  test('parses details without a scheduler and rejects the wrong order', () => {
    const order = parseListing(page(fixture.listing()), 'personal').orders[0];
    const detailPage = page(fixture.details(order.orderId));
    const record = parseDetails(detailPage, order);
    expect(record.detailsAt).toBeTruthy();
    expect(record.shipments).toHaveLength(1);
    expect(record.shipments[0].status).toContain('Delivered');
    expect(record.items).toHaveLength(1);
    expect(record.invoiceUrl).toContain('/summary/print.html');
    expect(() =>
      parseDetails(page(fixture.details(fixture.ids[1])), order),
    ).toThrow(/expected order/);
  });
  test('distinguishes an empty account from an unsupported layout', () => {
    expect(
      parseListing(page('<h1>No orders found</h1>'), 'personal').empty,
    ).toBe(true);
    expect(() =>
      parseListing(page('<h1>Your Orders</h1>'), 'personal'),
    ).toThrow(/incomplete/);
    expect(() =>
      parseListing(
        page('<div class="order-card">Unknown card</div>'),
        'personal',
      ),
    ).toThrow(/silently skipped/);
  });
  test('retains transaction dates, order references and signed refund amounts', () => {
    const payments = parsePayments(
      page(fixture.transactions(1)),
      'personal',
      origin,
    );
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      date: '2026-10-30',
      amount: -5,
      orderIds: [fixture.ids[1]],
      cardInfo: 'Visa ****1234',
    });
  });
  test('does not export sign-in, CAPTCHA or unexpected-origin pages', () => {
    expect(() => checkDocument(page('<input id="ap_email">'), origin)).toThrow(
      WorkPaused,
    );
    expect(() =>
      checkDocument(page('<input id="captchacharacters">'), origin),
    ).toThrow(SiteBlocked);
    expect(() =>
      checkDocument({...page('Invoice'), url: 'https://example.com'}, origin),
    ).toThrow();
  });
});

function pacer(limit = 3) {
  let now = 100000;
  let state: PaceState = {nextAt: 0, cooldownUntil: 0};
  const sleeps: number[] = [];
  const worker = new RequestPacer(
    {pace: 6000, navigationLimit: limit},
    {
      now: () => now,
      random: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      read: async () => ({...state}),
      write: async (value) => {
        state = value;
      },
    },
  );
  return {worker, state: () => state, now: () => now, sleeps};
}
describe('OrderStash request limits', () => {
  test('paces every visit and persists a budget cooldown', async () => {
    const {worker, state, now} = pacer(2);
    await worker.beforeVisit();
    await worker.beforeVisit();
    expect(now()).toBe(106000);
    expect(worker.count).toBe(2);
    await expect(worker.beforeVisit()).rejects.toThrow(/limit|cooling down/);
    expect(state().cooldownUntil).toBe(now() + 300000);
    const reopened = new RequestPacer(DEFAULT_SETTINGS, worker.io);
    await expect(reopened.beforeVisit()).rejects.toBeInstanceOf(BudgetCooldown);
    expect(reopened.count).toBe(0);
  });
  test('pauses without consuming another visit and honors Retry-After', async () => {
    const {worker, state, now} = pacer();
    worker.paused = true;
    await expect(worker.beforeVisit()).rejects.toThrow(/Paused/);
    expect(worker.count).toBe(0);
    await expect(
      worker.block(new SiteBlocked('HTTP 429', 3600000)),
    ).rejects.toThrow(SiteBlocked);
    expect(state().cooldownUntil).toBe(now() + 3600000);
    expect(state().cooldownReason).toBe('blocked');
    await expect(new RequestPacer(DEFAULT_SETTINGS, worker.io).beforeVisit()).rejects.not.toBeInstanceOf(BudgetCooldown);
    expect(retryAfterMs('3600', 0)).toBe(3600000);
    expect(retryAfterMs('Thu, 01 Jan 1970 01:00:00 GMT', 0)).toBe(3600000);
    expect(retryAfterMs('garbage', 0)).toBe(1800000);
  });
});

describe('OrderStash local export receipts', () => {
  const vault = new Vault();
  const order = () => parseListing(page(fixture.listing()), 'test').orders[0];
  test('browsed pages accumulate unique records across rereads and storage instances', async () => {
    const profile = 'browsed-library';
    const first = parseListing(page(fixture.listing()), profile).orders;
    const second = parseListing(page(fixture.listing(1)), profile).orders;
    await vault.saveSummaries(first);
    await vault.saveSummaries(second);
    await vault.saveSummaries([...first, ...second, ...first]);
    const reopened = new Vault();
    expect(await reopened.scopedOrders(profile, origin)).toHaveLength(2);
    await reopened.saveSummaries([{...first[0], total: '$99.00'}]);
    expect(await vault.scopedOrders(profile, origin)).toHaveLength(2);
    expect((await vault.get<OrderRecord>('orders', first[0].key))?.total).toBe('$99.00');
    await vault.clearProfile(profile);
  });
  test('passive capture keeps identifiable orders when a date is missing', () => {
    const html = fixture.listing().replace('October 31, 2026', 'Date not displayed')
      .replace('</body>', '<div class="order-card">Unidentifiable card</div></body>');
    expect(() => parseListing(page(html), 'test')).toThrow(/could not be read/);
    const result = parseListing(page(html), 'test', true);
    expect(result.orders[0].orderId).toBe(fixture.ids[0]);
    expect(result.orders[0].date).toBe('');
    expect(result.warnings).toHaveLength(2);
  });
  test('passive summaries preserve enriched data and never create export receipts', async () => {
    const first = order();
    const detail = parseDetails(page(fixture.details(first.orderId)), first);
    detail.invoiceUrl = origin + '/gp/css/summary/print.html?orderID=' + first.orderId;
    detail.items[0].category = 'Tools';
    detail.items.push({...detail.items[0], url: origin + '/dp/B000000099', description: 'Detail-only item'});
    await vault.put('orders', detail);
    const before = await vault.all<Receipt>('receipts');
    await vault.saveSummaries([{...first, total: '$25.00', invoiceUrl: ''}]);
    const saved = await vault.get<OrderRecord>('orders', first.key);
    expect(saved?.total).toBe('$25.00');
    expect(saved?.detailsAt).toBe(detail.detailsAt);
    expect(saved?.details).toEqual(detail.details);
    expect(saved?.shipments).toEqual(detail.shipments);
    expect(saved?.items[0].category).toBe('Tools');
    expect(saved?.items).toHaveLength(2);
    expect(saved?.invoiceUrl).toBe(detail.invoiceUrl);
    expect(await vault.all<Receipt>('receipts')).toEqual(before);
    await vault.clearProfile('test');
  });
  test('keeps PDF, CSV views, profiles and marketplaces separate', async () => {
    const first = order();
    const second = {
      ...first,
      key: orderKey('other', origin, first.orderId),
      profileId: 'other',
    };
    const run: Run = {
      id: 'receipt-test',
      kind: 'orders',
      profileId: 'test',
      origin,
      startedAt: new Date().toISOString(),
      status: 'running',
      selected: [first.key],
      completed: [],
      issues: [],
      navigations: 0,
      label: 'test',
    };
    await vault.put('orders', first);
    await vault.put('orders', second);
    await vault.completeExport(run, [first.key], 'orders', 'orders.csv', 42);
    const receipts = await vault.all<Receipt>('receipts');
    expect(pendingOrders([first, second], receipts, 'orders')).toEqual([
      second,
    ]);
    expect(pendingOrders([first, second], receipts, 'pdf')).toHaveLength(2);
    expect(pendingOrders([first], receipts, 'items')).toHaveLength(1);
    expect((await vault.get<Run>('runs', run.id))?.completed).toEqual([
      first.key,
    ]);
    expect(await vault.scopedOrders('other', origin)).toEqual([second]);
    expect(await vault.scopedOrders('test', 'https://www.amazon.ca')).toEqual(
      [],
    );
    await vault.clearProfile('test');
    expect(
      (await vault.all<Receipt>('receipts')).some(
        (r) => r.orderKey === first.key,
      ),
    ).toBe(false);
    expect(await vault.scopedOrders('other', origin)).toHaveLength(1);
  });
  test('escapes formulas, quotes and embedded line breaks in CSV', () => {
    expect(csvCell('=HYPERLINK("evil")')).toBe('"\'=HYPERLINK(""evil"")"');
    expect(csvCell('  +SUM(1,2)')).toBe('"\'  +SUM(1,2)"');
    expect(csvCell('-1+HYPERLINK("evil")')).toMatch(/^"'/);
    expect(csvCell(-12.5)).toBe('"-12.5"');
    const rows = csvRows(
      [{...order(), recipient: 'A\nB'} as OrderRecord],
      'orders',
    );
    expect(rows[1][3]).toBe('A\nB');
  });
});
