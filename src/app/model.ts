export interface Item {
  description: string;
  price: string;
  quantity: number;
  url: string;
  asin: string;
  category: string;
}
export interface Shipment {
  shipment_id: string;
  status: string;
  tracking_link: string;
  tracking_id: string;
  refund: string;
  items: Item[];
  transaction: {info_string: string; payment_amount: string} | null;
}
export interface OrderDetails {
  postage: string;
  postage_refund: string;
  gift: string;
  us_tax: string;
  vat: string;
  gst: string;
  pst: string;
  subscribe_and_save: string;
  refund: string;
  payments: string[];
}
export const APP_NAME = 'OrderStash';
export const APP_TITLE = 'OrderStash — Order & Invoice Export for Amazon';
export const VERSION = '0.1.0';
export type CsvView = 'orders' | 'items' | 'shipments' | 'payments';
export type ExportKind = 'pdf' | CsvView;

export interface Profile {
  id: string;
  name: string;
  createdAt: string;
}
export interface Payment {
  key: string;
  date: string;
  cardInfo: string;
  orderIds: string[];
  amount: number;
  vendor: string;
  profileId: string;
  origin: string;
}
export interface OrderRecord {
  key: string;
  profileId: string;
  origin: string;
  orderId: string;
  date: string;
  year?: number;
  detailUrl: string;
  invoiceUrl: string;
  total: string;
  recipient: string;
  items: Item[];
  shipments: Shipment[];
  details?: OrderDetails;
  detailsAt?: string;
  discoveredAt: string;
  updatedAt: string;
  issue?: string;
}
export interface Receipt {
  key: string;
  orderKey: string;
  kind: ExportKind;
  exportedAt: string;
  runId: string;
  filename: string;
  downloadId?: number;
}
export interface Run {
  id: string;
  profileId: string;
  origin: string;
  kind: 'scan' | 'pdf' | CsvView | 'transactions';
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'paused' | 'complete' | 'failed';
  selected: string[];
  completed: string[];
  issues: {orderId: string; message: string}[];
  downloadId?: number;
  filename?: string;
  navigations: number;
  pendingKey?: string;
  label: string;
  pauseReason?: string;
}
export interface Settings {
  workerWindowId?: number;
  profileId: string;
  origin: string;
  onlyNew: boolean;
  pace: number;
  navigationLimit: number;
  pdfBranding: boolean;
  paper: 'letter' | 'a4';
  historyLimit: number;
}
export const DEFAULT_SETTINGS: Settings = {
  profileId: 'personal',
  origin: 'https://www.amazon.com',
  onlyNew: true,
  pace: 6000,
  navigationLimit: 60,
  pdfBranding: true,
  paper: 'letter',
  historyLimit: 100,
};
export const MARKETPLACES = [
  'com',
  'ca',
  'co.uk',
  'com.au',
  'de',
  'fr',
  'es',
  'it',
  'nl',
  'in',
  'co.jp',
  'com.mx',
  'com.be',
  'ie',
  'ae',
  'sa',
].map((suffix) => `https://www.amazon.${suffix}`);

export function orderKey(
  profileId: string,
  origin: string,
  id: string,
): string {
  return `${profileId}|${new URL(origin).hostname}|${id}`;
}
export function receiptKey(key: string, kind: ExportKind): string {
  return `${key}|${kind}`;
}
export function validateRange(from: string, through: string): void {
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(through + 'T00:00:00Z');
  if (
    isNaN(+start) ||
    isNaN(+end) ||
    start > end ||
    start.toISOString().slice(0, 10) !== from ||
    end.toISOString().slice(0, 10) !== through ||
    start.getUTCFullYear() < 1990 ||
    end.getUTCFullYear() > new Date().getFullYear()
  ) {
    throw new Error('Choose a valid date range between 1990 and this year.');
  }
}
export function pendingOrders(
  orders: OrderRecord[],
  receipts: Receipt[],
  kind: ExportKind,
): OrderRecord[] {
  const done = new Set(
    receipts.filter((r) => r.kind === kind).map((r) => r.orderKey),
  );
  return orders.filter((o) => !done.has(o.key));
}
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);

  // Treat imported product text as data when opened in spreadsheet software.
  if (
    /^[\s]*[=+@]/.test(text) ||
    (/^[\s]*-/.test(text) && !/^-\d+(?:\.\d+)?$/.test(text))
  ) {
    text = "'" + text;
  }

  return '"' + text.replace(/"/g, '""') + '"';
}
export function encodeCsv(rows: unknown[][]): string {
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
export function csvRows(orders: OrderRecord[], view: CsvView): unknown[][] {
  if (view === 'orders') {
    return [
      [
        'Order ID',
        'Date',
        'Total',
        'Recipient',
        'Items',
        'Shipping',
        'Shipping refund',
        'Tax',
        'VAT',
        'GST',
        'PST',
        'Refund',
        'Gift',
        'Subscribe and Save',
        'Payments',
        'Order URL',
        'Invoice URL',
      ],
      ...orders.map((o) => [
        o.orderId,
        o.date,
        o.total,
        o.recipient,
        o.items.map((i) => `${i.quantity} × ${i.description}`).join('; '),
        o.details?.postage,
        o.details?.postage_refund,
        o.details?.us_tax,
        o.details?.vat,
        o.details?.gst,
        o.details?.pst,
        o.details?.refund,
        o.details?.gift,
        o.details?.subscribe_and_save,
        o.details?.payments.join('; '),
        o.detailUrl,
        o.invoiceUrl,
      ]),
    ];
  }

  if (view === 'items') {
    return [
      [
        'Order ID',
        'Date',
        'Description',
        'ASIN',
        'Quantity',
        'Price',
        'Category',
        'Product URL',
      ],
      ...orders.flatMap((o) =>
        o.items.map((i) => [
          o.orderId,
          o.date,
          i.description,
          i.asin,
          i.quantity,
          i.price,
          i.category,
          i.url,
        ]),
      ),
    ];
  }

  if (view === 'shipments') {
    return [
      [
        'Order ID',
        'Date',
        'Shipment ID',
        'Status',
        'Tracking ID',
        'Tracking URL',
        'Refund',
        'Payment description',
        'Payment amount',
        'Items',
      ],
      ...orders.flatMap((o) =>
        o.shipments.map((s) => [
          o.orderId,
          o.date,
          s.shipment_id,
          s.status,
          s.tracking_id,
          s.tracking_link,
          s.refund,
          s.transaction?.info_string,
          s.transaction?.payment_amount,
          s.items.map((i) => i.description).join('; '),
        ]),
      ),
    ];
  }

  return [
    ['Order ID', 'Date', 'Payment description', 'Order total', 'Refund'],
    ...orders.flatMap((o) =>
      (o.details?.payments || []).map((payment) => [
        o.orderId,
        o.date,
        payment,
        o.total,
        o.details?.refund,
      ]),
    ),
  ];
}

export class WorkPaused extends Error {}
export class BudgetCooldown extends WorkPaused {
  constructor(readonly resumeAt: number) {
    super('OrderStash is cooling down after its page-visit limit until ' +
      new Date(resumeAt).toLocaleTimeString() + '; work will continue automatically.');
  }
}
export class SiteBlocked extends WorkPaused {
  constructor(
    message: string,
    readonly cooldownMs = 30 * 60000,
  ) {
    super(message);
  }
}
export interface WorkProgress {
  title: string;
  detail: string;
  done: number;
  total: number;
  navigations: number;
  waitingUntil?: number;
}
