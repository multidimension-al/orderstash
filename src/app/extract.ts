import {amazonUrl} from '../invoices/core';
import {
  Item,
  OrderDetails,
  OrderRecord,
  orderKey,
  Payment,
  Shipment,
  SiteBlocked,
  WorkPaused,
} from './model';
import type {PageDocument} from './browser';

const ORDER = /(?:\d{3}|D\d{2})-\d{7}-\d{7}/;
const cardsSelector = '.js-order-card, .order-card, .order, #orderCard';
const text = (node: Node | null | undefined) =>
  node?.textContent?.replace(/\s+/g, ' ').trim() || '';
const documentOf = (html: string): DocumentFragment => {
  // DOMParser checks snapshot styles against the extension's CSP in Chrome.
  // Template contents stay inert: no styles, scripts or embedded resources are
  // activated. Read the fragment directly; never insert it into the page.
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
};
const clean = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.:]/g, '')
    .trim();
const months = [
  'jan january janvier januar gennaio enero',
  'feb february fevrier februar febbraio febrero',
  'mar march mars marz marzo',
  'apr april avril aprile abril',
  'may mai maggio mayo',
  'jun june juin juni giugno junio',
  'jul july juillet juli luglio julio',
  'aug august aout agosto',
  'sep sept september septembre settembre septiembre',
  'oct october octobre oktober ottobre octubre',
  'nov november novembre noviembre',
  'dec december decembre dezember dicembre diciembre',
].map((s) => s.split(' '));

