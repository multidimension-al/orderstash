import {ChromeInvoiceExporter, waitForDownload} from '../invoices/chrome';
import {InvoiceJob, SessionRequired, amazonUrl} from '../invoices/core';
import {BrowserReader, SiteMonitor, sleep} from './browser';
import {
  parseDetails,
  parseListing,
  parsePayments,
  enrichment,
  blobUrl,
  releaseBlob,
} from './parse';
import {PaceState, RequestPacer} from './pace';
import {
  CsvView,
  encodeCsv,
  csvRows,
  OrderRecord,
  Payment,
  pendingOrders,
  Receipt,
  Run,
  Settings,
  SiteBlocked,
  validateRange,
  WorkPaused,
  WorkProgress,
} from './model';
import {Vault} from './vault';
import {yearPageUrl} from './live';

export interface CollectionOptions {
  digitalOnly?: boolean;
  from: string;
  through: string;
  digital: boolean;
  details: boolean;
  refresh: boolean;
  categories: boolean;
  tracking: boolean;
  quick: boolean;
  resume: boolean;
  sourceUrl?: string;
}
interface Cursor {
  signature: string;
  routeIndex: number;
  url?: string;
  detailsCompleted?: string[];
}

export async function addPrintHeader(
  tabId: number,
  job: InvoiceJob,
): Promise<void> {
  await chrome.scripting.executeScript({
    target: {tabId},
    args: [job.orderId, new Date().toISOString()],
    func: (orderId: string, exportedAt: string) => {
      document.getElementById('orderstash-export-header')?.remove();
      const header = document.createElement('header');
      header.id = 'orderstash-export-header';
      header.style.cssText =
        'padding:0 0 14px;margin:0 0 20px;' +
        'border-bottom:2px solid #007f78;color:#183042;' +
        'font-family:Arial,sans-serif;background:white;break-inside:avoid;';
      const title = document.createElement('h1');
      title.textContent = 'Exported with OrderStash';
      title.style.cssText =
        'font-size:18px;line-height:1.3;' +
        'font-weight:700;margin:0 0 6px;color:#183042;';
      const metadata = document.createElement('p');
      metadata.textContent =
        `Order ${orderId} | ${location.hostname} | ` +
        `Exported ${exportedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`;
      metadata.style.cssText = 'font-size:10px;line-height:1.5;margin:0;';
      header.append(title, metadata);
      document.body.prepend(header);
    },
  });
}

export class OrderStashEngine {
  readonly pacer: RequestPacer;
  private readonly monitor: SiteMonitor;
  private readonly reader: BrowserReader;
  private run?: Run;
  private currentProgress: WorkProgress = {
    title: 'Ready',
    detail: '',
    done: 0,
    total: 0,
    navigations: 0,
  };

  constructor(
    readonly vault: Vault,
    readonly settings: Settings,
    readonly progress: (event: WorkProgress) => void,
  ) {
    const key = 'orderstash_pace_' + new URL(settings.origin).hostname;
    this.pacer = new RequestPacer(
      settings,
      {
        now: () => Date.now(),
        sleep,
        read: async () =>
          (await chrome.storage.local.get(key))[key] || {
            nextAt: 0,
            cooldownUntil: 0,
          },
        write: async (state: PaceState) => {
          await chrome.storage.local.set({[key]: state});
        },
      },
      (waitingUntil) => {
        this.emit({...this.currentProgress, waitingUntil});
      },
    );
    this.monitor = new SiteMonitor(this.pacer);
    this.reader = new BrowserReader(
      settings.origin,
      this.pacer,
      this.monitor,
      settings.workerWindowId,
    );
  }

  pause(): void {
    this.pacer.paused = true;
    this.emit({
      ...this.currentProgress,
      title: 'Pausing',
      detail: 'Finishing the current page or download. Progress is saved.',
    });
  }
  dispose(): void {
    this.monitor.close();
  }
  private emit(event: WorkProgress): void {
    this.currentProgress = {...event, navigations: this.pacer.count};
    this.progress(this.currentProgress);
  }
  private async begin(kind: Run['kind'], label: string, keys: string[] = []) {
    this.run = {
      id: crypto.randomUUID(),
      profileId: this.settings.profileId,
      origin: this.settings.origin,
      kind,
      label,
      startedAt: new Date().toISOString(),
      status: 'running',
      selected: keys,
      completed: [],
      issues: [],
      navigations: 0,
    };
    await this.saveRun();
    return this.run;
  }
  private async saveRun(): Promise<void> {
    if (this.run) {
      this.run.navigations = this.pacer.count;
      await this.vault.put('runs', this.run);
    }
  }
  private async finish(error?: unknown): Promise<void> {
    if (this.run) {
      this.run.status = !error
        ? 'complete'
        : error instanceof WorkPaused || error instanceof SessionRequired
          ? 'paused'
          : 'failed';
      this.run.finishedAt = new Date().toISOString();

      if (error instanceof WorkPaused || error instanceof SessionRequired) {
        this.run.pauseReason = error.message;
      } else if (error) {
        this.run.issues.push({
          orderId: '',
          message: error instanceof Error ? error.message : String(error),
        });
      }

      await this.saveRun();
      await this.vault.pruneHistory(this.settings.historyLimit);
    }

    await this.reader.close(Boolean(error));
    this.monitor.close();
  }

