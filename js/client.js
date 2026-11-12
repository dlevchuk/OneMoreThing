'use strict';

window.SiteClient = (() => {
  let client = null;
  function getClient() {
    if (client) return client;
    const config = window.SUPABASE_CONFIG;
    if (!window.supabase || !config?.url?.trim() || !config?.anonKey?.trim() || config.url.includes('YOUR_SUPABASE')) return null;
    client = window.supabase.createClient(config.url.trim(), config.anonKey.trim(), {
      auth: { flowType: 'pkce', detectSessionInUrl: false }
    });
    return client;
  }
  return { getClient };
})();