export function calendarDate(raw: string): string {
  const value = clean(raw);
  const iso = value.match(/\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/);
  const year = Number(iso?.[1] || value.match(/\b(?:19|20)\d{2}\b/)?.[0]);
  let month = Number(iso?.[2]);
  let day = Number(iso?.[3]);
  if (!iso) {
    const tokens = value.split(/[^a-z0-9]+/).filter(Boolean);
    month =
      months.findIndex((names) => names.some((n) => tokens.includes(n))) + 1;
    day = Number(tokens.find((t) => /^\d{1,2}$/.test(t)));
    const asian = raw.match(/((?:19|20)\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    if (asian) {
      month = Number(asian[2]);
      day = Number(asian[3]);
    }
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1990 &&
    month > 0 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : '';
}
export function amount(raw: string): number {
  let value = raw.replace(/[^\d,.-]/g, '');
  const separator = Math.max(value.lastIndexOf(','), value.lastIndexOf('.'));
  if (separator >= 0) {
    const decimal = value.length - separator - 1;
    value =
      decimal === 2
        ? value.slice(0, separator).replace(/[,.]/g, '') +
          '.' +
          value.slice(separator + 1)
        : value.replace(/[,.]/g, '');
  }
  const number = Number(value);
  return /\d/.test(value) && Number.isFinite(number)
    ? /\([^)]*\d[^)]*\)/.test(raw)
      ? -Math.abs(number)
      : number
    : NaN;
}
function price(raw: string): string {
  return (
    raw.match(
      /(?:[-−]\s*)?(?:[$£€¥₹]|USD|CAD|AUD|GBP|EUR|JPY|INR|AED|SAR|MXN)\s*[\d][\d,.]*(?:\s*(?:USD|CAD|AUD|GBP|EUR))?/,
    )?.[0] ||
    raw.match(/[-−]?\d[\d,.]*\s*(?:[$£€¥₹]|USD|CAD|AUD|GBP|EUR)/)?.[0] ||
    ''
  );
}
function labeled(root: ParentNode, labels: string[]): string {
  const elements = Array.from(
    root.querySelectorAll('span,div,li,dt,td,th,b,strong,label'),
  );
  for (const label of labels) {
    for (const node of elements) {
      const content = text(node);
      if (content.length > 180 || !clean(content).startsWith(clean(label))) {
        continue;
      }
      if (
        Array.from(node.children).some((child) =>
          clean(text(child)).startsWith(clean(label)),
        )
      ) {
        continue;
      }
      const rest = content
        .slice(label.length)
        .replace(/^\s*[:：]\s*/, '')
        .trim();
      if (
        rest &&
        (content[label.length] === ':' ||
          /^\s|[$£€¥₹\d]/.test(content.slice(label.length)) ||
          calendarDate(rest))
      ) {
        return rest;
      }
      if (clean(content) !== clean(label)) {
        continue;
      }
      let target: Element | null = node;
      for (
        let depth = 0;
        target && depth < 3;
        depth++, target = target.parentElement
      ) {
        const value = text(target.nextElementSibling);
        if (value && value.length < 200 && clean(value) !== clean(label)) {
          return value;
        }
      }
    }
  }
  return '';
}
export function itemsFrom(root: ParentNode, origin: string): Item[] {
  const anchors = Array.from(
    root.querySelectorAll<HTMLAnchorElement>(
      '[data-component="itemTitle"] a, .a-fixed-left-grid-inner a[href*="/product/"], ' +
        '.a-fixed-left-grid-inner a[href*="/dp/"], .order-item a[href*="/dp/"], ' +
        '.yohtmlc-product-title a, a.yohtmlc-product-title',
    ),
  );
  const result: Item[] = [];
  const visited = new Set<Element>();
  for (const link of anchors) {
    const description = text(link);
    if (!description || link.closest('#navFooter, #rhf, .recommendations')) {
      continue;
    }
    const container =
      link.closest(
        '.a-fixed-left-grid-inner, .order-item, .yohtmlc-item, [data-component="item"]',
      ) ||
      link.closest('[data-component="itemTitle"]')?.parentElement ||
      link.parentElement!;
    if (visited.has(container)) {
      continue;
    }
    visited.add(container);
    let url: URL;
    try {
      url = amazonUrl(link.getAttribute('href') || '', origin);
    } catch {
      continue;
    }
    const quantityText =
      text(
        container.querySelector(
          '.item-view-qty, .od-item-view-qty, .yohtmlc-item-quantity, [data-component="itemQuantity"]',
        ),
      ) ||
      text(container).match(/(?:qty|quantity|quantite)\s*:?\s*(\d+)/i)?.[1] ||
      '1';
    result.push({
      description,
      url: url.href,
      asin: url.pathname.match(/\/(?:dp|product)\/([A-Z0-9]{10})/i)?.[1] || '',
      price: price(
        text(
          container.querySelector(
            '.a-color-price, .price, [data-component="unitPrice"], [id*="item-total-price"]',
          ),
        ),
      ),
      quantity: Number(quantityText.match(/\d+/)?.[0]) || 1,
      category: '',
    });
  }
  return result;
}
function shipmentsFrom(root: ParentNode, origin: string): Shipment[] {
  const legacy = Array.from(root.querySelectorAll('.shipment'));
  const shipments = legacy.length
    ? legacy
    : Array.from(
        root.querySelectorAll('[data-component="shipmentsLeftGrid"]'),
      ).map((e) => e.parentElement!);
  return shipments.map((node) => {
    const link = node.querySelector<HTMLAnchorElement>(
      'a[href*="ship-track"], a[href*="progress-tracker"]',
    );
    let tracking_link = '';
    try {
      if (link) {
        tracking_link = amazonUrl(link.getAttribute('href')!, origin).href;
      }
    } catch {
      /* No third-party tracking navigation. */
    }
    return {
      shipment_id: tracking_link
        ? new URL(tracking_link).searchParams.get('shipmentId') || ''
        : '',
      status: text(
        node.querySelector(
          '[data-component="shipmentStatus"], .status-message, .shipment-info-container',
        ),
      ),
      tracking_link,
      tracking_id: '',
      refund: labeled(node, ['Refund for this return']),
      items: itemsFrom(node, origin),
      transaction: null,
    };
  });
}
export function checkDocument(page: PageDocument, origin: string): void {
  amazonUrl(page.url, origin);
  const doc = documentOf(page.html);
  if (
    doc.querySelector(
      '#captchacharacters, form[action*="validateCaptcha"], iframe[src*="captcha"], #cvf-page-content',
    ) ||
    /robot check|enter the characters you see below|automated access|too many requests|service unavailable/i.test(
      page.text,
    )
  ) {
    throw new SiteBlocked(
      'Amazon showed a verification or access-limit page. Requests stopped for at least 30 minutes.',
    );
  }
  if (
    /\/ap\//.test(new URL(page.url).pathname) ||
    doc.querySelector('input[type="password"], #ap_email')
  ) {
    throw new WorkPaused(
      'Sign in on Amazon, then reopen OrderStash to continue.',
    );
  }
}
export interface Listing {
  orders: OrderRecord[];
  next?: string;
  empty: boolean;
  years: number[];
  warnings?: string[];
}
export function parseListing(page: PageDocument, profileId: string, allowPartial = false): Listing {
  const doc = documentOf(page.html);
  const origin = amazonUrl(page.url).origin;
  const cards = Array.from(doc.querySelectorAll(cardsSelector)).filter(
    (node) => !node.parentElement?.closest(cardsSelector),
  );
  const now = new Date().toISOString();
  const warnings: string[] = [];
  const orders = cards.flatMap((card) => {
    try {
    const links = Array.from(
      card.querySelectorAll<HTMLAnchorElement>('a[href]'),
    );
    const id =
      card.getAttribute('data-order-id') ||
      text(
        card.querySelector(
          '.yohtmlc-order-id, .order-header__order-id, [data-component="orderId"]',
        ),
      ).match(ORDER)?.[0] ||
      links
        .map((a) => a.getAttribute('href')?.match(ORDER)?.[0])
        .find(Boolean) ||
      text(card).match(ORDER)?.[0] ||
      '';
    const date = calendarDate(
      card.querySelector('time')?.getAttribute('datetime') ||
        labeled(card, [
          'Order placed',
          'Ordered on',
          'Subscription charged on',
          'Commande effectuée',
          'Ordine effettuato',
          'Pedido realizado',
        ]),
    );
    if (!new RegExp(`^${ORDER.source}$`).test(id) || (!date && !allowPartial)) {
      throw new Error(
        'An order card could not be read. Collection stopped so this page is not silently skipped.',
      );
    }
    const detail = links.find((a) =>
      /order-(?:details?|summary)/i.test(a.getAttribute('href') || ''),
    );
    const detailUrl = amazonUrl(
      detail?.getAttribute('href') ||
        `/your-orders/order-details?orderID=${id}`,
      origin,
    ).href;
    const invoice = links.find((a) =>
      /summary\/print|print-summary|\/invoice\b/.test(
        a.getAttribute('href') || '',
      ),
    );
    if (!date) warnings.push(`Order ${id}: the date could not be read.`);
    return [{
      key: orderKey(profileId, origin, id),
      profileId,
      origin,
      orderId: id,
      date,
      detailUrl,
      invoiceUrl: invoice
        ? amazonUrl(invoice.getAttribute('href')!, origin).href
        : '',
      total: price(labeled(card, ['Total', 'Grand total', 'Montant total'])),
      recipient:
        text(
          card.querySelector(
            '.recipient .trigger-text, [id*="shipToInsertionNode"] a',
          ),
        ) || labeled(card, ['Ship to']),
      items: itemsFrom(card, origin),
      shipments: shipmentsFrom(card, origin),
      discoveredAt: now,
      updatedAt: now,
    } satisfies OrderRecord];
    } catch (error) {
      if (!allowPartial) throw error;
      warnings.push(error instanceof Error ? error.message : String(error));
      return [];
    }
  });
  const next = doc.querySelector<HTMLAnchorElement>(
    '.a-pagination .a-last a, .a-last a, a[rel="next"], a[aria-label="Next page"], a[aria-label="Next"]',
  );
  const empty =
    Boolean(
      doc.querySelector(
        '#no-orders-message, #order-history-no-orders-message, .no-orders-message',
      ),
    ) ||
    /\b0 orders|haven.t placed any orders|no orders (?:found|placed|to display)/i.test(
      page.text,
    );
  if (!orders.length && !empty) {
    const message = 'No recognized orders or empty-state message. Collection may be incomplete; check Amazon.';
    if (!allowPartial) throw new Error(message);
    warnings.push(message);
  }
  const years = Array.from(
    doc.querySelectorAll('option, .a-dropdown-link, [role="option"]'),
  )
    .map((n) => Number(text(n).match(/\b(?:19|20)\d{2}\b/)?.[0]))
    .filter(Boolean);
  return {
    orders: [...new Map(orders.map((o) => [o.key, o])).values()],
    empty,
    years: [...new Set(years)],
    warnings,
    next: next
      ? amazonUrl(new URL(next.getAttribute('href')!, page.url).href, origin)
          .href
      : undefined,
  };
}
export function parseDetails(
  page: PageDocument,
  order: OrderRecord,
): OrderRecord {
  if (!page.text.includes(order.orderId)) {
    throw new Error(
      'The loaded page does not contain the expected order number.',
    );
  }
  const doc = documentOf(page.html);
  const items = itemsFrom(doc, order.origin);
  const shipments = shipmentsFrom(doc, order.origin);
  if (
    !items.length &&
    !shipments.length &&
    !doc.querySelector(
      '#od-subtotals, #orderDetails, [data-component="shippingAddress"], .orderSummary',
    ) &&
    !/cancelled|canceled/i.test(page.text)
  ) {
    throw new Error('Order details did not match a supported layout.');
  }
  const get = (...labels: string[]) => price(labeled(doc, labels));
  const payments = Array.from(
    doc.querySelectorAll(
      '[data-component="paymentMethod"], .pmts-payment-instrument-billing-address, .payment-method',
    ),
  )
    .map(text)
    .filter(Boolean);
  const details: OrderDetails = {
    postage: get(
      'Shipping & Handling',
      'Shipping and handling',
      'Shipping',
      'Postage',
    ),
    postage_refund: get('Shipping refund'),
    gift: get('Gift Card Amount', 'Gift Certificate Amount'),
    us_tax: get('Estimated tax to be collected', 'Tax'),
    vat: get('VAT'),
    gst: get('GST'),
    pst: get('PST'),
    subscribe_and_save: get('Subscribe & Save', 'Subscribe and Save'),
    refund: get('Refund Total', 'Refund'),
    payments,
  };
  const invoice = Array.from(doc.querySelectorAll('a[href]')).find((a) =>
    /summary\/print|print-summary|\/invoice\b/.test(
      a.getAttribute('href') || '',
    ),
  );
  return {
    ...order,
    details,
    detailsAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    total: get('Grand Total', 'Total for this order') || order.total,
    recipient:
      order.recipient ||
      text(
        doc.querySelector(
          '.displayAddressFullName, [data-component="shippingAddress"] li',
        ),
      ),
    invoiceUrl: invoice
      ? amazonUrl(invoice.getAttribute('href')!, order.origin).href
      : order.invoiceUrl,
    items: (items.length ? items : order.items).map((i) => ({
      ...i,
      category:
        order.items.find((o) => o.asin === i.asin && i.asin)?.category || '',
    })),
    shipments: shipments.map((s) => ({
      ...s,
      tracking_id:
        order.shipments.find(
          (o) => o.tracking_link === s.tracking_link && s.tracking_link,
        )?.tracking_id || '',
    })),
    issue: undefined,
  };
}
export function parsePayments(
  page: PageDocument,
  profileId: string,
  origin: string,
): Payment[] {
  const doc = documentOf(page.html);
  const dated = Array.from(doc.querySelectorAll('.transaction-date-container'));
  const result: Payment[] = [];
  for (const dateNode of dated) {
    const date = calendarDate(text(dateNode));
    for (const row of Array.from(
      dateNode.nextElementSibling?.querySelectorAll(
        '.transactions-line-item',
      ) || [],
    )) {
      const spans = Array.from(row.querySelectorAll('span'));
      const value = spans.map(text).find((s) => price(s));
      const cardInfo =
        spans.map(text).find((s) => /\*{4}|ending in/i.test(s)) || '';
      const orderIds = [
        ...new Set(text(row).match(new RegExp(ORDER.source, 'g')) || []),
      ];
      const vendor = text(row.lastElementChild);
      const paymentAmount = amount(value || '');
      if (!date || !Number.isFinite(paymentAmount)) {
        throw new Error('A payment date or amount could not be read.');
      }
      result.push({
        key: [
          profileId,
          origin,
          date,
          paymentAmount,
          cardInfo,
          orderIds.join(','),
          vendor,
        ].join('|'),
        profileId,
        origin,
        date,
        amount: paymentAmount,
        cardInfo,
        orderIds,
        vendor,
      });
    }
  }
  return result;
}
export function enrichment(
  html: string,
  type: 'category' | 'tracking',
): string {
  const doc = documentOf(html);
  return text(
    doc.querySelector(
      type === 'category'
        ? '#wayfinding-breadcrumbs_feature_div'
        : '.pt-delivery-card-trackingId, [data-test-id="tracking-id"]',
    ),
  ).replace(/^Tracking (?:ID|number):\s*/i, '');
}