  async collect(
    options: CollectionOptions,
    seed?: import('./browser').PageDocument,
  ): Promise<void> {
    validateRange(options.from, options.through);
    const start = new Date(options.from + 'T00:00:00Z');
    const end = new Date(options.through + 'T23:59:59Z');

    const run = await this.begin('scan', 'Collect order history');
    try {
      const routes: string[] = [];

      for (
        let year = end.getUTCFullYear();
        year >= start.getUTCFullYear();
        year--
      ) {
        for (const digital of options.digitalOnly
          ? [true]
          : options.digital
            ? [false, true]
            : [false]) {
          const base = yearPageUrl(options.sourceUrl ||
            new URL('/your-orders/orders', this.settings.origin).href,
            this.settings.origin, year);
          const legacy = /order-history/.test(base.pathname);
          base.searchParams.set('language', 'en_US');

          if (legacy) {
            base.searchParams.delete('timeFilter');
            base.searchParams.set('digitalOrders', digital ? '1' : '0');
          } else if (digital) {
            base.searchParams.set('orderFilter', 'digital');
          } else {
            base.searchParams.delete('orderFilter');
          }

          routes.push(base.href);
        }
      }

      const cursorKey = `cursor|${this.settings.profileId}|${this.settings.origin}`;
      // The source tab may have paginated since the interruption. Match the
      // requested collection and normalized routes, not its current page URL.
      const {sourceUrl: _sourceUrl, resume: _resume, ...selection} = options;
      const signature = JSON.stringify({selection, routes: routes.map(value => {
        const url = new URL(value);
        url.searchParams.sort();
        return url.href;
      })});
      const saved = await this.vault.get<{key: string; value: Cursor}>(
        'meta',
        cursorKey,
      );
      let cursor: Cursor =
        options.resume && saved?.value.signature === signature
          ? saved.value
          : {signature, routeIndex: 0};
      const known = new Map(
        (
          await this.vault.scopedOrders(
            this.settings.profileId,
            this.settings.origin,
          )
        ).map((o) => [o.key, o]),
      );
      let discovered = 0;
      const visited = new Set<string>();
      let useSeed = Boolean(
        seed &&
        !options.resume &&
        cursor.routeIndex === 0 &&
        !cursor.url &&
        Number(new URL(seed.url).searchParams.get('startIndex') || 0) === 0,
      );

      for (; cursor.routeIndex < routes.length; cursor.routeIndex++) {
        let url: string | undefined = cursor.url || routes[cursor.routeIndex];
        let knownPages = 0;

        while (url) {
          this.pacer.check();

          if (visited.has(url)) {
            throw new Error(
              'Amazon repeated a pagination link. ' +
                'Collection stopped to avoid a request loop.',
            );
          }

          visited.add(url);
          this.emit({
            title: 'Collecting orders',
            done: discovered,
            total: 0,
            detail: 'Reading order history, one page at a time.',
            navigations: 0,
          });
          const listing = await parseListing(
            useSeed && seed ? seed : await this.reader.visit(url),
            this.settings.profileId,
          );
          useSeed = false;
          let allKnown = listing.orders.length > 0;

          for (const order of listing.orders) {
            const existing = known.get(order.key);
            allKnown = allKnown && Boolean(existing);

            if (order.date < options.from || order.date > options.through) {
              continue;
            }

            const value = existing
              ? {
                  ...order,
                  ...existing,
                  date: order.date || existing.date,
                  year: order.date ? Number(order.date.slice(0, 4)) : existing.year,
                  total: order.total || existing.total,
                  updatedAt: new Date().toISOString(),
                }
              : order;
            await this.vault.put('orders', value);
            run.selected = [...new Set([...run.selected, order.key])];
            known.set(order.key, value);
            discovered++;
          }

          knownPages = allKnown ? knownPages + 1 : 0;
          const pastRange =
            listing.orders.length > 0 &&
            listing.orders.every((o) => o.date < options.from);
          url =
            pastRange || (options.quick && knownPages >= 2)
              ? undefined
              : listing.next;
          cursor = {...cursor, url};
          await this.vault.put('meta', {
            key: cursorKey,
            value: url
              ? cursor
              : {...cursor, routeIndex: cursor.routeIndex + 1},
          });
          await this.saveRun();
          this.emit({
            title: 'Collecting orders',
            done: discovered,
            total: 0,
            detail: `${discovered} order summaries saved. ` +
              (url ? 'Continuing to the next history page.' : 'History pages collected.'),
            navigations: 0,
          });
        }

        cursor.url = undefined;
      }

      if (options.details) {
        const orders = (
          await this.vault.scopedOrders(
            this.settings.profileId,
            this.settings.origin,
          )
        ).filter(
          (o) =>
            o.date >= options.from &&
            o.date <= options.through &&
            (options.refresh ||
              !o.detailsAt ||
              options.categories ||
              options.tracking) &&
            !cursor.detailsCompleted?.includes(o.key),
        );

        for (let i = 0; i < orders.length; i++) {
          this.pacer.check();
          const order = orders[i];
          this.emit({
            title: 'Collecting order details',
            done: i,
            total: orders.length,
            navigations: 0,
            detail: `${order.orderId}. Cached orders are reused.`,
          });

          try {
            let record = await parseDetails(
              await this.reader.visit(order.detailUrl),
              order,
            );
            await this.vault.put('orders', record);

            if (options.categories) {
              record = await this.categories(record);
            }

            if (options.tracking) {
              record = await this.tracking(record);
            }

            await this.vault.put('orders', record);
            run.completed.push(order.key);
            cursor.detailsCompleted = [
              ...(cursor.detailsCompleted || []),
              order.key,
            ];
            await this.vault.put('meta', {key: cursorKey, value: cursor});
          } catch (error) {
            if (error instanceof WorkPaused) {
              throw error;
            }

            const message =
              error instanceof Error ? error.message : String(error);
            await this.vault.put('orders', {...order, issue: message});
            run.issues.push({orderId: order.orderId, message});
          }

          await this.saveRun();
        }
      }

      await this.vault.remove('meta', cursorKey);
      await this.finish();
    } catch (error) {
      await this.finish(error);
      throw error;
    }
  }

