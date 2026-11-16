import {amazonUrl} from '../invoices/core';
import {MARKETPLACES} from './model';

export function isSourceUrl(value: string): boolean {
  try { return !amazonUrl(value).hash.startsWith('#orderstash'); }
  catch { return false; }
}

// An old panel's source ID can disappear or become an invoice worker. Recover
// from actual open tabs instead of leaving Resume dependent on a refresh click.
export async function findSourceTab(preferred?: number, remembered?: number, origin?: string, ordersOnly = false) {
  const usable = (tab?: chrome.tabs.Tab) => tab?.url && isSourceUrl(tab.url) &&
    (!ordersOnly || /\/your-orders\/orders|\/order-history/.test(new URL(tab.url).pathname));
  if (preferred === undefined) {
    const [active] = await chrome.tabs.query({active: true, currentWindow: true});
    if (usable(active)) return active;
  }
  for (const id of [preferred, remembered]) {
    if (id === undefined) continue;
    const tab = await chrome.tabs.get(id).catch(() => undefined);
    if (usable(tab)) return tab;
  }
  const tabs = (await chrome.tabs.query({url: MARKETPLACES.map(site => site + '/*')}))
    .filter(usable);
  const rank = (tab: chrome.tabs.Tab) => {
    const url = new URL(tab.url!);
    return (origin && url.origin !== origin ? 8 : 0) +
      (/\/your-orders\/orders|\/order-history/.test(url.pathname) ? 0 : 4) +
      (tab.active ? 0 : 1);
  };
  return tabs.sort((a, b) => rank(a) - rank(b))[0];
}
