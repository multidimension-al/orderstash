import {findSourceTab} from '../src/app/source';

const orders = (id: number, active = false) => ({id, active, url: 'https://www.amazon.com/your-orders/orders?timeFilter=year-2026'});
const tabs = [orders(2), {id: 3, active: true, url: 'https://example.com'},
  {id: 4, active: false, url: 'https://www.amazon.com/gp/css/summary/print.html#orderstash-invoice'},
  {id: 5, active: false, url: 'https://www.amazon.com/'}];
beforeEach(() => Object.assign(globalThis, {chrome: {tabs: {
  get: jest.fn(async id => { const tab = tabs.find(tab => tab.id === id); if (!tab) throw new Error('closed'); return tab; }),
  query: jest.fn(async filter => filter.active ? tabs.filter(tab => tab.active) : tabs),
}}}));

test('recovers an open orders tab when the panel’s pinned source was closed', async () => {
  expect((await findSourceTab(99, undefined, 'https://www.amazon.com', true))?.id).toBe(2);
});
test('never reconnects to an invoice worker or an unrelated active site', async () => {
  expect((await findSourceTab(4, undefined, 'https://www.amazon.com', true))?.id).toBe(2);
});
test('an explicit valid source stays selected while another site is active', async () => {
  expect((await findSourceTab(2))?.id).toBe(2);
});
test('Resume finds Orders even when the old source has navigated to the Amazon homepage', async () => {
  expect((await findSourceTab(5, undefined, 'https://www.amazon.com', true))?.id).toBe(2);
});
test('the toolbar uses the active Amazon tab before a previously remembered tab', async () => {
  (chrome.tabs.query as jest.Mock).mockImplementation(async filter => filter.active ? [orders(8, true)] : tabs);
  expect((await findSourceTab(undefined, 2))?.id).toBe(8);
});
