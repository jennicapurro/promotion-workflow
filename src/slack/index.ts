/**
 * slack/index.ts
 *
 * Initialises the Slack Bolt App using the ExpressReceiver so that DocuSign
 * webhook callbacks can share the same Express instance.
 */

import { App, ExpressReceiver } from '@slack/bolt';
import { config } from '../config';
import { logger } from '../utils/logger';
import { registerCommands } from './commands';
import { registerModalHandlers } from './modal';

export let slackApp: App;
export let receiver: ExpressReceiver;

export function initSlack(): { app: App; receiver: ExpressReceiver } {
  receiver = new ExpressReceiver({
    signingSecret: config.slack.signingSecret,
    // Disable Bolt's built-in body parsing so Express can parse it first
    // for the DocuSign webhook route (which uses raw body for HMAC).
    processBeforeResponse: true,
  });

  slackApp = new App({
    token: config.slack.botToken,
    receiver,
    logger: {
      debug: (msg) => logger.debug(msg),
      info: (msg) => logger.info(msg),
      warn: (msg) => logger.warn(msg),
      error: (msg) => logger.error(msg),
      setLevel: () => {},
      setName: () => {},
      getLevel: () => 'info' as any,
    },
  });

  registerCommands(slackApp);
  registerModalHandlers(slackApp);

  logger.info('Slack Bolt app initialised');
  return { app: slackApp, receiver };
}
