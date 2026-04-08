/**
 * slack/modal.ts
 *
 * Defines the Slack Block Kit modal for collecting promotion details and
 * handles the view_submission callback.
 *
 * Fields collected:
 *   employee_name, employee_email, manager_name, manager_email,
 *   new_title, new_salary, equity_details, effective_date, notes,
 *   employee_folder_path (optional)
 *
 * Validation is done in view_submission — Slack will display inline errors
 * returned from the callback without closing the modal.
 */

import { App, ViewSubmitAction, BlockAction } from '@slack/bolt';
import { generateCorrelationId } from '../utils/correlation';
import { claimKey, updateKey } from '../utils/idempotency';
import { logger, childLogger } from '../utils/logger';
import { PromotionService } from '../services/promotionService';
import { PromotionData } from '../services/promotionService';

export const MODAL_CALLBACK_ID = 'promotion_modal';

// ── Modal definition ──────────────────────────────────────────────────────────

export function buildPromotionModal() {
  return {
    type: 'modal' as const,
    callback_id: MODAL_CALLBACK_ID,
    title: { type: 'plain_text' as const, text: 'Promotion Workflow' },
    submit: { type: 'plain_text' as const, text: 'Submit for DocuSign' },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      // ── Section header ───────────────────────────────────────────────────
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*New Employee Promotion*\nAll fields marked with * are required. This will generate a promotion letter and route it through DocuSign for signatures.',
        },
      },
      { type: 'divider' },

      // ── Employee info ────────────────────────────────────────────────────
      {
        type: 'input',
        block_id: 'employee_name_block',
        label: { type: 'plain_text', text: 'Employee Full Name *' },
        element: {
          type: 'plain_text_input',
          action_id: 'employee_name',
          placeholder: { type: 'plain_text', text: 'e.g. Jane Smith' },
        },
      },
      {
        type: 'input',
        block_id: 'employee_email_block',
        label: { type: 'plain_text', text: 'Employee Email *' },
        element: {
          type: 'plain_text_input',
          action_id: 'employee_email',
          placeholder: { type: 'plain_text', text: 'jane.smith@company.com' },
        },
      },

      // ── Manager info ─────────────────────────────────────────────────────
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'manager_name_block',
        label: { type: 'plain_text', text: 'Manager Full Name *' },
        element: {
          type: 'plain_text_input',
          action_id: 'manager_name',
          placeholder: { type: 'plain_text', text: 'e.g. John Doe' },
        },
      },
      {
        type: 'input',
        block_id: 'manager_email_block',
        label: { type: 'plain_text', text: 'Manager Email *' },
        element: {
          type: 'plain_text_input',
          action_id: 'manager_email',
          placeholder: { type: 'plain_text', text: 'john.doe@company.com' },
        },
      },

      // ── Promotion details ────────────────────────────────────────────────
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'new_title_block',
        label: { type: 'plain_text', text: 'New Title *' },
        element: {
          type: 'plain_text_input',
          action_id: 'new_title',
          placeholder: { type: 'plain_text', text: 'e.g. Senior Software Engineer' },
        },
      },
      {
        type: 'input',
        block_id: 'new_salary_block',
        label: { type: 'plain_text', text: 'New Base Salary (USD) *' },
        hint: { type: 'plain_text', text: 'Enter numeric amount only, e.g. 120000' },
        element: {
          type: 'plain_text_input',
          action_id: 'new_salary',
          placeholder: { type: 'plain_text', text: '120000' },
        },
      },
      {
        type: 'input',
        block_id: 'equity_details_block',
        label: { type: 'plain_text', text: 'Equity / Grant Details *' },
        hint: { type: 'plain_text', text: 'Include number of units, type (RSU/options), and vesting schedule' },
        element: {
          type: 'plain_text_input',
          action_id: 'equity_details',
          multiline: true,
          placeholder: { type: 'plain_text', text: '10,000 RSUs vesting over 4 years with a 1-year cliff' },
        },
      },
      {
        type: 'input',
        block_id: 'effective_date_block',
        label: { type: 'plain_text', text: 'Effective Date *' },
        element: {
          type: 'datepicker',
          action_id: 'effective_date',
          placeholder: { type: 'plain_text', text: 'Select date' },
        },
      },

      // ── Optional fields ──────────────────────────────────────────────────
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'notes_block',
        optional: true,
        label: { type: 'plain_text', text: 'Additional Notes' },
        hint: { type: 'plain_text', text: 'Any context for HR records (not included in the letter)' },
        element: {
          type: 'plain_text_input',
          action_id: 'notes',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Optional: any additional context...' },
        },
      },
      {
        type: 'input',
        block_id: 'employee_folder_path_block',
        optional: true,
        label: { type: 'plain_text', text: 'Employee Folder Path' },
        hint: { type: 'plain_text', text: 'Override the default folder location for this employee\'s documents' },
        element: {
          type: 'plain_text_input',
          action_id: 'employee_folder_path',
          placeholder: { type: 'plain_text', text: 'employees/jane-smith or leave blank to use default' },
        },
      },
    ],
  };
}

