export interface AmazonContext {
  tabId: number;
  windowId: number;
  url: string;
  origin: string;
  ordersPage: boolean;
  years: number[];
  selectedYear?: number;
  orderCount?: number;
  visibleCount: number;
  account: string;
  html: string;
  text: string;
  pageOrderIds: string[];
  revision: string;
}
// Runs in the Amazon tab. This reads existing DOM; it makes no web requests.
export function readAmazonContext(includePage = true) {
  const cardSelector = '.js-order-card, .order-card, .order, #orderCard';
  const cards = Array.from(document.querySelectorAll(cardSelector)).filter(
    (e) => !e.parentElement?.closest(cardSelector),
  );
  const options = Array.from(
    document.querySelectorAll<HTMLElement>(
      'select option, .a-dropdown-link, [role="option"], [data-value^="year-"]',
    ),
  );
  const years = options
    .map((o) =>
      Number(
        (
          o.getAttribute('value') ||
          o.getAttribute('data-value') ||
          o.textContent ||
          ''
        ).match(/\b(?:19|20)\d{2}\b/)?.[0],
      ),
    )
    .filter((y) => y >= 1990 && y <= new Date().getFullYear());
  const address = new URL(location.href);
  const selected = document.querySelector<HTMLSelectElement>(
    'select[name="timeFilter"], select[name="orderFilter"], #timeFilterDropdown',
  )?.value;
  const filter =
    [
      selected,
      address.searchParams.get('timeFilter'),
      address.searchParams.get('orderFilter'),
    ].find((v) => /year-(?:19|20)\d{2}/.test(v || '')) || '';
  const selectedYear =
    Number(filter.match(/year-((?:19|20)\d{2})/)?.[1]) || undefined;
  if (selectedYear) {
    years.push(selectedYear);
  }
  const body = document.body.innerText;
  const countText =
    document.querySelector(
      '.num-orders, #num-orders, .your-orders-content-container .num-orders',
    )?.textContent ||
    body.match(/\b[\d,]+\s+orders?(?:\s+placed)?\b/i)?.[0] ||
    '';
  const orderCount = Number(countText.match(/[\d,]+/)?.[0].replace(/,/g, ''));
  let hash = 2166136261;
  for (const card of cards) {
    for (const character of card.innerHTML) {
      hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    }
  }
  return {
    url: location.href,
    origin: location.origin,
    ordersPage: /order-history|\/your-orders\/orders/.test(location.pathname),
    years: [...new Set(years)].sort((a, b) => b - a),
    selectedYear,
    orderCount:
      Number.isFinite(orderCount) && /\d/.test(countText)
        ? orderCount
        : undefined,
    visibleCount: cards.length,
    account:
      document
        .querySelector('#nav-link-accountList-nav-line-1')
        ?.textContent?.trim() || '',
    pageOrderIds: cards
      .map(
        (e) => e.getAttribute('data-order-id') ||
          e.textContent?.match(/(?:\d{3}|D\d{2})-\d{7}-\d{7}/)?.[0] ||
          Array.from(e.querySelectorAll('a[href]')).map(link =>
            link.getAttribute('href')?.match(/(?:\d{3}|D\d{2})-\d{7}-\d{7}/)?.[0]).find(Boolean) || '',
      )
      .filter(Boolean),
    revision: JSON.stringify([
      location.href, selectedYear, years, countText, hash,
    ]),
    html: includePage ? document.documentElement.outerHTML : '',
    text: includePage ? body : '',
  };
}
