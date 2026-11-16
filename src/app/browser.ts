import {inspectDocument} from './parse';
import {amazonUrl} from '../invoices/core';
import {RequestPacer, retryAfterMs} from './pace';
import {MARKETPLACES, SiteBlocked, WorkPaused} from './model';

export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));
export interface PageDocument {
  url: string;
  html: string;
  text: string;
}

// Only serialized DOM data returns to the workspace; no cookies or passwords.
export function captureDocument(): PageDocument {
  return {
    url: location.href,
    html: document.documentElement.outerHTML,
    text: document.body?.innerText || '',
  };
}

export class SiteMonitor {
  private tabIds = new Set<number>();
  private blocked?: SiteBlocked;
  private readonly listener = (
    response: chrome.webRequest.WebResponseHeadersDetails,
  ) => {
    if (
      !this.tabIds.has(response.tabId) ||
      ![403, 429, 503].includes(response.statusCode)
    ) {
      return;
    }

    const retry = response.responseHeaders?.find(
      (h) => h.name.toLowerCase() === 'retry-after',
    )?.value;
    this.blocked = new SiteBlocked(
      `Amazon returned HTTP ${response.statusCode}. Requests stopped; ` +
        'wait for the cooldown before continuing.',
      retryAfterMs(retry, Date.now()),
    );
  };

  constructor(readonly pacer: RequestPacer) {
    chrome.webRequest.onHeadersReceived.addListener(
      this.listener,
      {
        urls: MARKETPLACES.map((origin) => origin + '/*'),
        types: ['main_frame', 'xmlhttprequest'],
      },
      ['responseHeaders'],
    );
  }
  watch(id: number): void {
    this.tabIds.add(id);
  }
  async check(): Promise<void> {
    if (this.blocked) {
      await this.pacer.block(this.blocked);
    }
  }
  close(): void {
    chrome.webRequest.onHeadersReceived.removeListener(this.listener);
  }
}

export class BrowserReader {
  tabId?: number;

  constructor(
    readonly origin: string,
    readonly pacer: RequestPacer,
    readonly monitor: SiteMonitor,
    readonly windowId?: number,
  ) {}

  async open(): Promise<void> {
    if (this.tabId === undefined) {
      const tab = await chrome.tabs.create({
        url: 'about:blank',
        active: false,
        windowId: this.windowId,
      });
      this.tabId = tab.id!;
      this.monitor.watch(this.tabId);
    }
  }

  async capture(): Promise<PageDocument> {
    await this.monitor.check();
    const [result] = await chrome.scripting.executeScript({
      target: {tabId: this.tabId!},
      func: captureDocument,
    });
    const page = result.result as PageDocument;

    try {
      await inspectDocument(page, this.origin);
    } catch (error) {
      await chrome.tabs.update(this.tabId!, {active: true});

      if (error instanceof SiteBlocked) {
        await this.pacer.block(error);
      }

      throw error;
    }

    return page;
  }

  async visit(value: string): Promise<PageDocument> {
    const url = amazonUrl(value, this.origin);
    await this.monitor.check();
    await this.pacer.beforeVisit();
    await this.monitor.check();
    await this.open();
    url.hash = 'orderstash-worker';
    await chrome.tabs.update(this.tabId!, {url: url.href});
    const deadline = Date.now() + 45000;

    while (Date.now() < deadline) {
      await this.monitor.check();
      const tab = await chrome.tabs.get(this.tabId!);

      if (
        tab.status === 'complete' &&
        !tab.pendingUrl &&
        tab.url !== 'about:blank'
      ) {
        return this.capture();
      }

      await sleep(250);
    }

    throw new WorkPaused('Amazon took too long to load. Progress is saved.');
  }

  async nextTransactions(): Promise<boolean> {
    await this.monitor.check();
    await this.pacer.beforeVisit();
    await this.monitor.check();
    const [result] = await chrome.scripting.executeScript({
      target: {tabId: this.tabId!},
      func: () => {
        const before = document.body.innerText;
        const buttons = Array.from(
          document.querySelectorAll<HTMLElement>(
            'input, button, a, [role="button"]',
          ),
        );
        const candidates = buttons.filter((e) =>
          /^(?:next page|next)$/i.test(
            ((e as HTMLInputElement).value || e.textContent || '').trim(),
          ),
        );
        const next = candidates.find(
          (e) =>
            !e.hasAttribute('disabled') &&
            e.getAttribute('aria-disabled') !== 'true',
        );

        if (next) {
          next.click();
          return {clicked: true, before, atEnd: false};
        }
        if (candidates.length) {
          return {clicked: false, before, atEnd: true};
        }

        // Virtualized transaction lists fetch older rows after scrolling.
        window.scrollTo(0, document.body.scrollHeight);
        return {clicked: false, before, atEnd: false};
      },
    });
    const action = result.result as {
      clicked: boolean;
      before: string;
      atEnd: boolean;
    };
    if (action.atEnd) {
      return false;
    }
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await sleep(500);
      await this.monitor.check();
      const tab = await chrome.tabs.get(this.tabId!);
      if (tab.status !== 'complete' || tab.pendingUrl) {
        continue;
      }
      const page = await this.capture();
      if (page.text !== action.before) {
        await sleep(750);
        return true;
      }
    }
    if (action.clicked) {
      throw new WorkPaused(
        'Amazon’s payment page did not advance. ' +
          'Progress is saved. Check the worker tab before continuing.',
      );
    }
    return false;
  }

  async close(keep = false): Promise<void> {
    if (this.tabId !== undefined && !keep) {
      await chrome.tabs.remove(this.tabId).catch(() => undefined);
    }
  }
}
