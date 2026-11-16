import {amazonUrl} from '../invoices/core';
import type {AmazonContext} from './context';

// A period selection is a user navigation, never a background history scan.
export function historyYearUrl(
  context: Pick<AmazonContext, 'ordersPage' | 'years' | 'url' | 'origin'>,
  year: number,
): string {
  if (!context.ordersPage || !context.years.includes(year)) {
    throw new Error('Choose a year available in Amazon\'s history filter.');
  }
  return yearPageUrl(context.url, context.origin, year).href;
}

// Personal order history uses the current route even when the source tab was
// reached through Amazon's older account-navigation link.
export function yearPageUrl(value: string, origin: string, year: number): URL {
  const url = amazonUrl(value, origin);
  const legacy = /order-history/.test(url.pathname) &&
    (url.searchParams.get('opt') === 'ab' || url.searchParams.has('groupId'));
  const digital = url.searchParams.get('digitalOrders') === '1';
  if (!legacy) url.pathname = '/your-orders/orders';
  url.searchParams.set(legacy ? 'orderFilter' : 'timeFilter', `year-${year}`);
  if (legacy) url.searchParams.delete('timeFilter');
  else {
    if (/^year-/.test(url.searchParams.get('orderFilter') || '')) {
      url.searchParams.delete('orderFilter');
    }
    if (digital) url.searchParams.set('orderFilter', 'digital');
    url.searchParams.delete('digitalOrders');
    url.searchParams.delete('unifiedOrders');
  }
  // Navigation attribution from the previous page/year does not belong here.
  url.searchParams.delete('ref_');
  url.searchParams.delete('ref');
  url.searchParams.set('startIndex', '0');
  url.hash = '';
  return url;
}
