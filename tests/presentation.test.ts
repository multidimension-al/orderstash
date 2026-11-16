import {externalPanel} from '../src/app/presentation';

const url = 'chrome-extension://orderstash/panel.html';
test('a docked panel owns its browser window across years and tabs', () => {
  const docked = {contextType: 'SIDE_PANEL', documentUrl: url + '?docked=1', windowId: 7, tabId: -1};
  expect(externalPanel([docked], 10, 7, url)).toBe(docked);
  expect(externalPanel([docked], 11, 7, url)).toBe(docked);
  expect(externalPanel([docked], 10, 8, url)).toBeUndefined();
  expect(externalPanel([], 10, 7, url)).toBeUndefined();
});
test('detached controls suppress the embedded panel for their source tab', () => {
  const detached = {contextType: 'TAB', documentUrl: url + '?detached=1&sourceTab=10', windowId: 8, tabId: 12};
  expect(externalPanel([detached], 10, 7, url)).toBe(detached);
  expect(externalPanel([detached], 11, 7, url)).toBeUndefined();
  expect(externalPanel([{...detached, documentUrl: url + '?embedded=1&sourceTab=10'}], 10, 7, url)).toBeUndefined();
});
