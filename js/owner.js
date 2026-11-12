'use strict';

window.OwnerManager = (() => {
  let client = null;
  let owner = false;
  let generation = 0;
  let initialized = null;
  let subscribed = false;
  const listeners = [];
  const notify = () => listeners.forEach(fn => fn());

  async function refreshIdentity() {
    const version = ++generation;
    owner = false;
    notify();
    if (!client) return false;
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session) return false;
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user || version !== generation) return false;
    const result = await client.rpc('is_site_owner');
    if (version !== generation) return false;
    owner = !result.error && result.data === true;
    notify();
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
        if (event === 'SIGNED_OUT') { generation++; owner = false; notify(); }
        else if (event !== 'INITIAL_SESSION') setTimeout(() => { refreshIdentity().catch(() => {}); }, 0);
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
    owner = false;
    notify();
  }

  async function setCompleted(wishId, completed, note = '') {
    if (!client || !owner) throw new Error('Увійди як власник.');
    const { error } = await client.rpc('set_gift_completed', { p_wish_id: wishId, p_completed: completed, p_note: note });
    if (error) throw new Error(error.code === '42501' ? 'Недостатньо прав. Увійди повторно.' : 'Не вдалося оновити контракт. Спробуй ще раз.');
    await window.BookingManager?.refresh();
  }

  return { init, refreshIdentity, requestLink, signOut, setCompleted,
    onUpdate: fn => listeners.push(fn), get isOwner() { return owner; } };
})();
