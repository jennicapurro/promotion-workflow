# Promotion Workflow

Internal Slack automation for initiating, routing, and completing employee promotion letters via DocuSign.

---

## How It Works

1. Jenni runs `/promote` in Slack
2. A modal collects promotion details (employee, manager, title, salary, equity, date)
3. A professional promotion letter PDF is generated from a template
4. The letter is uploaded to DocuSign and routed:
   - **Signer 1:** Manager (provided in the form)
   - **Signer 2:** Alex Bovee
5. When fully signed, the signed PDF is saved to the employee's folder
6. Jenni receives a Slack DM at each key step (sent + completed)

---

## Architecture

```
Slack /promote
    │
    ▼
Auth check (Jenni only)
    │
    ▼
Modal (9 fields)
    │
    ▼
PromotionService.orchestrate()
    ├─ generatePromotionLetter()   → PDF via PDFKit
    ├─ createPromotionEnvelope()   → DocuSign (JWT auth)
    ├─ registerEnvelope()          → tracks envelope→job mapping
    └─ notifyEnvelopeSent()        → Jenni Slack DM

DocuSign webhook POST /docusign/webhook
    ├─ HMAC validation
    ├─ downloadSignedDocument()    → signed PDF from DocuSign
    ├─ storage.saveDocument()      → employee folder
    └─ notifyCompletion()          → Jenni Slack DM
```

---

## Project Structure

```
promotion-workflow/
├── src/
│   ├── app.ts                      # Entry point, Express + Slack Bolt bootstrap
│   ├── config/index.ts             # Env var validation and typed config
│   ├── middleware/logging.ts       # HTTP request logger
│   ├── utils/
│   │   ├── logger.ts               # Winston structured logger
│   │   ├── correlation.ts          # Correlation ID generator
│   │   └── idempotency.ts          # Duplicate-submission guard
│   ├── slack/
│   │   ├── index.ts                # Bolt app init with ExpressReceiver
│   │   ├── commands.ts             # /promote slash command handler + auth check
│   │   ├── modal.ts                # Modal definition + submission handler
│   │   └── notifications.ts       # All outbound DMs to Jenni
│   ├── document/
│   │   ├── template.ts             # Template loading and merge-field mapping
│   │   └── generator.ts            # PDFKit PDF renderer
│   ├── docusign/
│   │   ├── client.ts               # JWT auth client with token caching
│   │   ├── envelope.ts             # Envelope creation + document download
│   │   └── webhook.ts              # DocuSign Connect callback handler
│   ├── storage/
│   │   ├── interface.ts            # StorageService interface
│   │   ├── local.ts                # Local filesystem adapter
│   │   ├── s3.ts                   # S3 adapter stub (ready to activate)
│   │   └── index.ts                # Factory: picks adapter from config
│   └── services/
│       └── promotionService.ts     # Main orchestration service
├── templates/
│   └── promotion-letter.txt        # Promotion letter template with {{PLACEHOLDERS}}
├── .env.example                    # All required environment variables
├── union-station.yaml              # Union Station deployment config
├── package.json
├── tsconfig.json
└── README.md
```

---

## Initial Setup

### 1. Slack App

