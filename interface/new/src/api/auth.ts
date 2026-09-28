import apiClient from './client';
import type { TokenResponse } from '../types/auth';

/**
 * Exchange authorization code for tokens (OAuth2 Authorization Code + PKCE).
 *
 * @param code - The authorization code from /oauth2/authorize redirect
 * @param codeVerifier - The PKCE code verifier generated during login initiation
 * @param redirectUri - Must match the redirect_uri used in the authorize request
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    client_id: 'openemr-react-client',
  });

  const response = await apiClient.post('/oauth2/default/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return response.data;
}

/**
 * Refresh an expired access token using a refresh token.
 */
export async function refreshToken(
  refreshToken: string,
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: 'openemr-react-client',
  });

  const response = await apiClient.post('/oauth2/default/token', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return response.data;
}

/**
 * Log the user out by revoking the token on the server.
 */
export async function revokeToken(
  accessToken: string,
): Promise<void> {
  const params = new URLSearchParams({
    token: accessToken,
    client_id: 'openemr-react-client',
  });

  await apiClient.post('/oauth2/default/revoke', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}
