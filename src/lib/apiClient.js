const TOKEN_KEY = 'emberly_token';
const listeners = new Set();
let currentUser = null;

function errorResult(message, status = 500) {
  return { data: null, error: { message, status } };
}

function emitAuth(event, session) {
  for (const listener of listeners) listener(event, session);
}

function readSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { access_token: token, refresh_token: token, user: currentUser } : null;
}

async function request(path, options = {}) {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    const body = await response.json();
    if (!response.ok) return errorResult(body.error || 'Request failed', response.status);
    return { data: Object.hasOwn(body, 'data') ? body.data : body, error: null };
  } catch (error) {
    return errorResult(error.message || 'Could not connect to the Emberly server.', 0);
  }
}

function storeSession(session) {
  if (session?.access_token) {
    localStorage.setItem(TOKEN_KEY, session.access_token);
    currentUser = session.user || null;
    const profileList = safeProfiles();
    const user = session.user;
    if (user) {
      const profiles = profileList.filter((profile) => profile.id !== user.id);
      profiles.push({
        id: user.id,
        email: user.email,
        display_name: user.user_metadata?.display_name || '',
        role: user.role || 'user',
        access_token: session.access_token,
        refresh_token: session.access_token,
      });
      try {
        localStorage.setItem('emberly_profiles', JSON.stringify(profiles));
        localStorage.setItem('emberly_active_id', user.id);
      } catch (error) {
        console.error('Could not store the account on this device:', error);
      }
    }
  } else {
    localStorage.removeItem(TOKEN_KEY);
    currentUser = null;
  }
}

function safeProfiles() {
  try {
    const parsed = JSON.parse(localStorage.getItem('emberly_profiles') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Could not read saved accounts:', error);
    return [];
  }
}

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this.action = 'select';
    this.payload = null;
    this.filters = [];
    this.sort = [];
    this.columns = '*';
    this.conflict = '';
    this.returnSingle = false;
    this.returnMaybeSingle = false;
  }

  select(columns = '*') { this.columns = columns; return this; }
  insert(payload) { this.action = 'insert'; this.payload = payload; return this; }
  update(payload) { this.action = 'update'; this.payload = payload; return this; }
  delete() { this.action = 'delete'; return this; }
  upsert(payload, options = {}) { this.action = 'upsert'; this.payload = payload; this.conflict = options.onConflict || ''; return this; }
  eq(column, value) { this.filters.push({ column, operator: 'eq', value }); return this; }
  is(column, value) { this.filters.push({ column, operator: 'is', value }); return this; }
  in(column, values) { this.filters.push({ column, operator: 'in', value: values }); return this; }
  order(column, options = {}) { this.sort.push({ column, ascending: options.ascending !== false }); return this; }
  single() { this.returnSingle = true; return this; }
  maybeSingle() { this.returnMaybeSingle = true; return this; }

  async execute() {
    const result = await request(`/api/data/${encodeURIComponent(this.table)}`, {
      method: 'POST',
      body: JSON.stringify({
        action: this.action,
        payload: this.payload,
        filters: this.filters,
        order: this.sort,
        columns: this.columns,
        onConflict: this.conflict,
      }),
    });
    if (result.error) return result;
    if (this.returnSingle) {
      if (!Array.isArray(result.data) || result.data.length !== 1) return errorResult('Expected exactly one record.', 404);
      return { data: result.data[0], error: null };
    }
    if (this.returnMaybeSingle) {
      if (Array.isArray(result.data) && result.data.length > 1) return errorResult('Expected at most one record.', 400);
      return { data: result.data?.[0] || null, error: null };
    }
    return result;
  }

  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

class Channel {
  constructor() { this.timer = null; }
  on(_event, _filter, callback) { this.callback = callback; return this; }
  subscribe() {
    this.timer = window.setInterval(() => this.callback?.(), 6000);
    return this;
  }
  unsubscribe() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }
}

export const isApiConfigured = true;

export const supabase = {
  from: (table) => new QueryBuilder(table),
  channel: () => new Channel(),
  removeChannel: (channel) => channel.unsubscribe(),
  admin: {
    setPassword: (userId, password) => request(`/api/admin/profiles/${encodeURIComponent(userId)}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ password }),
    }),
  },
  rpc: async (name, params = {}) => request(`/api/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify(params),
  }),
  auth: {
    async getSession() {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) return { data: { session: null }, error: null };
      const result = await request('/api/auth/me');
      if (result.error) {
        storeSession(null);
        return { data: { session: null }, error: null };
      }
      currentUser = result.data;
      return { data: { session: { access_token: token, refresh_token: token, user: currentUser } }, error: null };
    },
    onAuthStateChange(callback) {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    async signUp({ email, password, options = {} }) {
      const result = await request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name: options.data?.display_name || '' }),
      });
      if (result.error) return result;
      storeSession(result.data.session);
      emitAuth('SIGNED_IN', result.data.session);
      return { data: { user: result.data.session.user, session: result.data.session }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (result.error) return result;
      storeSession(result.data.session);
      emitAuth('SIGNED_IN', result.data.session);
      return { data: result.data, error: null };
    },
    async signOut() {
      storeSession(null);
      emitAuth('SIGNED_OUT', null);
      return { error: null };
    },
    async setSession(session) {
      localStorage.setItem(TOKEN_KEY, session.access_token);
      const result = await request('/api/auth/me');
      if (result.error) {
        storeSession(null);
        return { data: { session: null }, error: result.error };
      }
      const value = { access_token: session.access_token, refresh_token: session.refresh_token, user: result.data };
      storeSession(value);
      emitAuth('SIGNED_IN', value);
      return { data: { session: value }, error: null };
    },
    async updateUser({ password }) {
      const result = await request('/api/auth/password', { method: 'PATCH', body: JSON.stringify({ password }) });
      return { data: result.data, error: result.error };
    },
    async resetPasswordForEmail(email) {
      return request('/api/auth/password-reset', { method: 'POST', body: JSON.stringify({ email }) });
    },
    async verifyOtp() { return errorResult('Email verification is not enabled for local SQLite accounts.', 400); },
    async resend() { return errorResult('Email verification is not enabled for local SQLite accounts.', 400); },
    async signInWithOAuth() { return errorResult('Google sign-in needs an external OAuth provider and is not enabled in local SQLite mode.', 400); },
  },
};

export const api = supabase;
export function requireApi() { return api; }
