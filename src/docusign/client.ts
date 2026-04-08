/**
 * docusign/client.ts
 *
 * DocuSign API client with JWT Grant authentication.
 *
 * Auth flow (JWT Grant — server-to-server, no user redirect needed):
 *   1. Build a JWT assertion signed with our RSA private key
 *   2. POST to DocuSign OAuth token endpoint
 *   3. Receive access token (valid ~1 hour)
 *   4. Use access token for all API calls
 *
 * The token is cached in memory and refreshed automatically when it expires.
 * This avoids a new OAuth round-trip on every API call.
 *
 * FIRST-TIME SETUP: DocuSign requires the impersonated user to grant consent
 * to the integration key before JWT auth works. Run the consent URL once:
 *   https://<DOCUSIGN_OAUTH_BASE_PATH>/oauth/auth?response_type=code
 *     &scope=signature%20impersonation
 *     &client_id=<DOCUSIGN_INTEGRATION_KEY>
 *     &redirect_uri=<YOUR_REDIRECT_URI>
 * After consent is granted, JWT auth works without any user interaction.
 */

import docusign from 'docusign-esign';
import { config } from '../config';
import { logger } from '../utils/logger';

interface TokenCache {
  accessToken: string;
  expiresAt: number; // unix ms
}

let tokenCache: TokenCache | null = null;

/**
 * Returns an authenticated DocuSign ApiClient.
 * Reuses a cached token if it has >5 minutes remaining.
 */
export async function getDocuSignClient(): Promise<docusign.ApiClient> {
  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath(config.docusign.basePath);
  apiClient.setOAuthBasePath(config.docusign.oauthBasePath);

  const accessToken = await getAccessToken(apiClient);
  apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);

  return apiClient;
}

async function getAccessToken(apiClient: docusign.ApiClient): Promise<string> {
  const now = Date.now();

  // Use cached token if valid for at least 5 more minutes
  if (tokenCache && tokenCache.expiresAt - now > 5 * 60 * 1000) {
    return tokenCache.accessToken;
  }

  logger.info('Requesting new DocuSign access token via JWT grant');

  const privateKey = Buffer.from(config.docusign.privateKeyBase64, 'base64').toString('utf-8');

  const scopes = ['signature', 'impersonation'];

  const tokenResponse = await apiClient.requestJWTUserToken(
    config.docusign.integrationKey,
    config.docusign.impersonationUserId,
    scopes,
    Buffer.from(privateKey),
    3600, // token lifetime in seconds
  );

  const token = tokenResponse.body;
  const expiresIn = (token.expires_in ?? 3600) as number;

  tokenCache = {
    accessToken: token.access_token as string,
    expiresAt: now + expiresIn * 1000,
  };

  logger.info('DocuSign access token obtained', {
    expiresIn,
    expiresAt: new Date(tokenCache.expiresAt).toISOString(),
  });

  return tokenCache.accessToken;
}

/** Force-invalidates the token cache (e.g. after a 401 response). */
export function invalidateTokenCache(): void {
  tokenCache = null;
  logger.warn('DocuSign token cache invalidated — will re-authenticate on next call');
}
