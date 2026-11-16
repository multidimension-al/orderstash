import {
  VERSION,
  Settings,
  OrderRecord,
  Run,
  WorkProgress,
  CsvView,
  Receipt,
} from './model';
import type {AmazonContext} from './context';
type Context = Omit<AmazonContext, 'html' | 'text'>;
type Job = {
  busy: boolean;
  paused: boolean;
  message: string;
  progress?: WorkProgress;
  request?: {scope: string};
  resumeAt?: number;
};
let context: Context | undefined;
let settings: Settings;
let job: Job = {busy: false, paused: false, message: ''};
let refreshing = false;
let contextTask: Promise<void> | undefined;
let contextQueued = false;
let selectedYearPending: number | undefined;
const params = new URLSearchParams(location.search);
const presentation = params.has('embedded') ? 'embedded' : params.has('detached') ? 'detached' :
  params.has('docked') ? 'docked' : 'popup';
document.documentElement.dataset.presentation = presentation;
let historyRevision = '';
let libraryOrders: OrderRecord[] = [];
let libraryReceipts: Receipt[] = [];
let libraryPage = 0;
let libraryRevision = '';
const sourceTab = params.has('sourceTab')
  ? Number(params.get('sourceTab'))
  : undefined;
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
const select = (id: string) => el<HTMLSelectElement>(id);
function putText(id: string, value: string) {
  if (el(id).textContent !== value) el(id).textContent = value;
}
async function send(action: string, extra: Record<string, unknown> = {}) {
  const result = await chrome.runtime.sendMessage({
    target: 'background',
    action,
    tabId: context?.tabId ?? sourceTab,
    ...extra,
  });
  if (result?.error) {
    throw new Error(result.error);
  }
  return result;
}
function notice(message: string, error = false) {
  el('notice').hidden = !message;
  el('notice').textContent = message;
  el('notice').classList.toggle('error', error);
}
function bind(id: string, action: () => void | Promise<void>) {
  el(id).addEventListener(
    'click',
    () =>
      void Promise.resolve()
        .then(action)
        .catch((e) => notice(e instanceof Error ? e.message : String(e), true)),
  );
}
function show(name: string) {
  for (const page of ['export', 'orders', 'history', 'settings', 'help']) {
    el('page-' + page).hidden = page !== name;
  }
  document.querySelectorAll<HTMLElement>('[data-page]').forEach((b) => {
    if (b.dataset.page === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (name === 'orders') {
    renderOrders(true);
    void refreshStatus().catch(error => notice(String(error), true));
  }
}
function renderOrders(userAction = false) {
  const root = el('orders-list');
  const query = input('order-search').value.trim().toLowerCase();
  const status = select('order-status').value;
  const receipts = new Map(libraryReceipts.map(receipt => [`${receipt.orderKey}|${receipt.kind}`, receipt]));
  const orders = (select('order-period').value === 'all' ? libraryOrders : scopeOrders(libraryOrders))
    .filter(order => (!query || [order.orderId, order.date, order.year || '', order.total,
      ...order.items.map(item => item.description)].join(' ').toLowerCase().includes(query)) &&
      (status === 'all' || (status === 'pdf-saved' ? receipts.has(`${order.key}|pdf`) :
        !receipts.has(`${order.key}|${status === 'csv-pending' ? 'orders' : 'pdf'}`))))
    .sort((a, b) => b.date.localeCompare(a.date) || a.orderId.localeCompare(b.orderId));
  const pages = Math.max(1, Math.ceil(orders.length / 50));
  libraryPage = Math.min(libraryPage, pages - 1);
  const visible = orders.slice(libraryPage * 50, (libraryPage + 1) * 50);
  const revision = JSON.stringify([context?.origin, query, status, libraryPage,
    select('order-period').value, visible, visible.map(order =>
      libraryReceipts.filter(receipt => receipt.orderKey === order.key))]);
  putText('orders-site', context ? `Saved on ${new URL(context.origin).hostname.replace('www.', '')}. Browsing this list makes no Amazon requests.` : 'Open Amazon to view this site’s saved orders.');
  putText('order-count', `${orders.length} matching order${orders.length === 1 ? '' : 's'}`);
  const periodLabel = select('scope').selectedOptions[0]?.textContent || 'Current export selection';
  if (select('order-period').options[0].text !== periodLabel) select('order-period').options[0].text = periodLabel;
  el('order-paging').hidden = pages <= 1;
  putText('orders-page', `Page ${libraryPage + 1} of ${pages}`);
  el<HTMLButtonElement>('orders-previous').disabled = libraryPage === 0;
  el<HTMLButtonElement>('orders-next').disabled = libraryPage >= pages - 1;
  if (revision === libraryRevision) return;
  const selection = window.getSelection();
  if (!userAction && selection && !selection.isCollapsed && selection.anchorNode && root.contains(selection.anchorNode)) return;
  libraryRevision = revision;
  root.replaceChildren();
  if (!visible.length) {
    root.textContent = libraryOrders.length
      ? 'No orders match these filters. Try another search or show all saved years.'
      : 'No orders saved yet. Open Your Orders on Amazon or load summaries from Export.';
  }
  for (const order of visible) {
    const row = document.createElement('article');
    row.className = 'order-entry';
    row.dataset.orderId = order.orderId;
    const heading = document.createElement('div');
    heading.className = 'order-heading';
    const date = document.createElement('span');
    date.textContent = order.date || (order.year ? `${order.year} · Date unavailable` : 'Date unavailable');
    const total = document.createElement('strong');
    total.textContent = order.total || 'Total unavailable';
    heading.append(date, total);
    const link = document.createElement('a');
    link.className = 'order-number';
    link.textContent = order.orderId;
    link.href = order.detailUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = 'Open order on Amazon';
    row.append(heading, link);
    if (order.items.length) {
      const description = document.createElement('p');
      description.className = 'order-description';
      description.textContent = order.items[0].description + (order.items.length > 1 ? ` + ${order.items.length - 1} more` : '');
      row.append(description);
    }
    const exports = document.createElement('div');
    exports.className = 'order-exports';
    for (const [kind, label] of [['pdf', 'PDF'], ['orders', 'Orders CSV'], ['items', 'Items CSV'], ['shipments', 'Shipments CSV'], ['payments', 'Payments CSV']]) {
      const receipt = receipts.get(`${order.key}|${kind}`);
      if (!receipt && kind !== 'pdf' && kind !== 'orders') continue;
      const state = document.createElement(receipt?.downloadId !== undefined ? 'button' : 'span');
      state.className = `export-state${receipt ? ' saved' : ''}`;
      state.dataset.format = kind;
      state.textContent = `${label} ${receipt ? 'exported' : 'not exported'}`;
      if (receipt) {
        state.title = `Exported ${new Date(receipt.exportedAt).toLocaleString()}${receipt.downloadId !== undefined ? ' · Show download' : ''}`;
        if (receipt.downloadId !== undefined) state.onclick = () => void send('show-download', {downloadId: receipt.downloadId})
          .catch(error => notice(String(error), true));
      }
      exports.append(state);
    }
    row.append(exports);
    root.append(row);
  }
}
function scopeOrders(orders: OrderRecord[]) {
  const scope = select('scope').value;
  return orders.filter((o) =>
    scope === 'page'
      ? context?.pageOrderIds.includes(o.orderId)
      : String(o.year || o.date.slice(0, 4)) === scope.replace('year-', ''),
  );
}
function scopeInfo() {
  el('scope-info').textContent =
    select('scope').value === 'page'
      ? `Uses the ${context?.visibleCount || 0} order(s) already on this page.`
      : 'Reads history pages for this year. Extra detail and product visits are off by default.';
}
function refreshContext(): Promise<void> {
  contextQueued = true;
  if (!contextTask) contextTask = (async () => {
    while (contextQueued) {
      contextQueued = false;
      await updateContext();
    }
  })().finally(() => { contextTask = undefined; });
  return contextTask;
}
async function updateContext() {
  const response = await send('context');
  const previousContext = context;
  const initial = !settings;
  context = response.context;
  settings = response.settings;
  job = response.job;
  putText('capture-status', response.captureWarnings?.length
    ? `${response.captureWarnings.length} field(s) could not be read. Recognized orders are still saved locally.` : '');
  const ready = Boolean(context?.ordersPage);
  el('disconnected').hidden = ready;
  el('connected').hidden = !ready;
  if (context) {
    if (presentation === 'detached' && Number(new URLSearchParams(location.search).get('sourceTab')) !== context.tabId) {
      const url = new URL(location.href);
      url.searchParams.set('sourceTab', String(context.tabId));
      window.history.replaceState(null, '', url.href);
      await send('panel-visibility', {open: true, presentation});
    }
    if (selectedYearPending === context.selectedYear) selectedYearPending = undefined;
    putText('site', new URL(context.origin).hostname.replace(
      'www.',
      '',
    ));
    putText('page-context', [
      context.account,
      context.orderCount !== undefined
        ? `${context.orderCount} orders shown by Amazon`
        : `${context.visibleCount} orders visible`,
    ]
      .filter(Boolean)
      .join(' · '));
    const prior = select('scope').value;
    const options = [
      [
        'page',
        `This page (${context.visibleCount} order${context.visibleCount === 1 ? '' : 's'})`,
      ],
      ...context.years.map((y) => [`year-${y}`, String(y)]),
    ];
    if (JSON.stringify(Array.from(select('scope').options).map(option => [option.value, option.textContent])) !== JSON.stringify(options)) {
      select('scope').replaceChildren();
      for (const [value, label] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select('scope').append(option);
      }
    }
    const defaultScope =
      (context.selectedYear ? `year-${context.selectedYear}` : 'page');
    const periodChanged = previousContext?.tabId !== context.tabId ||
      previousContext?.selectedYear !== context.selectedYear;
    select('scope').value = !periodChanged && Array.from(select('scope').options).some(
      (o) => o.value === prior,
    )
      ? prior
      : defaultScope;
    if (!select('scope').value) select('scope').value = 'page';
    scopeInfo();
  }
  if (initial) {
    input('only-new').checked = settings.onlyNew;
    input('pdf-branding').checked = settings.pdfBranding;
    select('paper').value = settings.paper;
    input('pace').value = String(settings.pace / 1000);
    input('limit').value = String(settings.navigationLimit);
    const sidebar = await chrome.storage.local.get('orderstash_sidebar_auto');
    input('auto-sidebar').checked = presentation !== 'docked' && sidebar.orderstash_sidebar_auto !== false;
  }
  await refreshStatus();
}
function renderJob() {
  el('job-panel').hidden = !job.busy && !job.message;
  putText('job-title', job.busy
    ? job.progress?.title || 'Starting export'
    : job.resumeAt ? 'Taking a short break' : job.paused
      ? 'Paused'
      : 'OrderStash');
  putText('job-message', job.message);
  putText('job-progress', job.resumeAt
    ? `Continues automatically in ${Math.max(0, Math.ceil((job.resumeAt - Date.now()) / 1000))}s`
    : job.progress
    ? `${job.progress.navigations} automated visits${job.progress.total ? ` · ${job.progress.done}/${job.progress.total}` : ` · ${job.progress.done} saved`}` +
      (job.busy && (job.progress.waitingUntil || 0) > Date.now()
        ? ` · Next visit in ${Math.ceil((job.progress.waitingUntil! - Date.now()) / 1000)}s` : '')
    : '');
  el('pause-job').hidden = !job.busy && !job.resumeAt;
  el('resume-job').hidden = job.busy || !job.paused || Boolean(job.resumeAt);
  for (const id of [
    'save-pdfs',
    'save-csv',
    'collect-only',
    'collect-payments',
    'scope',
    'extra-details',
    'categories',
    'tracking',
    'only-new',
  ]) {
    (
      el(id) as HTMLButtonElement | HTMLInputElement | HTMLSelectElement
    ).disabled = job.busy || selectedYearPending !== undefined;
  }
}
function history(runs: Run[], receipts: Receipt[]) {
  const root = el('history');
  const revision = JSON.stringify([runs, receipts]);
  if (revision === historyRevision) return;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.anchorNode && root.contains(selection.anchorNode)) return;
  const expanded = new Set(Array.from(root.querySelectorAll('article')).filter(row =>
    row.querySelector('details[open]')).map(row => row.dataset.runId));
  historyRevision = revision;
  root.replaceChildren();
  if (!runs.length) {
    root.textContent = 'Your completed exports will appear here.';
    return;
  }
  for (const run of runs) {
    const row = document.createElement('article');
    row.dataset.runId = run.id;
    row.className = 'history-entry';
    const title = document.createElement('strong');
    title.textContent = run.label;
    row.append(title);
    const detail = document.createElement('p');
    const count = run.kind === 'scan' ? Math.max(run.selected.length, run.completed.length) : run.completed.length;
    detail.textContent = `${new Date(run.startedAt).toLocaleString()} · ${run.status} · ${count} ${run.kind === 'scan' ? 'orders loaded' : 'saved'}`;
    row.append(detail);
    if (run.filename) {
      const file = document.createElement('p');
      file.textContent = run.filename.replace(/^.*[\\/]/, '');
      file.title = run.filename;
      row.append(file);
    }
    const downloadId =
      run.downloadId ?? receipts.find((r) => r.runId === run.id)?.downloadId;
    if (downloadId !== undefined) {
      const button = document.createElement('button');
      button.textContent = 'Show download';
      button.onclick = () =>
        void send('show-download', {downloadId}).catch((e) =>
          notice(String(e), true),
        );
      row.append(button);
    }
    const issues = run.issues.filter(issue => !(run.status === 'paused' &&
      /^Paused\.|^Pausing|^Finishing the current/i.test(issue.message)));
    if (run.pauseReason) {
      const reason = document.createElement('p');
      reason.textContent = run.pauseReason;
      row.append(reason);
    }
    if (issues.length) {
      const details = document.createElement('details');
      details.open = expanded.has(run.id);
      const summary = document.createElement('summary');
      summary.textContent = `${issues.length} issue(s)`;
      details.append(summary);
      for (const issue of issues) {
        const p = document.createElement('p');
        p.textContent = `${issue.orderId} ${issue.message}`;
        details.append(p);
      }
      row.append(details);
    }
    root.append(row);
  }
}
async function refreshStatus() {
  if (refreshing) return;
  refreshing = true;
  try {
    if (context) {
      const response = await send('status', {origin: context.origin});
      job = response.job;
      const orders = scopeOrders(response.orders);
      const remaining = orders.filter((o) =>
        (response.remaining as string[]).includes(o.key),
      ).length;
      putText('library-count', `${response.orders.length} unique order${response.orders.length === 1 ? '' : 's'} saved locally`);
      putText('saved', `${orders.length} saved summaries for this selection · ${remaining} invoice PDF(s) not exported yet.`);
      history(response.runs, response.receipts);
      libraryOrders = response.orders;
      libraryReceipts = response.orderReceipts;
      renderOrders();
    } else {
      libraryOrders = [];
      libraryReceipts = [];
      renderOrders();
    }
    renderJob();
  } finally {
    refreshing = false;
  }
}
async function preferences() {
  await send('preferences', {
    onlyNew: input('only-new').checked,
    pdfBranding: input('pdf-branding').checked,
    paper: select('paper').value,
    pace: Number(input('pace').value) * 1000,
    navigationLimit: Number(input('limit').value),
  });
  await chrome.storage.local.set({
    orderstash_sidebar_auto: input('auto-sidebar').checked,
  });
}
async function start(
  kind: 'pdf' | 'csv' | 'collect' | 'payments',
  resume = false,
) {
  notice('');
  if (
    (input('categories').checked || input('tracking').checked) &&
    !input('extra-details').checked
  ) {
    throw new Error(
      'Select extra order details before product or tracking lookups.',
    );
  }
  await send('start', {
    resume,
    request: {
      kind,
      scope: select('scope').value,
      view: select('csv-view').value as CsvView,
      details: input('extra-details').checked,
      categories: input('categories').checked,
      tracking: input('tracking').checked,
    },
  });
  await refreshStatus();
}
async function initialise() {
  el('version').textContent =
    `OrderStash ${VERSION} · Local records · Free PDF export`;
  el('close-panel').hidden = !params.has('embedded');
  el('native-panel').hidden = presentation === 'docked';
  document
    .querySelectorAll<HTMLElement>('[data-page]')
    .forEach((b) => (b.onclick = () => show(b.dataset.page!)));
  bind('save-pdfs', () => start('pdf'));
  bind('save-csv', () => start('csv'));
  bind('collect-only', () => start('collect'));
  bind('collect-payments', () => start('payments'));
  input('order-search').oninput = () => { libraryPage = 0; renderOrders(true); };
  for (const id of ['order-period', 'order-status']) {
    select(id).onchange = () => { libraryPage = 0; renderOrders(true); };
  }
  bind('orders-previous', () => { libraryPage--; renderOrders(true); });
  bind('orders-next', () => { libraryPage++; renderOrders(true); });
  bind('pause-job', async () => {
    await send('pause');
    await refreshStatus();
  });
  bind('resume-job', () => start('collect', true));
  bind('open-amazon', async () => {
    await send('open-orders');
  });
  bind('refresh', refreshContext);
  bind('refresh-context', refreshContext);
  bind('detach', async () => {
    await send('detach');
    if (params.has('embedded'))
      parent.postMessage({source: 'orderstash', action: 'close'}, '*');
  });
  bind('native-panel', async () => {
    if (context) {
      await chrome.sidePanel.open({windowId: context.windowId});
      if (params.has('embedded'))
        parent.postMessage({source: 'orderstash', action: 'close'}, '*');
      if (presentation === 'popup') window.close();
    }
  });
  bind('close-panel', () => {
    parent.postMessage({source: 'orderstash', action: 'close'}, '*');
  });
  select('scope').onchange = () => void (async () => {
    notice('');
    scopeInfo();
    const scope = select('scope').value;
    if (scope !== 'page' && Number(scope.slice(5)) !== context?.selectedYear) {
      selectedYearPending = Number(scope.slice(5));
      renderJob();
      notice(`Opening ${selectedYearPending} orders on Amazon…`);
      try {
        await send('select-year', {year: selectedYearPending});
      } catch (error) {
        selectedYearPending = undefined;
        renderJob();
        throw error;
      }
    }
    await refreshStatus();
  })().catch(error => notice(String(error), true));
  input('only-new').onchange = () =>
    void preferences().catch((e) => notice(String(e), true));
  el('preferences').onsubmit = (event) => {
    event.preventDefault();
    void preferences()
      .then(() => notice('Preferences saved.'))
      .catch((e) => notice(String(e), true));
  };
  bind('clear-data', async () => {
    if (
      confirm(
        'Clear local OrderStash records and export history? Downloaded files will stay.',
      )
    ) {
      await send('clear');
      await refreshStatus();
      notice('Local records cleared.');
    }
  });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === chrome.runtime.id && message.target === 'panel' &&
        message.action === 'page-changed' &&
        (message.tabId === (context?.tabId ?? sourceTab) || !context)) {
      void refreshContext().then(() => {
        if (selectedYearPending === undefined) notice('');
      }).catch(error => notice(String(error), true));
    }
    return false;
  });
  await refreshContext();
  await send('panel-visibility', {open: true, presentation});
  setInterval(
    () => void (context?.ordersPage ? refreshStatus() : refreshContext()).catch((e) => notice(String(e), true)),
    1500,
  );
}
void initialise().catch((e) =>
  notice(e instanceof Error ? e.message : String(e), true),
);