Create a new Slack App at [api.slack.com/apps](https://api.slack.com/apps):

**OAuth & Permissions → Bot Token Scopes:**
- `commands` — to receive slash command events
- `chat:write` — to send DMs to Jenni

**Slash Commands:**
- Command: `/promote`
- Request URL: `https://<APP_BASE_URL>/slack/events`
- Description: `Initiate an employee promotion workflow`

**Event Subscriptions:**
- Request URL: `https://<APP_BASE_URL>/slack/events`
- Subscribe to bot events: `view_submission` (handled automatically by Bolt)

**Install the app** to your workspace and copy the Bot Token + Signing Secret.

**Find Jenni's Slack User ID:**
- In Slack, click Jenni's profile → three-dot menu → "Copy Member ID"
- Set this as `JENNI_SLACK_USER_ID`

---

### 2. DocuSign

In DocuSign Admin:

1. **Apps & Keys → Add App:**
   - App type: Integration
   - Note the **Integration Key** (client ID)

2. **Apps & Keys → RSA Key Pairs:**
   - Generate a key pair
   - Download the private key
   - Encode it: `base64 -i private_key.pem | tr -d '\n'`
   - Set as `DOCUSIGN_PRIVATE_KEY_BASE64`

3. **Grant consent (one-time):**
   Visit this URL once (replace values):
   ```
   https://<DOCUSIGN_OAUTH_BASE_PATH>/oauth/auth
     ?response_type=code
     &scope=signature%20impersonation
     &client_id=<DOCUSIGN_INTEGRATION_KEY>
     &redirect_uri=https://localhost
   ```
   Sign in as the sending user and click Allow.

4. **Connect (webhook):**
   - Integrations → Connect → Add Configuration
   - URL: `https://<APP_BASE_URL>/docusign/webhook`
   - Trigger: Envelope Completed, Envelope Declined, Envelope Voided
   - Data Format: JSON
   - Include Documents: Yes
   - HMAC Signing Key: generate one and set as `DOCUSIGN_WEBHOOK_HMAC_KEY`

---

### 3. Environment Variables

Copy `.env.example` to `.env` and fill in all values. On Union Station, enter these in the service's secret management UI instead.

Required variables (see `.env.example` for full list and descriptions):

| Variable | Description |
|---|---|
| `APP_BASE_URL` | Public HTTPS URL of this service |
| `SLACK_BOT_TOKEN` | `xoxb-...` bot token |
| `SLACK_SIGNING_SECRET` | Slack signing secret |
| `JENNI_SLACK_USER_ID` | Jenni's Slack member ID (`U...`) |
| `DOCUSIGN_INTEGRATION_KEY` | DocuSign app client ID |
| `DOCUSIGN_ACCOUNT_ID` | DocuSign account ID |
| `DOCUSIGN_BASE_PATH` | DocuSign API base URL |
| `DOCUSIGN_OAUTH_BASE_PATH` | DocuSign OAuth host |
| `DOCUSIGN_IMPERSONATION_USER_ID` | DocuSign user GUID |
| `DOCUSIGN_PRIVATE_KEY_BASE64` | Base64-encoded RSA private key |
| `DOCUSIGN_WEBHOOK_HMAC_KEY` | HMAC key for webhook validation |
| `ALEX_BOVEE_EMAIL` | Alex's email (always signer 2) |
| `ALEX_BOVEE_NAME` | Alex's display name |
| `STORAGE_PROVIDER` | `local` or `s3` |
| `STORAGE_LOCAL_BASE_PATH` | Root folder for local storage |

Optional:
- `COMPANY_NAME` — used in the letter header (default: "Our Company")
- `COMPANY_ADDRESS` — used in the letter header

---

## Local Development

```bash
# Install dependencies
npm install

# Copy and fill env vars
cp .env.example .env
# edit .env with real values

# Expose localhost to the internet (needed for Slack + DocuSign callbacks)
npx localtunnel --port 3000 --subdomain promotion-workflow
# or: ngrok http 3000

# Set APP_BASE_URL in .env to the tunnel URL

# Start in dev mode (auto-restarts on changes)
npm run dev
```

**Testing the flow locally:**

1. Run `/promote` in Slack
2. Fill out the modal and submit
3. Watch logs for each step
4. For the DocuSign webhook, either:
   - Wait for a real signature in DocuSign Demo, or
   - Use `curl` to POST a simulated webhook payload to `http://localhost:3000/docusign/webhook`

**Simulating a webhook:**
```bash
curl -X POST http://localhost:3000/docusign/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "envelopeId": "<envelope-id-from-logs>",
      "envelopeSummary": { "status": "completed" }
    }
  }'
```
(Webhook HMAC validation is skipped when `DOCUSIGN_WEBHOOK_HMAC_KEY` is not set.)

---

## Staging

1. Deploy to Union Station with `NODE_ENV=staging`
2. Use DocuSign Demo (`account-d.docusign.com` + `demo.docusign.net`)
3. Use a test Slack workspace or a private channel
4. Run a full end-to-end test: `/promote` → modal → PDF → DocuSign → completion

---

## Production Deployment on Union Station

```bash
# Build
npm run build

# Deploy via Union Station CLI (adjust to your platform's actual CLI)
union-station deploy --service promotion-workflow --config union-station.yaml

# Verify health
curl https://<APP_BASE_URL>/health
```

Confirm in Union Station that all secrets are populated before deploying.

---

## Template Customisation

Edit `templates/promotion-letter.txt` to modify the letter content.

Placeholder syntax: `{{PLACEHOLDER_NAME}}`

| Placeholder | Source |
|---|---|
| `{{COMPANY_NAME}}` | `COMPANY_NAME` env var |
| `{{COMPANY_ADDRESS}}` | `COMPANY_ADDRESS` env var |
| `{{LETTER_DATE}}` | Auto (current date) |
| `{{EMPLOYEE_NAME}}` | Modal input |
| `{{NEW_TITLE}}` | Modal input |
| `{{EFFECTIVE_DATE}}` | Modal input (formatted) |
| `{{NEW_SALARY_FORMATTED}}` | Modal input (formatted with commas) |
| `{{EQUITY_DETAILS}}` | Modal input |
| `{{MANAGER_NAME}}` | Modal input |

The PDF renderer in `src/document/generator.ts` reads the merged text and lays it out with professional formatting. If you add new placeholders to the template, also add them to the `TemplateMergeFields` interface in `src/document/template.ts` and the `buildMergeFields()` function.

---

## Monitoring and Failure Handling

**Structured logs** — every log line includes:
- `correlationId` (format: `promo-<uuid>`) — trace an entire job
- `service: promotion-workflow`
- Step descriptions at each stage

**To trace a specific job:**
```bash
grep "promo-abc123" /var/log/promotion-workflow.log
```

**Failures at each stage:**
| Stage | What Jenni sees |
|---|---|
| PDF generation | Slack DM with error message |
| DocuSign envelope creation | Slack DM with error message |
| Signing declined/voided | Slack DM notification |
| Document download failure | Slack DM, completion notification still sent |
| Storage save failure | Slack DM with error; completion notification still sent |

**If an envelope is "stuck" (no completion webhook):**
1. Check DocuSign Admin → Envelopes for the envelope ID (visible in logs)
2. Check that the DocuSign Connect webhook is enabled and pointed at the right URL
3. You can resend a webhook from DocuSign Admin → Integrations → Connect → logs

**Idempotency:**
- Each modal submission is assigned a unique `view.id` as its idempotency key
- Duplicate submissions within 24 hours are silently dropped
- This is in-memory only — restarts clear the state. Multi-replica deployments need Redis.

---

## Future Enhancements

- **Status dashboard** — simple `/admin` HTML page showing all pending envelopes and their states
- **Finance/HRBP approval step** — add an approval modal before DocuSign routing
- **Resend reminder** — `node-cron` job that checks for envelopes stuck in "sent" state > N days and sends Jenni a summary
- **Pending envelopes view** — Jenni can type `/promote-status` to see all open envelopes
- **S3 storage** — activate `src/storage/s3.ts` (see instructions in that file)
- **Multi-replica idempotency** — swap `src/utils/idempotency.ts` for a Redis-backed store
