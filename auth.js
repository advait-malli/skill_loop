const API_BASE = '/api';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options
  };
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }
  const response = await fetch(url, config);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

export async function checkAuth() {
  try {
    const user = await request('/auth/me');
    return user;
  } catch {
    return null;
  }
}

export async function login(username, password) {
  return request('/auth/login', {
    method: 'POST',
    body: { username, password }
  });
}

export async function signup(displayName, username, password) {
  return request('/auth/signup', {
    method: 'POST',
    body: { displayName, username, password }
  });
}

export async function logout() {
  return request('/auth/logout', { method: 'POST' });
}
