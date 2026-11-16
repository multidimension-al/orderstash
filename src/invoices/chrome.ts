import {blobUrl as createDownload, releaseBlob} from '../app/parse';
import {
  amazonUrl,
  ExportAdapter,
  filename,
  inspectPage,
  InvoiceJob,
  PageSnapshot,
  SessionRequired,
} from './core';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const DEBUGGER_TAB = 'orderstash_invoice_debugger_tab';

// A fresh worker has no active exporter. Release its recorded attachment,
// including if that owned tab has since navigated away from Amazon.
export async function cleanupInvoiceDebugger(): Promise<void> {
  const tabId = (await chrome.storage.local.get(DEBUGGER_TAB))[DEBUGGER_TAB];
  if (typeof tabId === 'number') {
    await chrome.debugger.detach({tabId}).catch(() => undefined);
    await chrome.storage.local.remove(DEBUGGER_TAB);
  }
}

export interface ExportControls {
  windowId?: number;
  beforeVisit?: () => Promise<void>;
  afterVisit?: () => Promise<void>;
  onTab?: (id: number) => void;
  beforePrint?: (id: number, job: InvoiceJob) => Promise<void>;
  folder?: string;
  paper?: 'letter' | 'a4';
}

// Serialized by executeScript: keep this function independent of module state.
export async function readPage(): Promise<PageSnapshot> {
  const text = document.body?.innerText || '';
  const links = Array.from(document.querySelectorAll('a[href]')).map((a) => ({
    url: (a as HTMLAnchorElement).href,
    text: a.textContent || '',
  }));

  // Amazon's invoice popovers can keep their content in a template attribute.
  for (const node of Array.from(
    document.querySelectorAll('[data-a-popover]'),
  )) {
    try {
      const data = JSON.parse(node.getAttribute('data-a-popover') || '{}');

      if (typeof data.inlineContent === 'string') {
        const template = document.createElement('template');
        template.innerHTML = data.inlineContent;

        for (const a of Array.from(
          template.content.querySelectorAll('a[href]'),
        )) {
          links.push({
            url: new URL(a.getAttribute('href')!, location.href).href,
            text: a.textContent || '',
          });
        }
      }
    } catch {
      // Not every popover has JSON or inline HTML.
    }
  }

  // Amazon sometimes loads the invoice link only after opening its popover.
  const popovers = document.querySelectorAll<HTMLElement>(
    '[data-action="a-popover"], [data-action="a-dropdown"]',
  );

  for (const element of Array.from(popovers)) {
    if (
      /^\s*(?:invoice|view invoice)\s*$/i.test(element.innerText) &&
      !element.dataset.orderstashOpened
    ) {
      element.dataset.orderstashOpened = 'true';
      (element.querySelector<HTMLElement>('a, button') || element).click();
    }
  }

  return {
    url: location.href,
    text,
    heading: Array.from(document.querySelectorAll('h1, h2, h3, title'))
      .map((e) => e.textContent || '')
      .join(' '),
    signIn: Boolean(
      document.querySelector('input[type="password"], #ap_email'),
    ),
    challenge:
      Boolean(
        document.querySelector(
          '#captchacharacters, form[action*="validateCaptcha"], ' +
            'iframe[src*="captcha"], #cvf-page-content',
        ),
      ) ||
      /robot check|enter the characters you see below|automated access|too many requests|service unavailable/i.test(
        text,
      ),
    links,
  };
}

export async function waitForDownload(id: number): Promise<string> {
  // Querying first also handles downloads completed before listener attachment.
  const deadline = Date.now() + 120000;

  while (Date.now() < deadline) {
    const [item] = await chrome.downloads.search({id});

    if (!item) {
      throw new Error('Download record is missing; retry this order.');
    }

    if (item.state === 'complete') {
      if (!item.exists || item.fileSize === 0) {
        throw new Error('The downloaded file is missing or empty.');
      }

      return item.filename;
    }

    if (item.state === 'interrupted') {
      throw new Error(`Download interrupted: ${item.error || 'unknown error'}`);
    }

    await delay(300);
  }

  // Keep the download ID so reopening/resuming can reconcile it, not duplicate it.
  throw new SessionRequired(
    'The download is still pending. Resolve any Chrome download prompt, ' +
      'then resume.',
  );
}