  async enrichOrders(
    orders: OrderRecord[],
    categories = false,
    tracking = false,
  ): Promise<void> {
    const run = await this.begin(
      'scan',
      'Read extra order details',
      orders.map((o) => o.key),
    );
    try {
      for (const order of orders) {
        this.pacer.check();
        if (order.detailsAt && !categories && !tracking) {
          continue;
        }
        this.emit({
          title: 'Reading requested details',
          detail: order.orderId,
          done: run.completed.length,
          total: orders.length,
          navigations: 0,
        });
        let record = await parseDetails(
          await this.reader.visit(order.detailUrl),
          order,
        );
        if (categories) {
          record = await this.categories(record);
        }
        if (tracking) {
          record = await this.tracking(record);
        }
        await this.vault.put('orders', record);
        run.completed.push(order.key);
        await this.saveRun();
      }
      await this.finish();
    } catch (error) {
      await this.finish(error);
      throw error;
    }
  }
  private async categories(order: OrderRecord): Promise<OrderRecord> {
    for (const item of order.items) {
      if (!item.url || item.category) {
        continue;
      }

      const url = amazonUrl(item.url, order.origin);
      const key = `category|${url.origin}|${item.asin || url.pathname}`;
      const cached = await this.vault.get<{key: string; value: string}>(
        'meta',
        key,
      );

      if (cached) {
        item.category = cached.value;
        continue;
      }

      const page = await this.reader.visit(url.href);
      item.category = await enrichment(page.html, 'category');
      await this.vault.put('meta', {key, value: item.category});
      await this.vault.put('orders', order);
    }

    return order;
  }

  private async tracking(order: OrderRecord): Promise<OrderRecord> {
    for (const shipment of order.shipments) {
      if (!shipment.tracking_link || shipment.tracking_id) {
        continue;
      }

      const page = await this.reader.visit(shipment.tracking_link);
      shipment.tracking_id = await enrichment(page.html, 'tracking');
      await this.vault.put('orders', order);
    }

    return order;
  }

