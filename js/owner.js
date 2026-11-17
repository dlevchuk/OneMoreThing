'use strict';

window.OwnerManager = (() => {
  let client = null;
  let owner = false;
  let generation = 0;
  let initialized = null;
  let subscribed = false;
  const listeners = [];
  const notify = () => listeners.forEach(fn => fn());
  // Listeners are notified only when the owner state really changes,
  // so periodic token refreshes never flicker the UI.
  function setOwner(value) {
    if (owner === value) return;
    owner = value;
    notify();
  }

  async function refreshIdentity() {
    const version = ++generation;
    if (!client) { setOwner(false); return false; }
    const { data: sessionData } = await client.auth.getSession();
    if (version !== generation) return owner;
    if (!sessionData?.session) { setOwner(false); return false; }
    const { data, error } = await client.auth.getUser();
    if (version !== generation) return owner;
    if (error || !data?.user) { setOwner(false); return false; }
    const result = await client.rpc('is_site_owner');
    if (version !== generation) return owner;
    setOwner(!result.error && result.data === true);
    return owner;
  }

  function init() {
    if (initialized) return initialized;
    initialized = (async () => {
      client = window.SiteClient?.getClient();
      if (!client) return;
      const url = new URL(window.location.href);
      let callback = false;
      if (url.pathname.endsWith('/owner.html') && (url.searchParams.has('code') || url.searchParams.has('error'))) {
        callback = true;
        const code = url.searchParams.get('code');
        const denied = url.searchParams.has('error');
        ['code', 'error', 'error_code', 'error_description'].forEach(key => url.searchParams.delete(key));
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
        if (denied || !code) throw new Error('Посилання недійсне або термін його дії минув. Замов нове.');
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error) throw new Error('Не вдалося використати посилання. Відкрий його в тому самому браузері або замов нове.');
      }
      if (!subscribed) client.auth.onAuthStateChange((event) => {
        // Supabase auth callbacks must finish before further auth/API calls.
        // TOKEN_REFRESHED and INITIAL_SESSION do not change who the user is.
        if (event === 'SIGNED_OUT') { generation++; setOwner(false); }
        else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') setTimeout(() => { refreshIdentity().catch(() => {}); }, 0);
      });
      subscribed = true;
      await refreshIdentity();
      if (callback && !owner) {
        await client.auth.signOut();
        throw new Error('Цей обліковий запис не має доступу власника.');
      }
    })().catch(error => { initialized = null; throw error; });
    return initialized;
  }

  async function requestLink(email) {
    await init();
    if (!client) throw new Error('Вхід тимчасово недоступний. Спробуй пізніше.');
    const { error } = await client.auth.signInWithOtp({ email, options: {
      shouldCreateUser: false, emailRedirectTo: new URL('owner.html', window.location.href).href
    } });
    if (error) throw new Error('Не вдалося надіслати посилання. Перевір адресу або спробуй пізніше.');
  }

  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw new Error('Не вдалося вийти. Спробуй ще раз.');
    generation++;
    setOwner(false);
  }

  async function setCompleted(wishId, completed, note = '') {
    if (!client || !owner) throw new Error('Увійди як власник.');
    const { error } = await client.rpc('set_gift_completed', { p_wish_id: wishId, p_completed: completed, p_note: note });
    if (error) throw new Error(error.code === '42501' ? 'Недостатньо прав. Увійди повторно.' : 'Не вдалося оновити контракт. Спробуй ще раз.');
    await window.BookingManager?.refresh();
  }

  async function requestImport(url, priority, allowUnmonitored = false) {
    if (!client || !owner) throw new Error('Увійди як власник.');
    let parsed;
    try { parsed = new URL(url.trim()); } catch { throw new Error('Вкажи повне посилання на товар.'); }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password ||
        url.trim().length > 3000 || !['want', 'nice', 'unsure'].includes(priority) || typeof allowUnmonitored !== 'boolean') {
      throw new Error('Перевір посилання та пріоритет.');
    }
    const { data, error } = await client.rpc('request_wish_import', {
      p_url: url.trim(), p_priority: priority, p_allow_unmonitored: allowUnmonitored
    });
    if (error) throw new Error(error.message === 'import_rate_limit' ? 'Забагато запитів. Спробуй пізніше.' :
      error.code === '42501' ? 'Увійди як власник повторно.' : 'Не вдалося додати запит. Спробуй ще раз.');
    return data;
  }

  async function listImports() {
    if (!client || !owner) throw new Error('Увійди як власник.');
    const { data, error } = await client.rpc('list_wish_imports');
    if (error) throw new Error('Не вдалося оновити статуси. Спробуй пізніше.');
    return Array.isArray(data) ? data : [];
  }

  return { init, refreshIdentity, requestLink, signOut, setCompleted, requestImport, listImports,
    onUpdate: fn => listeners.push(fn), get isOwner() { return owner; } };
})();
