// The background worker owns Chrome APIs; this document-only bridge provides
// DOM parsing and download blobs without opening a user-facing page.
import type {PageDocument} from './browser';
import {OrderRecord, SiteBlocked, WorkPaused} from './model';
import type {Listing} from './extract';
import type {Payment} from './model';

let creating: Promise<void> | undefined;
export async function ensureParser(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: 'parser.html',
        reasons: [
          chrome.offscreen.Reason.DOM_PARSER,
          chrome.offscreen.Reason.BLOBS,
        ],
        justification:
          'Parse order page snapshots and hold local export blobs.',
      })
      .finally(() => {
        creating = undefined;
      });
  }
  await creating;
}
async function call<T>(method: string, args: unknown[]): Promise<T> {
  await ensureParser();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const response = await Promise.race([
    chrome.runtime.sendMessage({target: 'parser', method, args}),
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new WorkPaused(
        'The local page reader did not respond. Progress is saved; reload OrderStash and resume.',
      )), 30000);
    }),
  ]).finally(() => clearTimeout(timeout));
  if (!response || response.error) {
    if (response?.kind === 'blocked') {
      throw new SiteBlocked(response.error, response.cooldownMs);
    }
    if (response?.kind === 'paused') {
      throw new WorkPaused(response.error);
    }
    throw new Error(response?.error || 'The local parser is unavailable.');
  }
  return response.value as T;
}
export const parseListing = (page: PageDocument, profile: string, allowPartial = false) =>
  call<Listing>('listing', [page, profile, allowPartial]);
export const parseDetails = (page: PageDocument, order: OrderRecord) =>
  call<OrderRecord>('details', [page, order]);
export const parsePayments = (
  page: PageDocument,
  profile: string,
  origin: string,
) => call<Payment[]>('payments', [page, profile, origin]);
export const inspectDocument = (page: PageDocument, origin: string) =>
  call<void>('inspect', [page, origin]);
export const enrichment = (html: string, type: 'category' | 'tracking') =>
  call<string>('enrichment', [html, type]);
export const blobUrl = (content: string, type: string, base64 = false) =>
  call<string>('blob', [content, type, base64]);
export const releaseBlob = (url: string) => call<void>('release', [url]);