  async collectTransactions(from: string, through: string): Promise<void> {
    validateRange(from, through);
    const run = await this.begin(
      'transactions',
      'Collect payment transactions',
    );
    const seen = new Set<string>();
    let unchanged = 0;
    const cursorKey = `transactions|${this.settings.profileId}|${this.settings.origin}`;

    try {
      const saved = await this.vault.get<{
        key: string;
        from: string;
        through: string;
        tabId: number;
      }>('meta', cursorKey);
      if (saved?.from === from && saved.through === through) {
        const tab = await chrome.tabs.get(saved.tabId).catch(() => undefined);
        if (
          tab?.url &&
          tab.url.startsWith(
            this.settings.origin + '/cpe/yourpayments/transactions',
          )
        ) {
          this.reader.tabId = tab.id;
          this.monitor.watch(tab.id!);
        }
      }
      let page =
        this.reader.tabId === undefined
          ? await this.reader.visit(
              new URL('/cpe/yourpayments/transactions', this.settings.origin)
                .href,
            )
          : await this.reader.capture();
      await this.vault.put('meta', {
        key: cursorKey,
        from,
        through,
        tabId: this.reader.tabId,
      });

      while (unchanged < 2) {
        this.pacer.check();
        const payments = await parsePayments(
          page,
          this.settings.profileId,
          this.settings.origin,
        );

        if (!payments.length) {
          throw new Error(
            'No payment transactions were recognized. ' +
              'Amazon may use a different layout for this account.',
          );
        }

        const previousSize = seen.size;

        for (const payment of payments) {
          seen.add(payment.key);

          if (payment.date >= from && payment.date <= through) {
            await this.vault.put('payments', payment);
            run.completed = [...new Set([...run.completed, payment.key])];
          }
        }

        this.emit({
          title: 'Collecting payment transactions',
          detail: 'Loading one page of payments at a time.',
          done: run.completed.length,
          total: 0,
          navigations: 0,
        });
        await this.saveRun();

        if (payments.every((p) => p.date < from)) {
          break;
        }

        unchanged = previousSize === seen.size ? unchanged + 1 : 0;

        if (unchanged >= 2) {
          break;
        }

        if (!(await this.reader.nextTransactions())) {
          break;
        }
        page = await this.reader.capture();
      }

      await this.vault.remove('meta', cursorKey);
      await this.finish();
    } catch (error) {
      await this.finish(error);
      throw error;
    }
  }

  async exportCsv(
    orders: OrderRecord[],
    view: CsvView,
    onlyNew: boolean,
    payments: Payment[] = [],
  ): Promise<void> {
    const receipts = await this.vault.all<Receipt>('receipts');
    const candidates = onlyNew ? pendingOrders(orders, receipts, view) : orders;
    let keys = candidates.map((o) => o.key);
    let rows = csvRows(candidates, view);

    if (view === 'payments' && payments.length) {
      const done = new Set(
        receipts.filter((r) => r.kind === 'payments').map((r) => r.orderKey),
      );
      const selected = payments.filter((p) => !onlyNew || !done.has(p.key));
      keys = selected.map((p) => p.key);
      rows = [
        ['Date', 'Amount', 'Card', 'Vendor', 'Order IDs'],
        ...selected.map((p) => [
          p.date,
          p.amount,
          p.cardInfo,
          p.vendor,
          p.orderIds.join('; '),
        ]),
      ];
    } else {
      // Do not mark orders with no exportable rows as successfully exported.
      const exportable = candidates.filter(
        (o) =>
          view === 'orders' ||
          (view === 'items' && o.items.length) ||
          (view === 'shipments' && o.shipments.length) ||
          (view === 'payments' && o.details?.payments.length),
      );
      keys = exportable.map((o) => o.key);
      rows = csvRows(exportable, view);
    }

    if (!keys.length || rows.length <= 1) {
      this.monitor.close();
      throw new Error(
        'No new records for this export. Turn off “Export only records not saved before” to save another copy.',
      );
    }

    const run = await this.begin(view, `Export ${view} CSV`, keys);
    const url = await blobUrl(encodeCsv(rows), 'text/csv;charset=utf-8');

    try {
      const id = await chrome.downloads.download({
        url,
        saveAs: false,
        conflictAction: 'uniquify',
        filename: `OrderStash/${view}-${new Date().toISOString().slice(0, 10)}.csv`,
      });
      run.downloadId = id;
      await this.saveRun();
      run.filename = await waitForDownload(id);
      await this.vault.completeExport(run, keys, view, run.filename, id);
      await this.finish();
    } catch (error) {
      await this.finish(error);
      throw error;
    } finally {
      await releaseBlob(url);
    }
  }

