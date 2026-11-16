export interface InvoiceJob {
  orderId: string;
  date: string;
  detailUrl: string;
  invoiceUrl: string;
  status: 'pending' | 'saving' | 'done' | 'failed';
  error?: string;
  downloadId?: number;
  filename?: string;
}
const AMAZON_HOST =
  /^www\.amazon\.(com|ca|co\.uk|co\.jp|com\.au|com\.be|com\.mx|ae|de|es|fr|in|ie|it|nl|sa)$/;

export function amazonUrl(value: string, origin?: string): URL {
  const url = new URL(value, origin);

  if (
    url.protocol !== 'https:' ||
    !AMAZON_HOST.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error('Expected a supported HTTPS Amazon address.');
  }

  if (origin && url.origin !== origin) {
    throw new Error("Invoice links must stay on the order's Amazon site.");
  }

  return url;
}

export function invoicePath(url: URL): boolean {
  return /(?:\/invoice(?:[/.?_-]|$)|\/print(?:\.html)?(?:\/|$)|\/print-summary|\/summary\/print)/i.test(
    url.pathname,
  );
}

export function filename(job: InvoiceJob, host: string): string {
  // Host + order number prevent collisions across Amazon marketplaces.
  return `OrderStash/${host}/${job.date}_${job.orderId}.pdf`;
}

export interface PageSnapshot {
  url: string;
  text: string;
  heading: string;
  signIn: boolean;
  challenge: boolean;
  links: {url: string; text: string}[];
}

export type PageDecision =
  | {kind: 'invoice'}
  | {kind: 'navigate'; url: string}
  | {kind: 'blocked'; reason: string}
  | {kind: 'waiting'; reason: string};

export function inspectPage(page: PageSnapshot, job: InvoiceJob): PageDecision {
  const origin = amazonUrl(job.detailUrl).origin;
  let url: URL;

  try {
    url = amazonUrl(page.url, origin);
  } catch {
    return {kind: 'blocked', reason: 'The invoice left the Amazon site.'};
  }

  if (page.signIn || page.challenge || /\/ap\//.test(url.pathname)) {
    return {
      kind: 'blocked',
      reason:
        'Sign in or solve the Amazon challenge in the invoice tab, ' +
        'then return here and resume.',
    };
  }

  const text = page.text.replace(/\s+/g, ' ');
  const hasOrder = text.includes(job.orderId);
  const invoiceHeading = /invoice|order summary|final details|receipt/i.test(
    page.heading,
  );

  if (invoicePath(url) && hasOrder && invoiceHeading && text.length > 150) {
    return {kind: 'invoice'};
  }

  if (!hasOrder) {
    return {kind: 'waiting', reason: 'The expected order number is missing.'};
  }

  // Do not accidentally print a details page or a page listing invoice links.
  const candidates: {url: string; rank: number}[] = [];

  for (const link of page.links) {
    try {
      const target = amazonUrl(link.url, origin);
      const targetOrder =
        target.searchParams.get('orderID') ||
        target.searchParams.get('orderId');

      target.hash = '';
      const current = new URL(url.href);
      current.hash = '';

      if (
        !invoicePath(target) ||
        target.href === current.href ||
        (targetOrder && targetOrder !== job.orderId) ||
        /request|contact|credit.?note/i.test(link.text)
      ) {
        continue;
      }

      candidates.push({
        url: target.href,
        rank: /view invoice|print.*invoice|order summary/i.test(link.text)
          ? 0
          : 1,
      });
    } catch {
      // Never follow a third-party or non-HTTPS link automatically.
    }
  }

  candidates.sort((a, b) => a.rank - b.rank);

  if (candidates.length) {
    return {kind: 'navigate', url: candidates[0].url};
  }

  return {
    kind: 'waiting',
    reason: 'No printable invoice found. Open the order to check availability.',
  };
}

export class SessionRequired extends Error {}

export interface ExportAdapter {
  export(
    job: InvoiceJob,
    saving: (id: number) => Promise<void>,
  ): Promise<string>;
  recover(downloadId: number): Promise<string>;
}
