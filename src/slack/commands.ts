/**
 * slack/commands.ts
 *
 * Registers the /promote slash command.
 *
 * Access control: only Jenni's Slack user ID (JENNI_SLACK_USER_ID) may invoke
 * this command. All other users receive a polite, ephemeral error message.
 *
 * Slack app setup requirement:
 *   Slash Commands → /promote → Request URL: https://<APP_BASE_URL>/slack/events
 */

import { App } from '@slack/bolt';
import { config } from '../config';
import { logger } from '../utils/logger';
import { buildPromotionModal } from './modal';

export function registerCommands(app: App): void {
  app.command('/promote', async ({ command, ack, client, logger: boltLogger }) => {
    // Always acknowledge immediately (Slack requires <3 s response)
    await ack();

    const requestingUserId = command.user_id;
    const log = logger.child({ slackUserId: requestingUserId, command: '/promote' });

    // ── Authorization check ──────────────────────────────────────────────────
    if (requestingUserId !== config.slack.authorizedUserId) {
      log.warn('Unauthorised /promote attempt', { requestingUserId });
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: requestingUserId,
        text:
          'You are not authorized to run the promotion workflow. ' +
          'If you believe this is an error, please contact HR.',
      });
      return;
    }

    log.info('Authorised /promote command received — opening modal');

    // ── Open the promotion modal ─────────────────────────────────────────────
    try {
      await client.views.open({
        trigger_id: command.trigger_id,
        view: buildPromotionModal(),
      });
      log.info('Promotion modal opened successfully');
    } catch (err) {
      log.error('Failed to open promotion modal', { error: err });
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: requestingUserId,
        text: 'Sorry, something went wrong opening the promotion form. Please try again or contact engineering.',
      });
    }
  });
}
