/**
 * config/index.ts
 *
 * Only Slack vars are required at startup (needed to boot the server).
 * DocuSign, Google Drive, and signer vars are optional here and validated
 * at the point of use so the app starts and responds to Slack even while
 * credentials are still being configured.
 */

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

function requireAtBoot(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config = {
  app: {
    env: optional('NODE_ENV', 'development'),
    port: parseInt(optional('PORT', '3000'), 10),
    logLevel: optional('LOG_LEVEL', 'info'),
    baseUrl: optional('APP_BASE_URL', ''),
  },

  slack: {
    botToken: requireAtBoot('SLACK_BOT_TOKEN'),
    signingSecret: requireAtBoot('SLACK_SIGNING_SECRET'),
    authorizedUserId: requireAtBoot('JENNI_SLACK_USER_ID'),
  },

  docusign: {
    integrationKey: optional('DOCUSIGN_INTEGRATION_KEY'),
    accountId: optional('DOCUSIGN_ACCOUNT_ID'),
    basePath: optional('DOCUSIGN_BASE_PATH', 'https://demo.docusign.net/restapi'),
    oauthBasePath: optional('DOCUSIGN_OAUTH_BASE_PATH', 'account-d.docusign.com'),
    impersonationUserId: optional('DOCUSIGN_IMPERSONATION_USER_ID'),
    privateKeyBase64: optional('DOCUSIGN_PRIVATE_KEY_BASE64'),
    webhookHmacKey: optional('DOCUSIGN_WEBHOOK_HMAC_KEY'),
  },

  signers: {
    alexBovee: {
      email: optional('ALEX_BOVEE_EMAIL'),
      name: optional('ALEX_BOVEE_NAME', 'Alex Bovee'),
    },
  },

  googleDrive: {
    serviceAccountJson: optional('GOOGLE_SERVICE_ACCOUNT_JSON'),
    templateFileId: optional('GOOGLE_PROMOTION_TEMPLATE_ID'),
    employeesFolderId: optional('GOOGLE_EMPLOYEES_FOLDER_ID'),
  },

  storage: {
    provider: optional('STORAGE_PROVIDER', 'local') as 'local' | 's3' | 'gdrive',
    localBasePath: optional('STORAGE_LOCAL_BASE_PATH', '/var/data/employee-files'),
  },
} as const;

export type Config = typeof config;
