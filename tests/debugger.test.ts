import {ChromeInvoiceExporter, cleanupInvoiceDebugger} from '../src/invoices/chrome';

let storage: Record<string, unknown>;
let updated: (id: number, changes: chrome.tabs.TabChangeInfo) => void;
beforeEach(() => {
  storage = {};
  Object.assign(globalThis, {chrome: {
    storage: {local: {get: async () => storage, set: async (value: Record<string, unknown>) => Object.assign(storage, value),
      remove: async (key: string) => { delete storage[key]; }}},
    tabs: {create: async () => ({id: 10}), remove: jest.fn(),
      onUpdated: {addListener: (listener: typeof updated) => { updated = listener; }, removeListener: jest.fn()}},
    debugger: {attach: jest.fn(async () => undefined), detach: jest.fn(async () => undefined),
      sendCommand: jest.fn(async () => ({})), onDetach: {addListener: jest.fn(), removeListener: jest.fn()}},
  }});
});
test('debugging stays on the invoice tab when another tab navigates, and detaches on close', async () => {
  const exporter = new ChromeInvoiceExporter();
  await exporter.open();
  updated(20, {url: 'https://example.com'});
  expect(chrome.debugger.detach).not.toHaveBeenCalled();
  expect(chrome.debugger.attach).toHaveBeenCalledWith({tabId: 10}, '1.3');
  await exporter.close(true);
  expect(chrome.debugger.detach).toHaveBeenCalledWith({tabId: 10});
});
test('releases the attachment if the invoice tab itself leaves Amazon', async () => {
  const exporter = new ChromeInvoiceExporter();
  await exporter.open();
  updated(10, {url: 'https://example.com'});
  await new Promise(resolve => setImmediate(resolve));
  expect(chrome.debugger.detach).toHaveBeenCalledWith({tabId: 10});
});
test('a restarted worker releases only its recorded invoice attachment', async () => {
  storage.orderstash_invoice_debugger_tab = 10;
  await cleanupInvoiceDebugger();
  expect(chrome.debugger.detach).toHaveBeenCalledTimes(1);
  expect(chrome.debugger.detach).toHaveBeenCalledWith({tabId: 10});
  expect(storage.orderstash_invoice_debugger_tab).toBeUndefined();
});
