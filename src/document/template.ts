/**
 * document/template.ts
 *
 * Template management layer.
 *
 * The promotion letter template lives at templates/promotion-letter.txt
 * (relative to the project root). It uses {{PLACEHOLDER}} syntax for merge
 * fields so the mapping is immediately obvious without any DSL knowledge.
 *
 * To update the template: edit templates/promotion-letter.txt. No code changes
 * required — the generator reads it fresh on each invocation.
 *
 * Placeholder reference:
 *   {{COMPANY_NAME}}         — set via COMPANY_NAME env var or defaults to "Our Company"
 *   {{COMPANY_ADDRESS}}      — set via COMPANY_ADDRESS env var
 *   {{LETTER_DATE}}          — auto-generated (current date, long format)
 *   {{EMPLOYEE_NAME}}        — from modal
 *   {{NEW_TITLE}}            — from modal
 *   {{EFFECTIVE_DATE}}       — from modal (formatted)
 *   {{NEW_SALARY_FORMATTED}} — from modal (formatted with commas, e.g. "120,000")
 *   {{EQUITY_DETAILS}}       — from modal
 *   {{MANAGER_NAME}}         — from modal
 */

import fs from 'fs';
import path from 'path';

const TEMPLATE_PATH = path.resolve(__dirname, '../../templates/promotion-letter.txt');

export interface TemplateMergeFields {
  COMPANY_NAME: string;
  COMPANY_ADDRESS: string;
  LETTER_DATE: string;
  EMPLOYEE_NAME: string;
  NEW_TITLE: string;
  EFFECTIVE_DATE: string;
  NEW_SALARY_FORMATTED: string;
  EQUITY_DETAILS: string;
  MANAGER_NAME: string;
}

/**
 * Reads the template file and replaces all {{PLACEHOLDER}} occurrences with
 * the provided values. Throws if the template file cannot be read.
 */
export function mergeTemplate(fields: TemplateMergeFields): string {
  const raw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

  let merged = raw;
  for (const [key, value] of Object.entries(fields) as [keyof TemplateMergeFields, string][]) {
    // Replace all occurrences (a single field can appear multiple times)
    merged = merged.replaceAll(`{{${key}}}`, value);
  }

  // Warn if any unreplaced placeholders remain (catches template typos)
  const remaining = merged.match(/\{\{[A-Z_]+\}\}/g);
  if (remaining) {
    console.warn('Template has unreplaced placeholders:', remaining);
  }

  return merged;
}

/**
 * Builds the merge field map from promotion data.
 * Company-level values come from environment variables with sensible defaults.
 */
export function buildMergeFields(params: {
  employeeName: string;
  newTitle: string;
  newSalary: number;
  equityDetails: string;
  effectiveDate: string;
  managerName: string;
}): TemplateMergeFields {
  const companyName = process.env.COMPANY_NAME ?? 'Our Company';
  const companyAddress = process.env.COMPANY_ADDRESS ?? '123 Main Street, San Francisco, CA 94105';

  return {
    COMPANY_NAME: companyName,
    COMPANY_ADDRESS: companyAddress,
    LETTER_DATE: formatLetterDate(new Date()),
    EMPLOYEE_NAME: params.employeeName,
    NEW_TITLE: params.newTitle,
    EFFECTIVE_DATE: formatEffectiveDate(params.effectiveDate),
    NEW_SALARY_FORMATTED: params.newSalary.toLocaleString('en-US'),
    EQUITY_DETAILS: params.equityDetails,
    MANAGER_NAME: params.managerName,
  };
}

// ── Date formatting ───────────────────────────────────────────────────────────

function formatLetterDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatEffectiveDate(isoDate: string): string {
  // isoDate format from Slack datepicker: "YYYY-MM-DD"
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
