import axios from 'axios';

/**
 * Axios instance for the NestJS backend API.
 * Used alongside the PHP apiClient during migration.
 * Eventually this will replace apiClient entirely.
 */
const nestClient = axios.create({
  baseURL: '/api',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

// Attach JWT token from localStorage (set on login)
nestClient.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem('openemr_user');
    if (raw) {
      const user = JSON.parse(raw);
      if (user.token) {
        config.headers.Authorization = `Bearer ${user.token}`;
      }
    }
  } catch {
    // ignore parse errors
  }
  return config;
});

// If an authenticated request is rejected with 401 (expired/invalid token),
// clear the session and send the user back to the login screen instead of
// leaving them on an empty dashboard. Requests without a token (e.g. the
// patient portal) are left untouched so their own error handling runs.
nestClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const hadToken = Boolean(error?.config?.headers?.Authorization);
    if (status === 401 && hadToken) {
      try {
        localStorage.removeItem('openemr_user');
      } catch {
        // ignore storage errors
      }
      if (!window.location.pathname.startsWith('/portal')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export default nestClient;
