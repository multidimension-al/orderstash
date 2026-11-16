import 'fake-indexeddb/auto';
import {JSDOM} from 'jsdom';
import {parseListing, calendarDate, amount} from '../src/app/extract';
import {readAmazonContext} from '../src/app/context';
import {historyYearUrl} from '../src/app/live';
import {RequestPacer, PaceState} from '../src/app/pace';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fixture = require('../scripts/fixtures.cjs');

test('reads years, selected year and displayed counts directly from the open page', () => {
  const dom = new JSDOM(fixture.listing(), {
    url: fixture.origin + '/your-orders/orders?timeFilter=year-2026',
  });
  Object.assign(globalThis, {
    document: dom.window.document,
    location: dom.window.location,
  });
  Object.defineProperty(dom.window.document.body, 'innerText', {
    value: dom.window.document.body.textContent,
  });
  const context = readAmazonContext();
  expect(context.years).toEqual([2026, 2025, 2024]);
  expect(context.selectedYear).toBe(2026);
  expect(context.orderCount).toBe(2);
  expect(context.visibleCount).toBe(1);
  expect(context.pageOrderIds).toEqual([fixture.ids[0]]);
  const metadata = readAmazonContext(false);
  expect(metadata.html).toBe('');
  expect(metadata.text).toBe('');
  expect(metadata.revision).toBe(context.revision);
  dom.window.document.querySelector('.num-orders')!.textContent = '20 orders';
  expect(readAmazonContext(false).revision).not.toBe(context.revision);
});

test('year navigation preserves the marketplace and digital filters and resets pagination', () => {
  const dom = new JSDOM(fixture.listing(), {
    url: fixture.origin + '/your-orders/orders?timeFilter=year-2026&orderFilter=digital&startIndex=20',
  });
  Object.assign(globalThis, {document: dom.window.document, location: dom.window.location});
  Object.defineProperty(dom.window.document.body, 'innerText', {value: dom.window.document.body.textContent});
  const context = {...readAmazonContext(), tabId: 1, windowId: 1};
  const url = new URL(historyYearUrl(context, 2025));
  expect(url.origin).toBe(fixture.origin);
  expect(url.searchParams.get('timeFilter')).toBe('year-2025');
  expect(url.searchParams.get('orderFilter')).toBe('digital');
  expect(url.searchParams.get('startIndex')).toBe('0');
  expect(() => historyYearUrl(context, 1990)).toThrow(/available/);
  const legacy = new URL(historyYearUrl({...context, url:
    fixture.origin + '/gp/legacy/order-history?orderFilter=year-2026&digitalOrders=1&opt=ab&startIndex=30'}, 2025));
  expect(legacy.searchParams.get('orderFilter')).toBe('year-2025');
  expect(legacy.searchParams.get('digitalOrders')).toBe('1');
  expect(legacy.searchParams.get('opt')).toBe('ab');
  expect(legacy.searchParams.get('timeFilter')).toBeNull();
  expect(legacy.searchParams.get('startIndex')).toBe('0');
});
test('reads modern inline order-header labels without making detail requests', () => {
  const dom = new JSDOM('');
  Object.assign(globalThis, {document: dom.window.document, DOMParser: dom.window.DOMParser});
  const html = `<div class="order-card"><ul><li class="order-header__header-list-item">Order placed<span>October 31, 2026</span></li><li>Total<span>$21.50</span></li></ul><a href="/your-orders/order-details?orderID=${fixture.ids[0]}">Order details</a></div>`;
  const result = parseListing(
    {url: fixture.origin, html, text: html},
    'personal',
  );
  expect(result.orders[0]).toMatchObject({date: '2026-10-31', total: '$21.50'});
  expect(result.orders[0].detailsAt).toBeUndefined();
  expect(result.orders[0].items).toEqual([]);
});

test('year navigation upgrades the old personal history route to Amazon\'s current route', () => {
  const context = {
    url: fixture.origin + '/gp/css/order-history?ref_=nav_orders_first&orderFilter=year-2025&startIndex=20',
    ordersPage: true, years: [2025, 2024], origin: fixture.origin,
  };
  const url = new URL(historyYearUrl(context, 2024));
  expect(url.pathname).toBe('/your-orders/orders');
  expect(url.searchParams.get('timeFilter')).toBe('year-2024');
  expect(url.searchParams.get('orderFilter')).toBeNull();
  expect(url.searchParams.get('startIndex')).toBe('0');
  expect(url.searchParams.get('ref_')).toBeNull();
  const modern = new URL(historyYearUrl({...context,
    url: fixture.origin + '/your-orders/orders?timeFilter=year-2024&ref_=ppx_yo2ov_dt_b_filter_all_y2024'}, 2025));
  expect(modern.pathname).toBe('/your-orders/orders');
  expect(modern.searchParams.get('timeFilter')).toBe('year-2025');
  expect(modern.searchParams.has('ref_')).toBe(false);
});
test('random spacing stays above its minimum and varies with the random input', async () => {
  let state: PaceState = {nextAt: 0, cooldownUntil: 0};
  let now = 1000;
  let random = 0;
  const pacer = new RequestPacer(
    {pace: 6000, navigationLimit: 10},
    {
      now: () => now,
      random: () => random,
      sleep: async (ms) => {
        now += ms;
      },
      read: async () => state,
      write: async (value) => {
        state = value;
      },
    },
  );
  await pacer.beforeVisit();
  expect(state.nextAt - now).toBe(6000);
  random = 0.9;
  await pacer.beforeVisit();
  expect(state.nextAt - now).toBe(8700);
  expect(pacer.count).toBe(2);
});
test('calendar dates and monetary amounts are independent of the machine timezone', () => {
  expect(calendarDate('31 octobre 2026')).toBe('2026-10-31');
  expect(calendarDate('2026-02-31')).toBe('');
  expect(calendarDate('2026年10月31日')).toBe('2026-10-31');
  expect(amount('€1.234,56')).toBe(1234.56);
  expect(amount('-$5.00')).toBe(-5);
});
