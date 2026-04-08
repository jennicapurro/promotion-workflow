/**
 * config/index.ts
 *
 * Centralised configuration loader. Reads from environment variables (set via
 * Union Station's env var management or a local .env file in development).
 *
 * All required variables are validated at startup — the process exits immediately
 * if any are missing so failures surface clearly at deploy time, not at runtime.
 */

// Load .env only in local development. On Union Station, secrets are injected
// directly as environment variables by the platform — no .env file is present
// or needed in deployed environments.
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

function require(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  app: {
    env: optional('NODE_ENV', 'development'),
    port: parseInt(optional('PORT', '8080'), 10),
    logLevel: optional('LOG_LEVEL', 'info'),
    baseUrl: require('APP_BASE_URL'),
  },

  slack: {
    botToken: require('SLACK_BOT_TOKEN'),
    signingSecret: require('SLACK_SIGNING_SECRET'),
    /** Jenni's Slack user ID — the only authorized initiator */
    authorizedUserId: require('JENNI_SLACK_USER_ID'),
  },

  docusign: {
    integrationKey: require('DOCUSIGN_INTEGRATION_KEY'),
    accountId: require('DOCUSIGN_ACCOUNT_ID'),
    basePath: require('DOCUSIGN_BASE_PATH'),
    oauthBasePath: require('DOCUSIGN_OAUTH_BASE_PATH'),
    impersonationUserId: require('DOCUSIGN_IMPERSONATION_USER_ID'),
    /** Base64-encoded RSA private key for JWT grant */
    privateKeyBase64: require('DOCUSIGN_PRIVATE_KEY_BASE64'),
    /** HMAC key for validating DocuSign Connect webhook signatures */
    webhookHmacKey: optional('DOCUSIGN_WEBHOOK_HMAC_KEY', ''),
  },

  signers: {
    alexBovee: {
      email: require('ALEX_BOVEE_EMAIL'),
      name: require('ALEX_BOVEE_NAME'),
    },
  },

  storage: {
    provider: optional('STORAGE_PROVIDER', 'local') as 'local' | 's3',
    localBasePath: optional('STORAGE_LOCAL_BASE_PATH', '/var/data/employee-files'),
    s3: {
      bucket: optional('S3_BUCKET', ''),
      region: optional('S3_REGION', 'us-east-1'),
      accessKeyId: optional('S3_ACCESS_KEY_ID', ''),
      secretAccessKey: optional('S3_SECRET_ACCESS_KEY', ''),
      keyPrefix: optional('S3_KEY_PREFIX', 'employee-files/'),
    },
  },
} as const;

export type Config = typeof config;
