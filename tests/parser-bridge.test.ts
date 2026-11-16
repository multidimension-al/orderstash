import {parseListing} from '../src/app/parse';
import {WorkPaused} from '../src/app/model';

afterEach(() => jest.useRealTimers());

test('a stalled local parser pauses work instead of leaving it running indefinitely', async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, {chrome: {
    offscreen: {hasDocument: async () => true},
    runtime: {sendMessage: () => new Promise(() => undefined)},
  }});
  const result = parseListing({url: 'https://www.amazon.com', html: '', text: ''}, 'personal');
  const assertion = expect(result).rejects.toBeInstanceOf(WorkPaused);
  await jest.advanceTimersByTimeAsync(30000);
  await assertion;
  expect(jest.getTimerCount()).toBe(0);
});
