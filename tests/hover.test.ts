import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

const content = await readFile('dist/content.js', 'utf8');
async function until(predicate: () => boolean): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 3000) throw new Error('Hover condition timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
function setup() {
  const window = new Window({ url: 'https://x.com/home', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  const calls: any[] = [];
  const pending: { request: any; resolve: (result: any) => void }[] = [];
  (window as any).chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } },
    runtime: { getManifest: () => ({ version: 'test' }), sendMessage: async (message: any) => {
      if (message.type === 'diagnostics') return '{"helperRequests":[]}';
      calls.push(message);
      return new Promise(resolve => pending.push({ request: message.request, resolve }));
    } }
  };
  window.document.cookie = 'twid=u%3D10; path=/';
  window.document.body.innerHTML = '<main data-testid="primaryColumn"><article><div data-testid="UserName">Alice @alice</div></article></main><div data-testid="HoverCard" style="pointer-events:none"><div id="native-card" style="pointer-events:auto"><button>关注</button><div data-testid="UserName">Alice @alice</div><p>Biography</p></div></div>';
  window.eval(content);
  const card = window.document.querySelector('[data-testid="HoverCard"]')!;
  const shadow = () => card.querySelector('.xlh-hover-lists')?.shadowRoot;
  const result = (name: string, member: boolean, warnings?: string[]) => ({ ok: true, value: { accountId: '10', userId: name === 'alice' ? '42' : '43', screenName: name, fetchedAt: Date.now(), warnings, lists: [{ id: '7', name: '<b>AI</b>', private: true, member }] } });
  return { window, card, calls, pending, shadow, result };
}

test('hover cards on the timeline display memberships as text and do not write', async () => {
  const s = setup();
  try {
    await until(() => s.pending.length === 1);
    assert.equal(s.pending[0].request.action, 'preview');
    s.pending[0].resolve(s.result('alice', true, ['目录不完整']));
    await until(() => !!s.shadow()?.querySelector('.text')?.textContent.includes('<b>AI</b>'));
    assert.equal(s.shadow()!.querySelector('b'), null);
    assert.equal(s.shadow()!.querySelectorAll('svg.list-icon').length, 1);
    assert.equal(s.shadow()!.querySelector('.note')!.textContent, '目录可能不完整');
    assert.equal(s.window.document.querySelector('article .xlh-hover-lists'), null);
    assert.equal(s.calls.some(call => call.request.action === 'toggle'), false);
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});

test('a reused hover card discards the previous user response', async () => {
  const s = setup();
  try {
    await until(() => s.pending.length === 1);
    s.card.querySelector('[data-testid="UserName"]')!.textContent = 'Bob @bob';
    await until(() => s.pending.length === 2);
    s.pending[0].resolve(s.result('alice', true));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(!s.shadow()!.querySelector('.text')!.textContent.includes('AI'));
    s.pending[1].resolve(s.result('bob', false));
    await until(() => s.shadow()?.querySelector('.text')?.textContent === '未加入列表');
    assert.equal(s.card.querySelectorAll('.xlh-hover-lists').length, 1);
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});

test('hover errors offer an explicit fresh read retry', async () => {
  const s = setup();
  try {
    await until(() => s.pending.length === 1);
    s.pending[0].resolve({ ok: false, error: 'network failed' });
    await until(() => s.shadow()?.querySelector('.text')?.textContent === '列表状态读取失败');
    assert.equal(s.shadow()!.querySelector('.note')!.textContent, 'network failed');
    assert.equal(s.card.querySelector('.xlh-hover-lists')!.parentElement!.id, 'native-card');
    let insideNativeBody = false;
    s.window.document.getElementById('native-card')!.addEventListener('pointerover', () => { insideNativeBody = true; });
    s.shadow()!.querySelector('.retry')!.dispatchEvent(new s.window.PointerEvent('pointerover', { bubbles: true, composed: true }));
    assert.equal(insideNativeBody, true);
    (s.shadow()!.querySelector('button') as any).click();
    await until(() => s.pending.length === 2);
    assert.equal(s.pending[1].request.force, true);
    s.pending[1].resolve(s.result('alice', false));
    await until(() => s.shadow()?.querySelector('.text')?.textContent === '未加入列表');
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});

test('initial page readiness failure retries once while the card remains open', async () => {
  const s = setup();
  try {
    await until(() => s.pending.length === 1);
    s.pending[0].resolve({ ok: false, error: '尚未捕获 X 网页请求，请等待加载。' });
    await until(() => s.pending.length === 2);
    assert.equal(s.pending[1].request.force, true);
    s.pending[1].resolve({ ok: false, error: '尚未捕获 X 网页请求，请等待加载。' });
    await until(() => s.shadow()?.querySelector('.text')?.textContent === '列表状态读取失败');
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(s.pending.length, 2);
    assert.match(s.shadow()!.querySelector('.note')!.textContent, /尚未捕获/);
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});

test('closing a card cancels a scheduled initialization retry', async () => {
  const s = setup();
  try {
    await until(() => s.pending.length === 1);
    s.pending[0].resolve({ ok: false, error: '尚未捕获 X 网页请求。' });
    await until(() => s.shadow()?.querySelector('.text')?.textContent === '正在等待接口就绪…');
    s.card.remove();
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(s.pending.length, 1);
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});

test('closing a card before its debounce expires avoids a request', async () => {
  const s = setup();
  try {
    await until(() => !!s.shadow());
    s.card.remove();
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(s.calls.length, 0);
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});

test('returning focus refreshes expired card state without duplicating in-flight reads', async () => {
  const s = setup();
  try {
    await until(() => s.pending.length === 1);
    const result = s.result('alice', false);
    result.value.fetchedAt -= 60_000;
    s.pending[0].resolve(result);
    await until(() => s.shadow()?.querySelector('.text')?.textContent === '未加入列表');
    s.window.dispatchEvent(new s.window.Event('focus'));
    s.window.dispatchEvent(new s.window.Event('focus'));
    await until(() => s.pending.length === 2);
    assert.equal(s.pending[1].request.force, true);
    s.pending[1].resolve(s.result('alice', true));
    await until(() => !!s.shadow()?.querySelector('.text')?.textContent.includes('AI'));
    assert.equal(s.pending.length, 2);
  } finally { await s.window.happyDOM.abort(); s.window.close(); }
});
