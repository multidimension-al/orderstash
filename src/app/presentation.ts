export interface PanelContext {
  contextType: string;
  documentUrl?: string;
  windowId: number;
  tabId: number;
}

export function externalPanel(
  contexts: PanelContext[], tabId: number, windowId: number, panelUrl: string,
): PanelContext | undefined {
  return contexts.find(context => {
    if (!context.documentUrl) return false;
    const url = new URL(context.documentUrl);
    if (url.origin !== new URL(panelUrl).origin || url.pathname !== '/panel.html') return false;
    if (context.contextType === 'SIDE_PANEL') return context.windowId === windowId;
    return url.searchParams.has('detached') && Number(url.searchParams.get('sourceTab')) === tabId;
  });
}

export async function closeDocked(windowId: number): Promise<void> {
  const api = chrome.sidePanel as typeof chrome.sidePanel & {
    close?: (options: {windowId: number}) => Promise<void>;
  };
  if (api.close) await api.close({windowId});
  else {
    // Chrome 120–140 does not expose sidePanel.close().
    await api.setOptions({enabled: false});
    await api.setOptions({enabled: true});
  }
}
