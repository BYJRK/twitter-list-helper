import { checkApiResponse, checkDirectoryResponse, collectMemberships, extractOperations, operationFeatures, parseUser, OPERATIONS, type Operation, type OperationName, type JsonObject } from './core';
import { ListService } from './service';
import type { PageApi } from './types';
import { requestDiagnostic, responseDiagnostic, type RequestDiagnostic } from './diagnostics';
import { nativeOperations, transactionId } from './runtime';
import { nativeUsers } from './users';

declare global { interface Window { __xListHelperV1?: PageApi } }

if (!window.__xListHelperV1) {
  const nativeFetch = window.fetch.bind(window);
  const operations = new Map<OperationName, Operation>();
  const scanned = new Set<string>();
  const flagValues: Record<string, boolean> = {};
  const headers = new Headers();
  let headerAccount = '';
  const nativeDiagnostics = new Map<string, RequestDiagnostic>();
  const helperDiagnostics = new Map<string, RequestDiagnostic>();
  function rememberResponse(urlString: string, status: number, data: JsonObject): void {
    try {
      const url = new URL(urlString, location.origin);
      if (url.origin !== location.origin) return;
      const name = url.pathname.split('/').at(-1)!;
      const diagnostic = nativeDiagnostics.get(name);
      if (diagnostic) diagnostic.result = responseDiagnostic(status, data, account());
    } catch { /* No raw response is retained. */ }
  }
  const users = new Map<string, { id: string; at: number }>();
  function rememberUsers(urlString: string, data: JsonObject, requestAccount: string): void {
    try {
      const url = new URL(urlString, location.origin);
      if (url.origin !== location.origin || !url.pathname.startsWith('/i/api/graphql/') || requestAccount !== account()) return;
      // Home timelines and hover-card queries already contain the exact user identities.
      // A partial response may still have independently valid identities, but null/missing IDs are ignored.
      for (const [name, id] of nativeUsers(data.data)) users.set(`${requestAccount}:${name}`, { id, at: Date.now() });
      while (users.size > 300) users.delete(users.keys().next().value!);
    } catch { /* A native response must not affect the page when its shape is unknown. */ }
  }
  const baseline: Record<OperationName, string> = {
    UserByScreenName: 'NimuplG1OB7Fd2btCLdBOw',
    ListsManagementPageTimeline: 'I96vj5eyw1D9g_NA0wWj3Q',
    ListAddMember: 'lLNsL7mW6gSEQG6rXP7TNw',
    ListRemoveMember: 'cvDFkG5WjcXV0Qw5nfe1qQ'
  };
  const defaults: Record<string, boolean> = {
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
    hidden_profile_likes_enabled: true, hidden_profile_subscriptions_enabled: true,
    subscriptions_verification_info_is_identity_verified_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true,
    highlights_tweets_tab_ui_enabled: true, responsive_web_twitter_article_notes_tab_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    rweb_tipjar_consumption_enabled: false,
    profile_label_improvements_pcf_label_in_post_enabled: true
  };
  function cookie(name: string): string {
    const raw = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
    try { return decodeURIComponent(raw); } catch { return ''; }
  }
  function account(): string {
    const id = /^u=(\d+)$/.exec(cookie('twid'))?.[1];
    if (!id) throw new Error('未识别 X 登录账号，请登录后刷新页面。');
    return id;
  }
  function observe(urlString: string, requestHeaders: Headers, body?: string): void {
    try {
      const url = new URL(urlString, location.origin);
      if (url.origin !== location.origin || !url.pathname.startsWith('/i/api/')) return;
      const current = account();
      if (headerAccount !== current) {
        headers.delete('authorization'); headerAccount = current; service.invalidate();
        users.clear(); operations.clear(); nativeDiagnostics.clear(); helperDiagnostics.clear();
        for (const key of Object.keys(flagValues)) delete flagValues[key];
      }
      for (const key of ['authorization', 'x-twitter-auth-type', 'x-twitter-active-user', 'x-twitter-client-language']) {
        const value = requestHeaders.get(key);
        if (value) headers.set(key, value);
      }
      const match = /\/graphql\/([\w-]+)\/(\w+)$/.exec(url.pathname);
      if (!match) return;
      const name = match[2] as OperationName;
      const payload = body ? JSON.parse(body) : Object.fromEntries(['variables', 'features', 'fieldToggles'].map(key => [key, JSON.parse(url.searchParams.get(key) ?? '{}')]));
      for (const [key, value] of Object.entries(payload.features ?? {})) if (typeof value === 'boolean') flagValues[key] = value;
      if (['HomeTimeline', 'HomeLatestTimeline', 'UserByRestId', 'UsersByRestIds'].includes(name)) nativeDiagnostics.set(name, requestDiagnostic(name, match[1]!, 'native', payload, body ? 'POST' : 'GET'));
      if (OPERATIONS.includes(name) && match[1]) {
        operations.set(name, { id: match[1], features: payload.features, fieldToggles: payload.fieldToggles, variables: payload.variables, source: 'request' });
        nativeDiagnostics.set(name, requestDiagnostic(name, match[1], 'native', payload, body ? 'POST' : 'GET'));
        if (name === 'ListAddMember' || name === 'ListRemoveMember') service.invalidate();
      }
    } catch { /* Observation must never break X's requests. */ }
  }

  window.fetch = function(input, init) {
    let responseAccount = '';
    const responseUrl = input instanceof Request ? input.url : String(input);
    try {
      responseAccount = account();
      const merged = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => merged.set(key, value));
      observe(input instanceof Request ? input.url : String(input), merged, typeof init?.body === 'string' ? init.body : undefined);
      if (input instanceof Request && !init?.body && input.method !== 'GET') {
        void input.clone().text().then(body => observe(input.url, merged, body)).catch(() => {});
      }
    } catch { /* Preserve original request semantics. */ }
    const response = nativeFetch(input, init);
    if (responseUrl.includes('/i/api/graphql/')) void response.then(async result => {
      const data = await result.clone().json();
      rememberUsers(responseUrl, data, responseAccount);
      rememberResponse(responseUrl, result.status, data);
    }).catch(() => {});
    return response;
  };
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const xhrSend = XMLHttpRequest.prototype.send;
  const xhrRequests = new WeakMap<XMLHttpRequest, { url: string; headers: Headers }>();
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, async = true, username?: string | null, password?: string | null) {
    xhrRequests.set(this, { url: String(url), headers: new Headers() });
    return xhrOpen.call(this, method, url, Boolean(async), username, password);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    xhrRequests.get(this)?.headers.set(name, value);
    return xhrSetHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const request = xhrRequests.get(this);
    if (request) observe(request.url, request.headers, typeof body === 'string' ? body : undefined);
    if (request && request.url.includes('/i/api/graphql/')) {
      let responseAccount = '';
      try { responseAccount = account(); } catch { /* Not logged in. */ }
      this.addEventListener('load', () => {
        try {
          const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
          rememberUsers(request.url, data, responseAccount);
          rememberResponse(request.url, this.status, data);
        } catch { /* Non-JSON response. */ }
      }, { once: true });
    }
    return xhrSend.call(this, body);
  };

  let discovery: Promise<void> | undefined;
  async function discover(): Promise<void> {
    if (discovery) return discovery;
    discovery = (async () => {
      const urls = [...document.scripts].map(s => s.src).concat(performance.getEntriesByType('resource').map(entry => entry.name));
      const pending = [...new Set(urls)].filter(src => {
        try { const url = new URL(src); return url.protocol === 'https:' && url.hostname === 'abs.twimg.com' && url.pathname.endsWith('.js') && !scanned.has(src); } catch { return false; }
      }).slice(0, 24);
      // Download only loaded X bundles, never execute their source. Limit concurrency and time.
      await Promise.all(Array.from({ length: 4 }, async () => {
        for (let src = pending.shift(); src; src = pending.shift()) {
          scanned.add(src);
          try {
            const response = await nativeFetch(src, { credentials: 'omit', signal: AbortSignal.timeout(6000) });
            if (!response.ok) continue;
            const source = await response.text();
            if (source.length > 12_000_000) continue;
            for (const [name, operation] of extractOperations(source)) if (operations.get(name)?.source !== 'request') operations.set(name, operation);
          } catch { /* Baseline IDs remain available; native requests can replace them. */ }
        }
      }));
    })().finally(() => { discovery = undefined; });
    return discovery;
  }
  async function query(name: OperationName, variables: JsonObject): Promise<JsonObject> {
    const requestAccount = account();
    const requestPath = location.pathname;
    if (!headers.get('authorization') || headerAccount !== account()) throw new Error('尚未捕获 X 网页请求，请刷新页面，等主页加载后再重试。');
    for (const [key, value] of nativeOperations()) if (operations.get(key)?.source !== 'request') operations.set(key, value);
    if (!operations.has(name)) await discover();
    const operation = operations.get(name);
    const id = operation?.id ?? baseline[name];
    const preparation = requestDiagnostic(name, id, operation?.source ?? 'baseline', { variables }, name === 'ListAddMember' || name === 'ListRemoveMember' ? 'POST' : 'GET');
    preparation.stage = 'prepare';
    helperDiagnostics.set(name, preparation);
    let features: Record<string, boolean>;
    try { features = operationFeatures(operation, flagValues, (window as unknown as JsonObject).__INITIAL_STATE__, defaults); }
    catch (error) {
      const detail = error instanceof Error ? error.message : '无法读取接口配置。';
      preparation.result = responseDiagnostic(0, { errors: [{ message: detail }] });
      throw new Error(`[${name}; prepare] ${detail}`);
    }
    const csrf = cookie('ct0');
    if (!csrf) throw new Error('缺少 X 会话校验信息，请重新登录后刷新页面。');
    const requestHeaders = new Headers(headers);
    requestHeaders.set('x-csrf-token', csrf);
    requestHeaders.set('x-twitter-auth-type', 'OAuth2Session');
    requestHeaders.set('x-twitter-active-user', 'yes');
    requestHeaders.set('content-type', 'application/json');
    const write = name === 'ListAddMember' || name === 'ListRemoveMember';
    const url = new URL(`/i/api/graphql/${id}/${name}`, location.origin);
    const transaction = await transactionId(url.pathname, write ? 'POST' : 'GET');
    if (transaction) requestHeaders.set('x-client-transaction-id', transaction);
    // Discovery and transaction generation are asynchronous. Recheck before any request is sent.
    if (account() !== requestAccount || headerAccount !== requestAccount || location.pathname !== requestPath) throw new Error('账号或页面在请求准备期间发生变化，请刷新状态。');
    const requestVariables = name === 'ListsManagementPageTimeline' ? { ...variables } : { ...operation?.variables, ...variables };
    // Native templates may have been captured on a later page; never reuse their cursor.
    if (!('cursor' in variables)) delete requestVariables.cursor;
    const payload = { variables: requestVariables, features, queryId: id, ...(operation?.fieldToggles ? { fieldToggles: operation.fieldToggles } : {}) };
    const diagnostic = requestDiagnostic(name, id, operation?.source ?? 'baseline', payload, write ? 'POST' : 'GET');
    diagnostic.stage = 'request';
    helperDiagnostics.set(name, diagnostic);
    if (!write) for (const [key, value] of Object.entries(payload)) if (key !== 'queryId') url.searchParams.set(key, JSON.stringify(value));
    let response: Response;
    try {
      response = await nativeFetch(url, { method: write ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', headers: requestHeaders, ...(write ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(25_000) });
    } catch { throw new Error(write ? '保存请求中断，结果尚未确认。请刷新状态后再操作。' : '读取请求失败，请检查网络后重试。'); }
    let data: JsonObject;
    try { data = await response.json(); } catch { throw new Error('X 返回了无法解析的响应，请刷新重试。'); }
    diagnostic.result = responseDiagnostic(response.status, data, requestAccount);
    try {
      if (name === 'ListsManagementPageTimeline') checkDirectoryResponse(response.status, data, requestAccount);
      else checkApiResponse(response.status, data);
    }
    catch (error) { throw new Error(`[${name}; ${operation?.source ?? 'baseline'}] ${error instanceof Error ? error.message : 'X 请求失败'}`); }
    return data;
  }
  async function memberships(target: { user_id: string } | { screen_name: string }): Promise<string[]> {
    const requestAccount = account();
    const requestPath = location.pathname;
    return collectMemberships(async cursor => {
      if (account() !== requestAccount || headerAccount !== requestAccount || location.pathname !== requestPath) throw new Error('账号或页面已变化，请刷新状态。');
      if (!headers.get('authorization')) throw new Error('尚未捕获 X 请求，请刷新页面。');
      const csrf = cookie('ct0');
      if (!csrf) throw new Error('缺少 X 会话校验信息，请刷新页面。');
      const url = new URL('/i/api/1.1/lists/memberships.json', location.origin);
      const variables = { ...target, filter_to_owned_lists: true, count: 1000, cursor, skip_status: true };
      for (const [key, value] of Object.entries(variables)) url.searchParams.set(key, String(value));
      const requestHeaders = new Headers(headers);
      requestHeaders.set('x-csrf-token', csrf);
      requestHeaders.set('x-twitter-auth-type', 'OAuth2Session');
      requestHeaders.set('x-twitter-active-user', 'yes');
      const transaction = await transactionId(url.pathname, 'GET');
      if (transaction) requestHeaders.set('x-client-transaction-id', transaction);
      if (account() !== requestAccount || location.pathname !== requestPath) throw new Error('账号或页面已变化，请刷新状态。');
      const diagnostic = requestDiagnostic('lists/memberships', 'rest-v1_1', 'rest', { variables }, 'GET');
      diagnostic.stage = 'request';
      helperDiagnostics.set('lists/memberships', diagnostic);
      try {
        const response = await nativeFetch(url, { method: 'GET', credentials: 'include', cache: 'no-store', headers: requestHeaders, signal: AbortSignal.timeout(25_000) });
        const data = await response.json();
        diagnostic.result = responseDiagnostic(response.status, data, requestAccount);
        checkApiResponse(response.status, data, false);
        return data;
      } catch (error) {
        diagnostic.result ??= responseDiagnostic(0, { errors: [{ message: error instanceof Error ? error.message : '读取失败' }] });
        throw new Error(`[lists/memberships] ${error instanceof Error ? error.message : '读取列表归属失败'}`);
      }
    });
  }
  const service = new ListService({ account, pathname: () => location.pathname, query, memberships: userId => memberships({ user_id: userId }), membershipsByScreenName: screenName => memberships({ screen_name: screenName }), now: () => Date.now(), resolveUser: async screenName => {
    const requestAccount = account();
    const requestPath = location.pathname;
    const key = `${requestAccount}:${screenName.toLowerCase()}`;
    const lookup = () => {
      if (account() !== requestAccount || location.pathname !== requestPath) throw new Error('账号或页面已变化，请重新查看。');
      const cached = users.get(key);
      return cached && Date.now() - cached.at < 300_000 ? cached.id : undefined;
    };
    const cached = lookup();
    if (cached) return cached;
    // X can preload users into its initial entity store before our first observed response.
    const entities = (window as unknown as JsonObject).__INITIAL_STATE__?.entities?.users?.entities;
    const initialId = nativeUsers(entities).get(screenName.toLowerCase());
    if (initialId) { users.set(key, { id: initialId, at: Date.now() }); return initialId; }
    // Give X's own in-flight hover query a bounded chance to finish before issuing another lookup.
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const id = lookup();
      if (id) return id;
    }
    return parseUser(await query('UserByScreenName', { screen_name: screenName, withSafetyModeUserFields: true }), screenName);
  } });
  window.__xListHelperV1 = { diagnostics() {
    return JSON.stringify({ nativeRequests: [...nativeDiagnostics.values()], helperRequests: [...helperDiagnostics.values()] }, null, 2);
  }, async run(request) {
    try { return { ok: true, value: await service.run(request) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '列表请求失败，请刷新重试。' }; }
  } };
}