  async exportPdfs(orders: OrderRecord[], onlyNew: boolean): Promise<void> {
    const receipts = await this.vault.all<Receipt>('receipts');
    const candidates = onlyNew
      ? pendingOrders(orders, receipts, 'pdf')
      : orders;

    if (!candidates.length) {
      this.monitor.close();
      throw new Error(
        'No new invoice PDFs to save. Turn off “Export only records not saved before” to save another copy.',
      );
    }

    const run = await this.begin(
      'pdf',
      'Save invoice PDFs',
      candidates.map((o) => o.key),
    );
    const profile = this.settings.profileId.replace(/[^a-z0-9_-]/gi, '_');
    const adapter = new ChromeInvoiceExporter({
      beforeVisit: async () => {
        await this.monitor.check();
        await this.pacer.beforeVisit();
        await this.monitor.check();
      },
      afterVisit: () => this.monitor.check(),
      onTab: (id) => this.monitor.watch(id),
      beforePrint: this.settings.pdfBranding ? addPrintHeader : undefined,
      folder: `OrderStash/${profile}`,
      windowId: this.settings.workerWindowId,
      paper: this.settings.paper,
    });

    try {
      for (let i = 0; i < candidates.length; i++) {
        this.pacer.check();
        const order = candidates[i];
        this.emit({
          title: 'Saving invoice PDFs',
          detail: order.orderId,
          done: i,
          total: candidates.length,
          navigations: 0,
        });

        try {
          const file = await adapter.export(
            {
              orderId: order.orderId,
              date: order.date,
              detailUrl: order.detailUrl,
              invoiceUrl: order.invoiceUrl,
              status: 'pending',
            },
            async (id) => {
              run.downloadId = id;
              run.pendingKey = order.key;
              await this.saveRun();
            },
          );
          await this.vault.completeExport(
            run,
            [order.key],
            'pdf',
            file,
            run.downloadId!,
          );
          run.filename = file;
          delete run.downloadId;
          delete run.pendingKey;
        } catch (error) {
          if (error instanceof WorkPaused || error instanceof SessionRequired) {
            throw error;
          }

          if (run.downloadId !== undefined) {
            const [download] = await chrome.downloads.search({
              id: run.downloadId,
            });
            if (download?.state !== 'interrupted') {
              throw new WorkPaused(
                'The download needs to be reconciled. ' +
                  'Reopen OrderStash before exporting again.',
              );
            }
          }

          run.issues.push({
            orderId: order.orderId,
            message: error instanceof Error ? error.message : String(error),
          });
          delete run.downloadId;
          delete run.pendingKey;
        }

        await this.saveRun();
      }

      await this.finish();
      await adapter.close();
    } catch (error) {
      if (
        error instanceof SessionRequired &&
        /challenge/i.test(error.message)
      ) {
        await this.pacer
          .block(new SiteBlocked(error.message))
          .catch(() => undefined);
      }

      await adapter.close(true);
      await this.finish(error);
      throw error;
    }
  }
}

// Called once when a fresh background worker starts. There can be no live
// engine in that worker yet. Keep cursors and pending downloads for resume.
export async function recoverInterruptedRuns(vault: Vault): Promise<number> {
  let count = 0;
  for (const run of await vault.all<Run>('runs')) {
    if (run.status !== 'running') continue;
    run.status = 'paused';
    run.pauseReason = 'The background worker stopped. Saved progress is available to resume.';
    run.finishedAt = new Date().toISOString();
    await vault.put('runs', run);
    count++;
  }
  return count;
}

export async function recoverExports(vault: Vault): Promise<void> {
  for (const run of await vault.all<Run>('runs')) {
    if (run.downloadId === undefined || run.status === 'complete') {
      continue;
    }

    const [download] = await chrome.downloads.search({id: run.downloadId});

    if (download?.state === 'complete' && download.exists) {
      const keys =
        run.kind === 'pdf'
          ? run.pendingKey
            ? [run.pendingKey]
            : []
          : run.selected;

      if (
        ['pdf', 'orders', 'items', 'shipments', 'payments'].includes(run.kind)
      ) {
        await vault.completeExport(
          run,
          keys,
          run.kind as 'pdf' | CsvView,
          download.filename,
          run.downloadId,
        );
      }

      delete run.downloadId;
      delete run.pendingKey;
      run.status =
        run.completed.length === run.selected.length ? 'complete' : 'paused';
    } else if (download?.state === 'in_progress') {
      throw new WorkPaused(
        'A previous download is still in progress. ' +
          'Finish or cancel it in Chrome Downloads before starting another export.',
      );
    } else {
      run.status = 'paused';
      delete run.downloadId;
      delete run.pendingKey;
    }

    await vault.put('runs', run);
  }
}
