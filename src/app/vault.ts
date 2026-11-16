import {
  DEFAULT_SETTINGS,
  OrderRecord,
  Payment,
  Profile,
  Receipt,
  receiptKey,
  Run,
  Settings,
} from './model';

type StoreName =
  'orders' | 'receipts' | 'runs' | 'profiles' | 'payments' | 'meta';

export class Vault {
  private database?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open('orderstash', 1);
        request.onupgradeneeded = () => {
          for (const name of ['orders', 'receipts', 'payments', 'meta']) {
            request.result.createObjectStore(name, {keyPath: 'key'});
          }

          for (const name of ['runs', 'profiles']) {
            request.result.createObjectStore(name, {keyPath: 'id'});
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    return this.database;
  }

  private async request<T>(
    name: StoreName,
    mode: IDBTransactionMode,
    execute: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(name, mode);
      const request = execute(transaction.objectStore(name));
      transaction.oncomplete = () => resolve(request.result as T);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(
          transaction.error ||
            new Error('Local storage transaction was interrupted.'),
        );
    });
  }

  all<T>(name: StoreName): Promise<T[]> {
    return this.request(name, 'readonly', (store) => store.getAll());
  }
  get<T>(name: StoreName, key: string): Promise<T | undefined> {
    return this.request(name, 'readonly', (store) => store.get(key));
  }
  put(name: StoreName, value: unknown): Promise<unknown> {
    return this.request(name, 'readwrite', (store) => store.put(value));
  }
  remove(name: StoreName, key: string): Promise<unknown> {
    return this.request(name, 'readwrite', (store) => store.delete(key));
  }
  async settings(): Promise<Settings> {
    const record = await this.get<{key: string; value: Partial<Settings>}>(
      'meta',
      'settings',
    );
    return {...DEFAULT_SETTINGS, ...record?.value};
  }
  async saveSettings(settings: Settings): Promise<void> {
    const value = {
      ...settings,
      pace: Math.max(5000, settings.pace),
      navigationLimit: Math.max(10, Math.min(150, settings.navigationLimit)),
    };
    await this.put('meta', {key: 'settings', value});
  }
  async initialise(): Promise<void> {
    if (!(await this.get('profiles', 'personal'))) {
      await this.put('profiles', {
        id: 'personal',
        name: 'Personal',
        createdAt: new Date().toISOString(),
      } satisfies Profile);
    }
  }
  async scopedOrders(
    profileId: string,
    origin: string,
  ): Promise<OrderRecord[]> {
    return (await this.all<OrderRecord>('orders'))
      .filter((o) => o.profileId === profileId && o.origin === origin)
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || a.orderId.localeCompare(b.orderId),
      );
  }
  // Merge in one transaction so passive page reads cannot undo a detail export.
  async saveSummaries(orders: OrderRecord[]): Promise<void> {
    if (!orders.length) return;
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('orders', 'readwrite');
      const store = tx.objectStore('orders');
      for (const order of orders) {
        const request = store.get(order.key);
        request.onsuccess = () => {
          const existing = request.result as OrderRecord | undefined;
          store.put(existing ? {
            ...existing,
            ...order,
            discoveredAt: existing.discoveredAt,
            date: order.date || existing.date,
            year: order.year || existing.year,
            invoiceUrl: order.invoiceUrl || existing.invoiceUrl,
            recipient: order.recipient || existing.recipient,
            total: order.total || existing.total,
            items: existing.detailsAt ? existing.items : order.items.length ? order.items.map(item => ({
              ...existing.items.find(old => old.url === item.url),
              ...item,
              category: item.category || existing.items.find(old => old.url === item.url)?.category || '',
            })) : existing.items,
            shipments: existing.detailsAt ? existing.shipments :
              order.shipments.length ? order.shipments : existing.shipments,
          } : order);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async completeExport(
    run: Run,
    keys: string[],
    kind: Receipt['kind'],
    filename: string,
    downloadId: number,
  ): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(['receipts', 'runs'], 'readwrite');

      for (const key of keys) {
        tx.objectStore('receipts').put({
          key: receiptKey(key, kind),
          orderKey: key,
          kind,
          exportedAt: new Date().toISOString(),
          runId: run.id,
          filename,
          downloadId,
        } satisfies Receipt);
      }

      run.completed = [...new Set([...run.completed, ...keys])];
      tx.objectStore('runs').put(run);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async pruneHistory(limit = 100): Promise<void> {
    const runs = (await this.all<Run>('runs'))
      .filter(
        (r) =>
          r.status === 'complete' ||
          r.status === 'failed' ||
          (r.status === 'paused' && r.downloadId === undefined),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    for (const run of runs.slice(limit)) {
      await this.remove('runs', run.id);
    }
  }
  async clearProfile(profileId: string): Promise<void> {
    for (const store of ['orders', 'runs', 'payments'] as const) {
      const rows = await this.all<OrderRecord & Run & Payment>(store);

      for (const row of rows.filter((r) => r.profileId === profileId)) {
        await this.remove(store, store === 'runs' ? row.id : row.key);
      }
    }

    for (const row of await this.all<Receipt>('receipts')) {
      if (row.orderKey.startsWith(profileId + '|')) {
        await this.remove('receipts', row.key);
      }
    }
    for (const row of await this.all<{key: string}>('meta')) {
      if (
        row.key.startsWith('summary|') ||
        row.key.startsWith(`cursor|${profileId}|`) ||
        row.key.startsWith(`transactions|${profileId}|`) ||
        row.key.startsWith(`collection|${profileId}|`)
      ) {
        await this.remove('meta', row.key);
      }
    }
  }
}
