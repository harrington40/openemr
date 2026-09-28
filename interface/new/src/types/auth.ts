/** Represents the authenticated user's session */
export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  roles: string[];
}

/** OAuth2 token response from the backend */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  patient?: string;
  id_token?: string;
}

/** Stored auth state in localStorage */
export interface AuthState {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  user: AuthUser | null;
}

/** PKCE code challenge pair */
export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}
