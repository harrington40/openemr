import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';
import { getStoredAuth, clearAuth, isTokenExpired } from '../utils/storage';

/** Axios instance pre-configured for OpenRx API calls */
const apiClient = axios.create({
  baseURL: '/apis',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

/**
 * Request interceptor that attaches the Bearer token
 * and automatically refreshes if expired (future enhancement).
 */
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const auth = getStoredAuth();
    if (auth && !isTokenExpired(auth.expiresAt)) {
      config.headers.Authorization = `Bearer ${auth.accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

/**
 * Response interceptor that clears auth on 401 and redirects to login.
 */
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      clearAuth();
      window.location.href = '/app/login';
    }
    return Promise.reject(error);
  },
);

export default apiClient;
