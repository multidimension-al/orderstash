import {
  checkDocument,
  enrichment,
  parseDetails,
  parseListing,
  parsePayments,
} from './extract';
import {SiteBlocked, WorkPaused} from './model';
import type {OrderRecord} from './model';
import type {PageDocument} from './browser';

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'parser') {
    return false;
  }
  try {
    const [first, second, third] = message.args;
    let value: unknown;
    switch (message.method) {
      case 'listing':
        value = parseListing(first as PageDocument, second as string, Boolean(third));
        break;
      case 'details':
        value = parseDetails(first as PageDocument, second as OrderRecord);
        break;
      case 'payments':
        value = parsePayments(
          first as PageDocument,
          second as string,
          third as string,
        );
        break;
      case 'inspect':
        checkDocument(first as PageDocument, second as string);
        break;
      case 'enrichment':
        value = enrichment(first as string, second as 'category' | 'tracking');
        break;
      case 'blob': {
        const body = third
          ? Uint8Array.from(atob(first as string), (c) => c.charCodeAt(0))
          : (first as string);
        value = URL.createObjectURL(new Blob([body], {type: second as string}));
        break;
      }
      case 'release':
        URL.revokeObjectURL(first as string);
        break;
      default:
        throw new Error('Unknown local parser operation.');
    }
    respond({ok: true, value});
  } catch (error) {
    respond({
      error: error instanceof Error ? error.message : String(error),
      kind:
        error instanceof SiteBlocked
          ? 'blocked'
          : error instanceof WorkPaused
            ? 'paused'
            : 'error',
      cooldownMs: error instanceof SiteBlocked ? error.cooldownMs : undefined,
    });
  }
  return false;
});
