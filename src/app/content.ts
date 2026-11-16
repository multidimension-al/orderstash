import {readAmazonContext} from './context';

// Follow the page the user is browsing. Never visit or paginate another page.
void (async () => {
  if (window.top !== window || location.hash.startsWith('#orderstash')) return;
  if (document.getElementById('orderstash-panel-host')) return;
  const host = document.createElement('div');
  host.id = 'orderstash-panel-host';
  const shadow = host.attachShadow({mode: 'open'});
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial;position:fixed;right:12px;top:12px;z-index:2147483646;font-family:Segoe UI,system-ui,sans-serif}
    iframe{display:block;width:min(398px,calc(100vw - 24px));height:calc(100vh - 24px);border:1px solid #cbdadd;border-radius:10px;background:white;box-shadow:0 8px 32px #18304233}`;
  const frame = document.createElement('iframe');
  frame.title = 'OrderStash invoice PDF exporter';
  const previousMargin = document.body.style.marginRight;
  let tabId: number | undefined;
  let previousRevision = '';
  let previousUrl = location.href;
  let wasOrders = false;
  let dismissed = false;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let publishing = false;
  let publishAgain = false;
  const prefs = await chrome.storage.local.get('orderstash_sidebar_auto');
  const autoSidebar = prefs.orderstash_sidebar_auto !== false;
  function visibility(open: boolean) {
    void chrome.runtime.sendMessage({
      target: 'background', action: 'panel-visibility', open, presentation: 'embedded',
    }).catch(() => undefined);
  }
  function open() {
    if (!frame.isConnected) {
      frame.src = chrome.runtime.getURL(`panel.html?embedded=1&sourceTab=${tabId}`);
      shadow.append(frame);
    }
    if (innerWidth > 1000) document.body.style.marginRight = '420px';
    visibility(true);
  }
  function close(userDismissed = true) {
    if (userDismissed) dismissed = true;
    frame.remove();
    document.body.style.marginRight = previousMargin;
    visibility(false);
  }
  shadow.append(style);
  document.documentElement.append(host);
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow ||
        event.origin !== new URL(chrome.runtime.getURL('/')).origin ||
        event.data?.source !== 'orderstash') return;
    if (event.data.action === 'close') close();
  });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === chrome.runtime.id && message.target === 'content' &&
        message.action === 'hide-panel') close(false);
    return false;
  });
  async function publish() {
    if (publishing) { publishAgain = true; return; }
    publishing = true;
    try {
      const metadata = readAmazonContext(false);
      if (metadata.revision === previousRevision) return;
      const response = await chrome.runtime.sendMessage({
        target: 'background', action: 'page-changed',
        page: metadata.ordersPage ? readAmazonContext() : metadata,
        open: frame.isConnected,
      });
      if (response?.error) return;
      previousRevision = metadata.revision;
      previousUrl = metadata.url;
      tabId = response.tabId;
      if (response.showEmbedded === false && frame.isConnected) close(false);
      if (metadata.ordersPage && !wasOrders && autoSidebar && !dismissed &&
          response.showEmbedded !== false) open();
      if (!metadata.ordersPage && frame.isConnected) close();
      wasOrders = metadata.ordersPage;
    } catch {
      // A reload can invalidate this document's extension connection.
    } finally {
      publishing = false;
      if (publishAgain) { publishAgain = false; schedule(); }
    }
  }
  function schedule() {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(() => void publish(), 450);
  }
  const relevant = '.js-order-card,.order-card,.order,#orderCard,select,' +
    '.num-orders,#num-orders,#no-orders-message,#order-history-no-orders-message,' +
    '.a-dropdown-link,[role="option"],#nav-link-accountList-nav-line-1';
  const containsOrders = (node: Node) => node instanceof Element &&
    (node.matches(relevant) || Boolean(node.querySelector(relevant)));
  const observer = new MutationObserver(records => {
    if (records.some(record =>
      (record.target instanceof Element ? record.target : record.target.parentElement)?.closest(relevant) ||
      Array.from(record.addedNodes).some(containsOrders) ||
      Array.from(record.removedNodes).some(containsOrders))) schedule();
  });
  observer.observe(document.body, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['value', 'selected', 'aria-selected', 'href'],
  });
  document.addEventListener('change', schedule);
  window.addEventListener('popstate', schedule);
  window.addEventListener('pageshow', schedule);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedule();
  });
  // pushState need not change the DOM or emit popstate. This reads only a URL;
  // it does not poll the service worker or make any Amazon requests.
  const timer = setInterval(() => {
    if (!document.hidden && location.href !== previousUrl) schedule();
  }, 1000);
  window.addEventListener('pagehide', event => {
    if (!event.persisted) { observer.disconnect(); clearInterval(timer); }
  });
  await publish();
})();