export class ChromeInvoiceExporter implements ExportAdapter {
  tabId?: number;
  private attached = false;
  private lastOrderAt = 0;
  private readonly onDetach = (source: chrome.debugger.Debuggee) => {
    if (source.tabId === this.tabId) {
      this.attached = false;
    }
  };
  private readonly onUpdated = (tabId: number, changes: chrome.tabs.TabChangeInfo) => {
    if (tabId !== this.tabId || !changes.url || changes.url === 'about:blank') return;
    try { amazonUrl(changes.url); }
    catch { void this.close(true); }
  };

  constructor(private readonly controls: ExportControls = {}) {}

  async open(): Promise<void> {
    if (this.tabId !== undefined) {
      await chrome.tabs.get(this.tabId).catch(() => {
        throw new SessionRequired(
          'The invoice tab was closed. Resume to reopen it.',
        );
      });

      if (!this.attached) {
        throw new SessionRequired(
          'PDF generation was disconnected. Resume to reconnect.',
        );
      }

      return;
    }

    const tab = await chrome.tabs.create({
      url: 'about:blank',
      active: false,
      windowId: this.controls.windowId,
    });
    this.tabId = tab.id!;
    this.controls.onTab?.(this.tabId);
    await chrome.debugger.attach({tabId: this.tabId}, '1.3');
    this.attached = true;
    await chrome.storage.local.set({[DEBUGGER_TAB]: this.tabId});
    chrome.debugger.onDetach.addListener(this.onDetach);
    chrome.tabs.onUpdated.addListener(this.onUpdated);
    await this.command('Page.enable');
    await this.command('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.print = () => {};',
    });
  }

  private async command(method: string, params?: object): Promise<unknown> {
    if (!this.attached) {
      throw new SessionRequired(
        'PDF generation was disconnected. Resume to reconnect.',
      );
    }

    try {
      return await chrome.debugger.sendCommand(
        {tabId: this.tabId},
        method,
        params,
      );
    } catch (error) {
      if (
        !this.attached ||
        /not attached|No tab|target closed/i.test(String(error))
      ) {
        throw new SessionRequired(
          'The invoice tab disconnected. Resume to reconnect.',
        );
      }

      throw error;
    }
  }

  async close(keepTab = false): Promise<void> {
    chrome.debugger.onDetach.removeListener(this.onDetach);
    chrome.tabs.onUpdated.removeListener(this.onUpdated);
    if (this.attached) {
      await chrome.debugger.detach({tabId: this.tabId}).catch(() => undefined);
      this.attached = false;
    }
    const saved = await chrome.storage.local.get(DEBUGGER_TAB);
    if (saved[DEBUGGER_TAB] === this.tabId) await chrome.storage.local.remove(DEBUGGER_TAB);

    if (this.tabId !== undefined && !keepTab) {
      await chrome.tabs.remove(this.tabId).catch(() => undefined);
    }

    this.tabId = undefined;
  }

  async recover(id: number): Promise<string> {
    return waitForDownload(id);
  }

  private async navigate(url: string): Promise<void> {
    await this.controls.beforeVisit?.();
    // Identify the dedicated invoice tab.
    const target = amazonUrl(url);
    target.hash = 'orderstash-invoice';
    await chrome.tabs.update(this.tabId!, {url: target.href});
    const deadline = Date.now() + 45000;

    while (Date.now() < deadline) {
      const tab = await chrome.tabs.get(this.tabId!);

      if (
        tab.status === 'complete' &&
        !tab.pendingUrl &&
        tab.url !== 'about:blank'
      ) {
        await this.controls.afterVisit?.();
        return;
      }

      await delay(250);
    }

    throw new Error('Amazon took too long to load this invoice.');
  }

  async export(
    job: InvoiceJob,
    saving: (id: number) => Promise<void>,
  ): Promise<string> {
    // At most one order every two seconds; no parallel invoice requests.
    await delay(Math.max(0, 2000 - (Date.now() - this.lastOrderAt)));
    this.lastOrderAt = Date.now();
    await this.open();
    await this.navigate(job.invoiceUrl || job.detailUrl);
    const visited = new Set<string>();

    for (let hop = 0; hop < 5; hop++) {
      const deadline = Date.now() + 15000;
      let nextUrl = '';
      let reason = 'No printable invoice was found.';

      while (Date.now() < deadline) {
        const [result] = await chrome.scripting.executeScript({
          target: {tabId: this.tabId!},
          func: readPage,
        });
        const decision = inspectPage(result.result as PageSnapshot, job);

        if (decision.kind === 'blocked') {
          await chrome.tabs.update(this.tabId!, {active: true});
          throw new SessionRequired(decision.reason);
        }

        if (decision.kind === 'invoice') {
          return this.print(job, saving);
        }

        if (decision.kind === 'navigate') {
          nextUrl = decision.url;
          break;
        }

        reason = decision.reason;
        await delay(500);
      }

      if (!nextUrl || visited.has(nextUrl)) {
        throw new Error(reason);
      }

      visited.add(nextUrl);
      await this.navigate(nextUrl);
    }

    throw new Error('Too many redirects while finding the invoice.');
  }

  private async print(
    job: InvoiceJob,
    saving: (id: number) => Promise<void>,
  ): Promise<string> {
    await this.controls.afterVisit?.();
    await this.controls.beforePrint?.(this.tabId!, job);
    await chrome.scripting.insertCSS({
      target: {tabId: this.tabId!},
      origin: 'USER',
      css: `@media print {
        #navFooter, #navFooterBackToTop, #navBackToTop,
        .navFooterBackToTop { display: none !important; }
      }`,
    });

    await chrome.scripting.executeScript({
      target: {tabId: this.tabId!},
      func: async () => {
        await Promise.race([
          Promise.all([
            document.fonts.ready,
            ...Array.from(document.images).map((img) =>
              img.complete
                ? Promise.resolve()
                : new Promise<void>((resolve) => {
                    img.addEventListener('load', () => resolve(), {once: true});
                    img.addEventListener('error', () => resolve(), {
                      once: true,
                    });
                  }),
            ),
          ]),
          new Promise((resolve) => setTimeout(resolve, 10000)),
        ]);
      },
    });

    // Check again after asset loading; a sign-in redirect must never become PDF.
    const [snapshot] = await chrome.scripting.executeScript({
      target: {tabId: this.tabId!},
      func: readPage,
    });

    if (inspectPage(snapshot.result as PageSnapshot, job).kind !== 'invoice') {
      throw new SessionRequired('The invoice changed before printing. Resume.');
    }
    await this.controls.afterVisit?.();

    const response = (await this.command('Page.printToPDF', {
      printBackground: true,
      displayHeaderFooter: false,
      paperWidth: this.controls.paper === 'a4' ? 8.2677 : 8.5,
      paperHeight: this.controls.paper === 'a4' ? 11.6929 : 11,
      preferCSSPageSize: true,
      marginTop: 0.35,
      marginBottom: 0.35,
      marginLeft: 0.35,
      marginRight: 0.35,
    })) as {data?: string};

    if (
      !response.data ||
      !atob(response.data.slice(0, 8)).startsWith('%PDF-')
    ) {
      throw new Error('Chrome did not return a valid PDF.');
    }

    const blobUrl = await createDownload(
      response.data,
      'application/pdf',
      true,
    );

    try {
      const id = await chrome.downloads.download({
        url: blobUrl,
        filename: filename(job, amazonUrl(job.detailUrl).hostname).replace(
          /^OrderStash/,
          this.controls.folder || 'OrderStash',
        ),
        conflictAction: 'uniquify',
        saveAs: false,
      });
      await saving(id);
      return await waitForDownload(id);
    } finally {
      await releaseBlob(blobUrl);
    }
  }
}