// ── Modal submission handler ──────────────────────────────────────────────────

export function registerModalHandlers(app: App): void {
  app.view(MODAL_CALLBACK_ID, async ({ ack, view, body, client }) => {
    const values = view.state.values;
    const correlationId = generateCorrelationId();
    const log = childLogger(correlationId);

    // ── Extract field values ─────────────────────────────────────────────
    const employeeName = values.employee_name_block?.employee_name?.value ?? '';
    const employeeEmail = values.employee_email_block?.employee_email?.value ?? '';
    const managerName = values.manager_name_block?.manager_name?.value ?? '';
    const managerEmail = values.manager_email_block?.manager_email?.value ?? '';
    const newTitle = values.new_title_block?.new_title?.value ?? '';
    const newSalaryRaw = values.new_salary_block?.new_salary?.value ?? '';
    const equityDetails = values.equity_details_block?.equity_details?.value ?? '';
    const effectiveDate = values.effective_date_block?.effective_date?.selected_date ?? '';
    const notes = values.notes_block?.notes?.value ?? undefined;
    const employeeFolderPath = values.employee_folder_path_block?.employee_folder_path?.value ?? undefined;

    // ── Validate ─────────────────────────────────────────────────────────
    const errors: Record<string, string> = {};

    if (!employeeName.trim()) errors.employee_name_block = 'Employee name is required.';
    if (!isValidEmail(employeeEmail)) errors.employee_email_block = 'Please enter a valid email address.';
    if (!managerName.trim()) errors.manager_name_block = 'Manager name is required.';
    if (!isValidEmail(managerEmail)) errors.manager_email_block = 'Please enter a valid email address.';
    if (!newTitle.trim()) errors.new_title_block = 'New title is required.';
    if (!isValidSalary(newSalaryRaw)) errors.new_salary_block = 'Please enter a valid numeric salary (e.g. 120000).';
    if (!equityDetails.trim()) errors.equity_details_block = 'Equity/grant details are required.';
    if (!effectiveDate) errors.effective_date_block = 'Effective date is required.';

    if (Object.keys(errors).length > 0) {
      await ack({ response_action: 'errors', errors });
      return;
    }

    // ── Idempotency guard ────────────────────────────────────────────────
    const idempotencyKey = view.id; // unique per modal open event
    if (!claimKey(idempotencyKey, correlationId)) {
      await ack({ response_action: 'clear' });
      return;
    }

    // Acknowledge immediately so Slack closes the modal
    await ack();

    const newSalary = parseInt(newSalaryRaw.replace(/[^0-9]/g, ''), 10);
    const submittingUserId = body.user.id;

    log.info('Promotion modal submitted', {
      employeeName,
      newTitle,
      effectiveDate,
      submittingUserId,
    });

    const promotionData: PromotionData = {
      correlationId,
      idempotencyKey,
      employeeName,
      employeeEmail,
      managerName,
      managerEmail,
      newTitle,
      newSalary,
      equityDetails,
      effectiveDate,
      notes,
      employeeFolderPath,
      submittedBy: submittingUserId,
      submittedAt: new Date().toISOString(),
    };

    // ── Kick off async orchestration ─────────────────────────────────────
    // Fire-and-forget: errors are surfaced to Jenni via Slack DM inside the service.
    PromotionService.orchestrate(promotionData, client).catch((err) => {
      log.error('Unhandled error in promotion orchestration', { error: err });
      updateKey(idempotencyKey, { status: 'failed' });
    });
  });
}

// ── Validation helpers ────────────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidSalary(value: string): boolean {
  const numeric = value.replace(/[^0-9]/g, '');
  return numeric.length > 0 && parseInt(numeric, 10) > 0;
}
