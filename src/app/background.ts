import {amazonUrl, SessionRequired} from '../invoices/core';
import {readAmazonContext, AmazonContext} from './context';
import {OrderStashEngine, CollectionOptions, recoverExports, recoverInterruptedRuns} from './engine';
import {parseListing} from './parse';
import {
  CsvView,
  BudgetCooldown,
  DEFAULT_SETTINGS,
  MARKETPLACES,
  OrderRecord,
  Payment,
  pendingOrders,
  Receipt,
  Run,
  Settings,
  WorkPaused,
  WorkProgress,
} from './model';
import {Vault} from './vault';
import {historyYearUrl} from './live';
import {externalPanel, closeDocked} from './presentation';
import {findSourceTab, isSourceUrl} from './source';
import {cleanupInvoiceDebugger} from '../invoices/chrome';

type Request = {
  kind: 'collect' | 'pdf' | 'csv' | 'payments';
  scope: string;
  view: CsvView;
  details: boolean;
  categories: boolean;
  tracking: boolean;
  tabId?: number;
  resume?: boolean;
};
type Job = {
  busy: boolean;
  paused: boolean;
  message: string;
  progress?: WorkProgress;
  request?: Request;
  origin?: string;
  summariesReady?: boolean;
  resumeAt?: number;
};
const vault = new Vault();
let job: Job = {busy: false, paused: false, message: ''};
let engine: OrderStashEngine | undefined;
const pageReads = new Map<number, {revision: string; task: Promise<void>}>();
const captureWarnings = new Map<number, string[]>();
let lastSourceTabId: number | undefined;
const ready = (async () => {
  await chrome.action.setPopup({popup: ''});
  await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true});
  await vault.initialise();
  await cleanupInvoiceDebugger();
  const interrupted = await recoverInterruptedRuns(vault);
  const saved = ((await chrome.storage.local.get('orderstash_job')).orderstash_job ||
    (await chrome.storage.session.get('job')).job) as Job | undefined;
  if (saved) {
    job = {
      ...saved,
      busy: false,
      paused: saved.busy || saved.paused,
      message: saved.busy
        ? 'Work was interrupted. Saved progress is available. Resume when ready.'
        : saved.message,
    };
  } else if (interrupted) {
    job.message = 'Previous work was interrupted. Your saved orders are kept; start collection or export again to continue.';
  }
  await saveJob();
})();
async function hideEmbedded(windowId: number): Promise<void> {
  const tabs = await chrome.tabs.query({windowId, url: MARKETPLACES.map(origin => origin + '/*')});
  await Promise.all(tabs.filter(tab => tab.id !== undefined).map(tab =>
    chrome.tabs.sendMessage(tab.id!, {target: 'content', action: 'hide-panel'}, {frameId: 0})
      .catch(() => undefined)));
}
async function activeExternal(context: AmazonContext) {
  return externalPanel(await chrome.runtime.getContexts({}), context.tabId,
    context.windowId, chrome.runtime.getURL('panel.html'));
}
async function saveJob(): Promise<void> {
  await chrome.storage.local.set({orderstash_job: job});
}
async function source(tabId?: number, ordersOnly = false): Promise<AmazonContext | undefined> {
  let tab = await findSourceTab(tabId, lastSourceTabId ?? job.request?.tabId, job.origin, ordersOnly);
  const deadline = Date.now() + 15000;
  while (ordersOnly && tab?.status === 'loading' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
    tab = await chrome.tabs.get(tab.id!).catch(() => undefined);
  }
  if (!tab?.id || !tab.url) {
    return undefined;
  }
  try {
    amazonUrl(tab.url);
    if (new URL(tab.url).hash.startsWith('#orderstash')) return undefined;
  } catch {
    return undefined;
  }
  const [result] = await chrome.scripting.executeScript({
    target: {tabId: tab.id},
    func: readAmazonContext,
  });
  return {
    ...result.result,
    tabId: tab.id,
    windowId: tab.windowId,
  } as AmazonContext;
}
function isAmazonPage(url: string): boolean {
  return isSourceUrl(url);
}
async function syncVisible(context: AmazonContext): Promise<void> {
  if (!context.ordersPage) return;
  const prior = pageReads.get(context.tabId);
  if (prior?.revision === context.revision) return prior.task;
  const task = (async () => {
    await prior?.task.catch(() => undefined);
    try {
      const listing = await parseListing(context, 'personal', true);
      await vault.saveSummaries(listing.orders.map(order => ({...order,
        year: order.date ? Number(order.date.slice(0, 4)) : context.selectedYear})));
      captureWarnings.set(context.tabId, listing.warnings || []);
    } catch (error) {
      // Partial DOMs are common during navigation. A later revision retries;
      // passive reads never start visits, cooldowns, or an export job.
      if (pageReads.get(context.tabId)?.revision === context.revision) pageReads.delete(context.tabId);
      captureWarnings.set(context.tabId, [error instanceof Error ? error.message : String(error)]);
    }
  })();
  pageReads.set(context.tabId, {revision: context.revision, task});
  await task;
}
async function toolbar(tabId: number, open: boolean): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({tabId, color: '#007f78'});
  await chrome.action.setBadgeText({tabId, text: open ? '' : 'OPEN'});
  await chrome.action.setTitle({tabId, title: 'Open OrderStash - Save invoice PDFs and export orders'});
}
chrome.tabs.onRemoved.addListener(tabId => {
  pageReads.delete(tabId);
  captureWarnings.delete(tabId);
  if (lastSourceTabId === tabId) lastSourceTabId = undefined;
  void chrome.runtime.sendMessage({target: 'panel', action: 'page-changed', tabId})
    .catch(() => undefined);
});
chrome.tabs.onUpdated.addListener((tabId, changes, tab) => {
  if (changes.status === 'complete' && tab.url && !isAmazonPage(tab.url)) {
    pageReads.delete(tabId);
    void chrome.action.setBadgeText({tabId, text: ''});
    void chrome.runtime.sendMessage({target: 'panel', action: 'page-changed', tabId})
      .catch(() => undefined);
  }
});
function inScope(
  order: OrderRecord,
  request: Request,
  context: AmazonContext,
): boolean {
  return request.scope === 'page'
    ? context.pageOrderIds.includes(order.orderId)
    : String(order.year || order.date.slice(0, 4)) === request.scope.replace('year-', '');
}
async function run(request: Request, context: AmazonContext): Promise<void> {
  if (job.busy) {
    throw new Error('An export is already running.');
  }
  const summariesReady = Boolean(request.resume && job.summariesReady);
  job = {
    busy: true,
    paused: false,
    message: 'Reading Amazon order history…',
    request,
    origin: context.origin,
    summariesReady,
  };
  let visits = 0;
  const heartbeat = setInterval(
    () => void chrome.runtime.getPlatformInfo(),
    20000,
  );
  try {
    await chrome.alarms?.clear('orderstash-resume');
    await saveJob();
    const settings: Settings = {
      ...(await vault.settings()),
      origin: context.origin,
      profileId: 'personal',
      workerWindowId: context.windowId,
    };
    const phase = async (
      action: (current: OrderStashEngine) => Promise<void>,
    ) => {
      engine?.dispose();
      engine = new OrderStashEngine(
        vault,
        {
          ...settings,
          navigationLimit: Math.max(1, settings.navigationLimit - visits),
        },
        (progress) => {
          job.progress = {
            ...progress,
            navigations: visits + progress.navigations,
          };
          job.message = progress.detail;
          void saveJob();
        },
      );
      try {
        await action(engine);
      } finally {
        visits += engine.pacer.count;
        if (job.progress) {
          job.progress.navigations = visits;
        }
        engine.dispose();
      }
    };
    await recoverExports(vault);
    const summaryKey = `summary|${context.origin}|${request.scope}`;
    const summary = await vault.get<{
      key: string;
      fingerprint: string;
      at: number;
    }>('meta', summaryKey);
    const fingerprint = context.pageOrderIds.join('|');
    const useCache =
      !request.details &&
      request.kind !== 'collect' &&
      summary &&
      summary.fingerprint === fingerprint &&
      Date.now() - summary.at < 15 * 60000;
    if (
      request.kind !== 'payments' &&
      (!request.resume || !job.summariesReady || request.kind === 'collect') &&
      !useCache
    ) {
      if (request.scope === 'page') {
        const listing = await parseListing(context, 'personal');
        await vault.saveSummaries(listing.orders);
      } else {
        const year = Number(request.scope.replace('year-', ''));
        if (!context.years.includes(year)) {
          throw new Error(
            'Choose a year available in Amazon’s history filter.',
          );
        }
        const options: CollectionOptions = {
          from: `${year}-01-01`,
          through: `${year}-12-31`,
          digital: false,
          digitalOnly:
            new URL(context.url).searchParams.get('orderFilter') ===
              'digital' ||
            new URL(context.url).searchParams.get('digitalOrders') === '1',
          details: request.details,
          categories: request.details && request.categories,
          tracking: request.details && request.tracking,
          refresh: false,
          // Two pages seen while browsing do not prove the rest of a year is cached.
          quick: false,
          resume: Boolean(request.resume),
          sourceUrl: context.url,
        };
        await phase((e) =>
          e.collect(
            options,
            context.selectedYear === year ? context : undefined,
          ),
        );
      }
      await vault.put('meta', {key: summaryKey, fingerprint, at: Date.now()});
    }
    job.summariesReady = true;
    await saveJob();
    const orders = (
      await vault.scopedOrders('personal', context.origin)
    ).filter((o) => inScope(o, request, context));
    if (request.scope === 'page' && request.details) {
      await phase((e) =>
        e.enrichOrders(orders, request.categories, request.tracking),
      );
    }
    if (request.kind === 'pdf') {
      if (visits >= settings.navigationLimit) {
        const state = await engine!.pacer.io.read();
        throw new BudgetCooldown(Math.max(state.cooldownUntil, Date.now() + 1000));
      }
      await phase((e) =>
        e.exportPdfs(orders, request.resume || settings.onlyNew),
      );
    } else if (request.kind === 'csv') {
      const payments = (await vault.all<Payment>('payments')).filter(
        (p) =>
          p.origin === context.origin &&
          (request.scope === 'page'
            ? p.orderIds.some((id) => context.pageOrderIds.includes(id))
            : p.date.startsWith(request.scope.replace('year-', ''))),
      );
      await phase((e) =>
        e.exportCsv(orders, request.view, settings.onlyNew, payments),
      );
    } else if (request.kind === 'payments') {
      const year = Number(request.scope.replace('year-', ''));
      await phase((e) =>
        e.collectTransactions(`${year}-01-01`, `${year}-12-31`),
      );
    }
    const runs = (await vault.all<Run>('runs'))
      .filter((r) => r.origin === context.origin)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const issues = runs[0]?.issues.length || 0;
    job.message = issues
      ? `Finished with ${issues} issue(s). See History.`
      : request.kind === 'collect'
        ? `${orders.length} orders ready. Choose PDFs or CSV to save a copy.`
        : 'Finished. Your completed downloads are recorded in History.';
  } catch (error) {
    job.paused =
      error instanceof WorkPaused || error instanceof SessionRequired;
    job.message = error instanceof Error ? error.message : String(error);
    if (error instanceof BudgetCooldown) job.resumeAt = error.resumeAt;
  } finally {
    clearInterval(heartbeat);
    engine?.dispose();
    engine = undefined;
    job.busy = false;
    await saveJob();
    if (job.resumeAt) {
      if (chrome.alarms) await chrome.alarms.create('orderstash-resume', {when: job.resumeAt});
      else {
        // An unpacked worker can pick up rebuilt JS before Chrome reloads its
        // manifest. Keep controls usable until the new permission is loaded.
        delete job.resumeAt;
        job.message = 'Reload OrderStash at chrome://extensions to enable automatic breaks, then Resume. Your completed exports are kept.';
        await saveJob();
      }
    }
  }
}
async function resumeScheduled(): Promise<void> {
  if (job.busy || !job.resumeAt || !job.request) return;
  if (!chrome.alarms) return;
  if (job.resumeAt > Date.now()) {
    await chrome.alarms.create('orderstash-resume', {when: job.resumeAt});
    return;
  }
  const scheduledAt = job.resumeAt;
  let context: AmazonContext | undefined;
  try { context = await source(job.request.tabId, true); }
  catch { /* A tab may close or navigate while reconnecting. */ }
  if (job.busy || job.resumeAt !== scheduledAt) return;
  if (!context?.ordersPage) {
    delete job.resumeAt;
    job.message = 'Open Amazon’s Your Orders page, then Resume. Your completed exports are kept.';
    await saveJob();
    return;
  }
  void run({...job.request, resume: true, tabId: context.tabId}, context);
}
chrome.alarms?.onAlarm.addListener(alarm => {
  if (alarm.name === 'orderstash-resume') void ready.then(resumeScheduled);
});
// Alarms may be lost across browser restarts. Recreate the saved break timer.
void ready.then(resumeScheduled);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'background') {
    return false;
  }
  void (async () => {
    await ready;
    const tabId = message.tabId ?? sender.tab?.id;
    switch (message.action) {
      case 'page-changed': {
        if (!sender.tab?.id || sender.frameId !== 0 || !sender.tab.url ||
            !isAmazonPage(sender.tab.url)) throw new Error('Expected an Amazon page.');
        const tab = await chrome.tabs.get(sender.tab.id);
        const page = message.page as Omit<AmazonContext, 'tabId' | 'windowId'>;
        if (!tab.url || page.url !== tab.url || !isAmazonPage(page.url)) {
          respond({tabId: tab.id});
          break;
        }
        const context = {...page, tabId: tab.id!, windowId: tab.windowId};
        if (tab.active) lastSourceTabId = context.tabId;
        await syncVisible(context);
        await toolbar(context.tabId, Boolean(message.open));
        void chrome.runtime.sendMessage({
          target: 'panel', action: 'page-changed', tabId: context.tabId,
        }).catch(() => undefined);
        const owner = await activeExternal(context);
        if (owner) await hideEmbedded(context.windowId);
        respond({tabId: context.tabId, showEmbedded: !owner});
        break;
      }
      case 'panel-visibility': {
        if (tabId !== undefined) {
          const tab = await chrome.tabs.get(tabId);
          if (tab.url && isAmazonPage(tab.url)) {
            await toolbar(tabId, Boolean(message.open));
            if (message.open && message.presentation !== 'embedded') {
              await hideEmbedded(tab.windowId);
              if (message.presentation === 'detached') await closeDocked(tab.windowId);
              if (message.presentation === 'docked') {
                // Choosing Chrome's dock replaces automatic on-page panels,
                // including after the dock is closed or the browser restarts.
                await chrome.storage.local.set({orderstash_sidebar_auto: false});
                for (const panel of await chrome.runtime.getContexts({})) {
                  if (!panel.documentUrl) continue;
                  const url = new URL(panel.documentUrl);
                  if (url.pathname === '/panel.html' && url.searchParams.has('detached') &&
                      Number(url.searchParams.get('sourceTab')) === tabId) {
                    await chrome.windows.remove(panel.windowId);
                  }
                }
              }
            }
          }
        }
        respond({ok: true});
        break;
      }
      case 'select-year': {
        if (job.busy) throw new Error('Pause the export before changing its year.');
        const context = await source(tabId, true);
        if (!context) throw new Error('Open Amazon\'s Your Orders page first.');
        const year = Number(message.year);
        const url = historyYearUrl(context, year);
        if (context.selectedYear !== year) {
          await chrome.tabs.update(context.tabId, {url});
        }
        respond({ok: true});
        break;
      }
      case 'context': {
        const context = await source(tabId, true);
        if (context) {
          lastSourceTabId = context.tabId;
          await syncVisible(context);
        }
        const publicContext = context
          ? (({html: _html, text: _text, ...rest}) => rest)(context)
          : undefined;
        respond({
          context: publicContext,
          job,
          settings: await vault.settings(),
          captureWarnings: context ? captureWarnings.get(context.tabId) || [] : [],
        });
        break;
      }
      case 'status': {
        const origin = amazonUrl(message.origin).origin;
        const orders = await vault.scopedOrders('personal', origin);
        const receipts = await vault.all<Receipt>('receipts');
        const orderKeys = new Set(orders.map(order => order.key));
        const runs = (await vault.all<Run>('runs'))
          .filter((r) => r.origin === origin)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .slice(0, 15);
        const runIds = new Set(runs.map((r) => r.id));
        respond({
          job,
          orders,
          remaining: pendingOrders(orders, receipts, 'pdf').map((o) => o.key),
          runs,
          receipts: receipts.filter((r) => runIds.has(r.runId)),
          // Order status must outlive the shorter Recent exports history.
          orderReceipts: receipts.filter(receipt => orderKeys.has(receipt.orderKey)),
        });
        break;
      }
      case 'start': {
        if (job.busy) {
          throw new Error('An export is already running.');
        }
        const context = await source(tabId, true);
        if (!context?.ordersPage) {
          throw new Error('Open Amazon’s Your Orders page first.');
        }
        const request: Request =
          message.resume && job.request
            ? {...job.request, resume: true, tabId: context.tabId}
            : {...message.request, tabId: context.tabId};
        if (
          !['pdf', 'csv', 'collect', 'payments'].includes(request.kind) ||
          !['orders', 'items', 'shipments', 'payments'].includes(
            request.view,
          ) ||
          !['page', ...context.years.map((y) => `year-${y}`)].includes(
            request.scope,
          )
        ) {
          throw new Error(
            'Choose an available order period and export format.',
          );
        }
        if (job.busy) {
          throw new Error('An export is already running.');
        }
        if (request.kind === 'payments' && request.scope === 'page') {
          throw new Error('Choose a year before reading payment activity.');
        }
        lastSourceTabId = context.tabId;
        void run(request, context);
        void chrome.runtime.sendMessage({target: 'panel', action: 'page-changed', tabId: context.tabId})
          .catch(() => undefined);
        respond({ok: true});
        break;
      }
      case 'pause':
        if (job.resumeAt) {
          delete job.resumeAt;
          await chrome.alarms?.clear('orderstash-resume');
          job.paused = true;
          job.message = 'Paused. Your progress and completed downloads are saved.';
          await saveJob();
        } else engine?.pause();
        respond({ok: true});
        break;
      case 'preferences': {
        if (job.busy) {
          throw new Error(
            'Pause the current export before changing preferences.',
          );
        }
        const prior = await vault.settings();
        await vault.saveSettings({
          ...prior,
          onlyNew: Boolean(message.onlyNew),
          pdfBranding: Boolean(message.pdfBranding),
          paper: message.paper === 'a4' ? 'a4' : 'letter',
          pace: Math.max(
            5000,
            Math.min(120000, Number(message.pace) || DEFAULT_SETTINGS.pace),
          ),
          navigationLimit: Math.max(
            10,
            Math.min(150, Number(message.navigationLimit) || 60),
          ),
        });
        respond({ok: true});
        break;
      }
      case 'detach': {
        const context = await source(tabId);
        if (!context) {
          throw new Error('Open Amazon first.');
        }
        const panels = await chrome.runtime.getContexts({});
        const existing = panels.find(panel => panel.documentUrl?.includes('detached=1') &&
          Number(new URL(panel.documentUrl).searchParams.get('sourceTab')) === context.tabId);
        if (existing) await chrome.windows.update(existing.windowId, {focused: true});
        else await chrome.windows.create({
          url: chrome.runtime.getURL(
            `panel.html?sourceTab=${context.tabId}&detached=1`,
          ),
          type: 'popup',
          width: 460,
          height: 780,
        });
        await hideEmbedded(context.windowId);
        await closeDocked(context.windowId);
        respond({ok: true});
        break;
      }
      case 'open-orders': {
        const context = await source(tabId);
        await chrome.tabs.create({
          url:
            (context?.origin || job.origin || 'https://www.amazon.com') +
            '/your-orders/orders',
        });
        respond({ok: true});
        break;
      }
      case 'clear': {
        if (job.busy) {
          throw new Error('Pause the current export before clearing history.');
        }
        await recoverExports(vault);
        await vault.clearProfile('personal');
        job = {busy: false, paused: false, message: 'Local records cleared.'};
        await saveJob();
        respond({ok: true});
        break;
      }
      case 'show-download':
        await chrome.downloads.show(Number(message.downloadId));
        respond({ok: true});
        break;
      default:
        throw new Error('Unknown OrderStash action.');
    }
  })().catch((error) =>
    respond({error: error instanceof Error ? error.message : String(error)}),
  );
  return true;
});
