import 'fake-indexeddb/auto';
import {JSDOM} from 'jsdom';
import {
  OrderStashEngine,
  recoverExports,
  recoverInterruptedRuns,
  CollectionOptions,
} from '../src/app/engine';
import {BrowserReader, PageDocument} from '../src/app/browser';
import {DEFAULT_SETTINGS, Receipt, Run} from '../src/app/model';
import {Vault} from '../src/app/vault';
import {parseListing as readListing} from '../src/app/extract';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fixture = require('../scripts/fixtures.cjs');
jest.mock('../src/app/parse', () => {
  const actual = jest.requireActual('../src/app/extract');
  return {
    parseListing: async (...args: unknown[]) => actual.parseListing(...args),
    parseDetails: async (...args: unknown[]) => actual.parseDetails(...args),
    parsePayments: async (...args: unknown[]) => actual.parsePayments(...args),
    enrichment: async (...args: unknown[]) => actual.enrichment(...args),
  };
});
const vault = new Vault();
const dom = new JSDOM('');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XPathResult: dom.window.XPathResult,
});
let clock: number;
let storage: Record<string, unknown>;
const search = jest.fn();
beforeEach(() => {
  clock = 1000000;
  storage = {};
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  Object.assign(globalThis, {
    chrome: {
      storage: {
        local: {
          get: jest.fn(async (key) => ({[key]: storage[key]})),
          set: jest.fn(async (value) => {
            Object.assign(storage, value);
          }),
        },
      },
      webRequest: {
        onHeadersReceived: {addListener: jest.fn(), removeListener: jest.fn()},
      },
      downloads: {search},
    },
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  search.mockReset();
});

const options: CollectionOptions = {
  from: '2026-01-01',
  through: '2026-12-31',
  digital: false,
  details: true,
  refresh: true,
  categories: false,
  tracking: false,
  quick: false,
  resume: false,
};
function readerMock(): string[] {
  const visited: string[] = [];
  jest
    .spyOn(BrowserReader.prototype, 'visit')
    .mockImplementation(async function (
      this: BrowserReader,
      url: string,
    ): Promise<PageDocument> {
      await this.pacer.beforeVisit();
      visited.push(url);
      const address = new URL(url);
      const html = address.pathname.includes('order-details')
        ? fixture.details(address.searchParams.get('orderID'))
        : fixture.listing(
            address.searchParams.get('startIndex') === '10' ? 1 : 0,
          );
      return {
        url,
        html,
        text: new JSDOM(html).window.document.body.textContent || '',
      };
    });
  return visited;
}
function worker(profileId: string, limit: number): OrderStashEngine {
  const engine = new OrderStashEngine(
    vault,
    {...DEFAULT_SETTINGS, profileId, navigationLimit: limit},
    () => undefined,
  );
  engine.pacer.io.random = () => 0;
  engine.pacer.io.sleep = async (ms) => {
    clock += ms;
  };
  return engine;
}
test('refresh collection resumes after the last completed detail, without a request loop', async () => {
  const visited = readerMock();
  const first = worker('resume-test', 3);
  await expect(first.collect(options)).rejects.toThrow(/cooling down|limit/);
  expect(visited).toHaveLength(3);
  expect(
    (await vault.scopedOrders('resume-test', fixture.origin)).filter(
      (o) => o.detailsAt,
    ),
  ).toHaveLength(1);
  clock += 5 * 60000;
  const resumed = worker('resume-test', 3);
  await resumed.collect({...options, resume: true});
  expect(visited).toHaveLength(4);
  expect(visited[3]).toContain(fixture.ids[1]);
  expect(
    (await vault.scopedOrders('resume-test', fixture.origin)).filter(
      (o) => o.detailsAt,
    ),
  ).toHaveLength(2);
  expect(
    await vault.get('meta', `cursor|resume-test|${fixture.origin}`),
  ).toBeUndefined();
});
test('a user pause records a pause reason without creating an issue', async () => {
  readerMock();
  const engine = worker('user-pause-test', 10);
  engine.pause();
  await expect(engine.collect(options)).rejects.toThrow(/Paused/);
  const run = (await vault.all<Run>('runs')).find(row => row.profileId === 'user-pause-test');
  expect(run?.status).toBe('paused');
  expect(run?.issues).toEqual([]);
  expect(run?.pauseReason).toMatch(/Paused/);
});

test('continues beyond 30 cached summaries and resumes at the saved page when the source tab changes', async () => {
  const profile = 'long-collection';
  const sourceUrl = fixture.origin + '/your-orders/orders?timeFilter=year-2026&startIndex=0';
  const document = (index: number, url = sourceUrl): PageDocument => {
    const html = fixture.longListing(index);
    return {url, html, text: new JSDOM(html).window.document.body.textContent || ''};
  };
  for (let index = 0; index < 3; index++) {
    await vault.saveSummaries(readListing(document(index), profile).orders);
  }
  const visited: string[] = [];
  jest.spyOn(BrowserReader.prototype, 'visit').mockImplementation(async function(this: BrowserReader, url) {
    await this.pacer.beforeVisit();
    visited.push(url);
    return document(Number(new URL(url).searchParams.get('startIndex')) / 10, url);
  });
  const selection = {...options, sourceUrl, details: false, refresh: false};
  await expect(worker(profile, 2).collect(selection, document(0))).rejects.toThrow(/cooling down|limit/);
  expect((await vault.scopedOrders(profile, fixture.origin))).toHaveLength(30);
  clock += 5 * 60000;
  await worker(profile, 10).collect({...selection, resume: true,
    sourceUrl: fixture.origin + '/your-orders/orders?ref_=changed&startIndex=20&timeFilter=year-2026'});
  expect(visited.map(url => new URL(url).searchParams.get('startIndex'))).toEqual(['10', '20', '30', '40']);
  expect((await vault.scopedOrders(profile, fixture.origin))).toHaveLength(50);
  const runs = (await vault.all<Run>('runs')).filter(run => run.profileId === profile);
  expect(runs.map(run => run.status).sort()).toEqual(['complete', 'paused']);
  expect(runs.every(run => run.issues.length === 0)).toBe(true);
});

test('reconciles orphaned running history without losing a collection cursor or pending download', async () => {
  const run: Run = {id: 'orphaned-scan', profileId: 'orphan', origin: fixture.origin,
    kind: 'scan', startedAt: '', status: 'running', selected: ['saved-order'],
    completed: [], issues: [], navigations: 3, label: 'Collect order history'};
  await vault.put('runs', run);
  await vault.put('runs', {...run, id: 'orphaned-pdf', kind: 'pdf', downloadId: 0, pendingKey: 'saved-order'});
  await vault.put('meta', {key: 'cursor|orphan', value: {url: 'saved-next-page'}});
  await recoverInterruptedRuns(vault);
  const recovered = await vault.get<Run>('runs', run.id);
  expect(recovered).toMatchObject({status: 'paused', selected: ['saved-order'], issues: []});
  expect(recovered?.pauseReason).toMatch(/worker stopped/);
  expect(await vault.get('meta', 'cursor|orphan')).toEqual({key: 'cursor|orphan', value: {url: 'saved-next-page'}});
  expect(await vault.get('runs', 'orphaned-pdf')).toMatchObject({status: 'paused', downloadId: 0, pendingKey: 'saved-order'});
});

test('finalizes history if collection setup fails after a run is created', async () => {
  const engine = worker('setup-failure', 10);
  jest.spyOn(vault, 'scopedOrders').mockRejectedValueOnce(new Error('Storage could not be read.'));
  await expect(engine.collect({...options, details: false})).rejects.toThrow(/Storage could not/);
  const run = (await vault.all<Run>('runs')).find(row => row.profileId === 'setup-failure');
  expect(run?.status).toBe('failed');
  expect(run?.issues[0].message).toMatch(/Storage could not/);
});
test('reconciles a completed download before recording a PDF export, including download ID zero', async () => {
  const key = 'recovery|www.amazon.com|' + fixture.ids[0];
  const run: Run = {
    id: 'recovery',
    profileId: 'recovery',
    origin: fixture.origin,
    kind: 'pdf',
    startedAt: '',
    status: 'running',
    selected: [key],
    completed: [],
    issues: [],
    navigations: 1,
    label: 'PDF',
    pendingKey: key,
    downloadId: 0,
  };
  await vault.put('runs', run);
  search.mockResolvedValue([{state: 'in_progress'}]);
  await expect(recoverExports(vault)).rejects.toThrow(/still in progress/);
  expect(await vault.get('receipts', key + '|pdf')).toBeUndefined();
  search.mockResolvedValue([
    {state: 'complete', exists: true, filename: 'invoice.pdf'},
  ]);
  await recoverExports(vault);
  expect((await vault.get<Receipt>('receipts', key + '|pdf'))?.downloadId).toBe(
    0,
  );
  expect((await vault.get<Run>('runs', run.id))?.status).toBe('complete');
  expect(await vault.get('receipts', key + '|orders')).toBeUndefined();
});
test('keeps Business group parameters and the legacy year filter when using an orders tab', async () => {
  const visited = readerMock();
  const engine = worker('business-source-test', 10);
  await engine.collect({
    ...options,
    details: false,
    sourceUrl:
      fixture.origin +
      '/gp/legacy/order-history?groupId=chosen&orderFilter=year-2025',
  });
  const first = new URL(visited[0]);
  expect(first.searchParams.get('groupId')).toBe('chosen');
  expect(first.searchParams.get('orderFilter')).toBe('year-2026');
  expect(first.searchParams.has('timeFilter')).toBe(false);
  const run = (await vault.all<Run>('runs')).find(
    (r) => r.profileId === 'business-source-test',
  );
  expect(run?.selected).toHaveLength(2);
});

test('summary collection upgrades personal history links to the current year route', async () => {
  const visited = readerMock();
  await worker('personal-current-route', 10).collect({...options, details: false,
    sourceUrl: fixture.origin + '/gp/css/order-history?ref_=nav_orders_first&orderFilter=year-2025&startIndex=10'});
  const first = new URL(visited[0]);
  expect(first.pathname).toBe('/your-orders/orders');
  expect(first.searchParams.get('timeFilter')).toBe('year-2026');
  expect(first.searchParams.get('orderFilter')).toBeNull();
  expect(first.searchParams.get('ref_')).toBeNull();
  expect((await vault.scopedOrders('personal-current-route', fixture.origin))).toHaveLength(2);
});
test('summary-only collection reuses the open page, visits only the next index, and stores no HTML', async () => {
  const visited = readerMock();
  const engine = worker('summary-default-test', 10);
  const url = fixture.origin + '/your-orders/orders?timeFilter=year-2026';
  const html = fixture.listing();
  const seed = {
    url,
    html,
    text: new JSDOM(html).window.document.body.textContent || '',
  };
  await engine.collect(
    {...options, details: false, refresh: false, sourceUrl: url},
    seed,
  );
  expect(visited).toHaveLength(1);
  expect(visited[0]).toContain('startIndex=10');
  expect(visited[0]).not.toContain('order-details');
  const orders = await vault.scopedOrders(
    'summary-default-test',
    fixture.origin,
  );
  expect(orders).toHaveLength(2);
  expect(orders.every((o) => !o.detailsAt && o.items.length === 1)).toBe(true);
  expect(JSON.stringify(await vault.all('meta'))).not.toContain('<html');
});

test('browsing two cached pages does not hide later uncached orders in a year export', async () => {
  const profile = 'passive-cache-test';
  const url = fixture.origin + '/your-orders/orders?timeFilter=year-2026';
  const document = (html: string, address = url): PageDocument => ({
    html, url: address, text: new JSDOM(html).window.document.body.textContent || '',
  });
  const first = document(fixture.listing());
  const secondHtml = fixture.listing(1).replace('</body>',
    '<a rel="next" href="/your-orders/orders?timeFilter=year-2026&amp;startIndex=20">Next</a></body>');
  const thirdHtml = fixture.listing(1).replaceAll(fixture.ids[1], '678-1234567-1234567');
  await vault.saveSummaries([
    ...readListing(first, profile).orders,
    ...readListing(document(secondHtml), profile).orders,
  ]);
  const visited: string[] = [];
  jest.spyOn(BrowserReader.prototype, 'visit').mockImplementation(async function(address) {
    visited.push(address);
    return document(new URL(address).searchParams.get('startIndex') === '20' ? thirdHtml : secondHtml, address);
  });
  await worker(profile, 10).collect({
    ...options, details: false, refresh: false, quick: false, sourceUrl: url,
  }, first);
  expect(visited.map(address => new URL(address).searchParams.get('startIndex'))).toEqual(['10', '20']);
  expect(await vault.scopedOrders(profile, fixture.origin)).toHaveLength(3);
});
