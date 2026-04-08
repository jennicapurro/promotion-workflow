/**
 * document/generator.ts
 *
 * Generates a professionally formatted promotion letter PDF using PDFKit.
 * PDFKit is a pure-Node.js library (no browser/Chrome dependency) making it
 * suitable for headless server environments like Union Station.
 *
 * The letter content comes from the template system (template.ts). The generator
 * is responsible only for layout and rendering — content logic lives in the template.
 *
 * Returns a Buffer containing the complete PDF, ready to pass to DocuSign.
 */

import PDFDocument from 'pdfkit';
import { mergeTemplate, buildMergeFields } from './template';
import { logger } from '../utils/logger';

export interface GenerateLetterParams {
  correlationId: string;
  employeeName: string;
  newTitle: string;
  newSalary: number;
  equityDetails: string;
  effectiveDate: string;
  managerName: string;
}

/**
 * Generates the promotion letter as a PDF Buffer.
 * Throws on any generation failure.
 */
export async function generatePromotionLetter(params: GenerateLetterParams): Promise<Buffer> {
  const log = logger.child({ correlationId: params.correlationId });
  log.info('Generating promotion letter PDF', {
    employeeName: params.employeeName,
    newTitle: params.newTitle,
    effectiveDate: params.effectiveDate,
  });

  // Build merge fields and render template text
  const mergeFields = buildMergeFields({
    employeeName: params.employeeName,
    newTitle: params.newTitle,
    newSalary: params.newSalary,
    equityDetails: params.equityDetails,
    effectiveDate: params.effectiveDate,
    managerName: params.managerName,
  });
  const letterText = mergeTemplate(mergeFields);

  // Generate PDF
  const pdfBuffer = await renderToPdf(letterText, mergeFields);
  log.info('Promotion letter PDF generated', { sizeBytes: pdfBuffer.length });
  return pdfBuffer;
}

// ── PDF rendering ─────────────────────────────────────────────────────────────

async function renderToPdf(
  letterText: string,
  fields: ReturnType<typeof buildMergeFields>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: {
        Title: `Promotion Letter — ${fields.EMPLOYEE_NAME}`,
        Author: fields.COMPANY_NAME,
        Subject: 'Employee Promotion',
        Keywords: 'promotion, HR, compensation',
      },
    });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Company header ────────────────────────────────────────────────────
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .text(fields.COMPANY_NAME, { align: 'left' });

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#555555')
      .text(fields.COMPANY_ADDRESS)
      .fillColor('#000000');

    doc.moveDown(1.5);

    // ── Date ──────────────────────────────────────────────────────────────
    doc.fontSize(11).font('Helvetica').text(fields.LETTER_DATE);
    doc.moveDown(0.5);

    // ── Recipient ─────────────────────────────────────────────────────────
    doc.text(fields.EMPLOYEE_NAME);
    doc.text('[Via DocuSign]');
    doc.moveDown(1);

    // ── Salutation ────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').text(`Dear ${fields.EMPLOYEE_NAME},`);
    doc.moveDown(0.5);
    doc
      .font('Helvetica-Bold')
      .fillColor('#1a1a1a')
      .text(`Subject: Promotion to ${fields.NEW_TITLE}`)
      .fillColor('#000000');
    doc.moveDown(1);

    // ── Body paragraph ────────────────────────────────────────────────────
    doc
      .font('Helvetica')
      .fontSize(11)
      .text(
        `On behalf of ${fields.COMPANY_NAME}, I am pleased to inform you of your promotion to the position of ${fields.NEW_TITLE}, effective ${fields.EFFECTIVE_DATE}.`,
        { align: 'justify' },
      );
    doc.moveDown(0.75);
    doc.text(
      'This promotion reflects our recognition of your outstanding contributions, dedication, and the exceptional work you have delivered. We are confident in your continued growth and the value you bring to our team.',
      { align: 'justify' },
    );

    // ── Compensation section ──────────────────────────────────────────────
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(12).text('COMPENSATION & EQUITY');
    doc
      .moveTo(doc.page.margins.left, doc.y + 4)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y + 4)
      .stroke('#cccccc');
    doc.moveDown(0.75);

    doc.font('Helvetica').fontSize(11);

    // Compensation table (manual layout)
    const labelX = doc.page.margins.left + 10;
    const valueX = labelX + 160;

    doc.font('Helvetica-Bold').text('Base Salary:', labelX, doc.y, { continued: false, width: 160 });
    doc.font('Helvetica').text(`$${fields.NEW_SALARY_FORMATTED} per year`, valueX, doc.y - doc.currentLineHeight(), { lineBreak: false });
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').text('Equity / Grant:', labelX, doc.y, { continued: false, width: 160 });
    doc.font('Helvetica').text(fields.EQUITY_DETAILS, valueX, doc.y - doc.currentLineHeight(), {
      width: doc.page.width - doc.page.margins.right - valueX,
    });
    doc.moveDown(1);

    // ── Terms paragraph ───────────────────────────────────────────────────
    doc
      .font('Helvetica')
      .fontSize(11)
      .text(
        `All other terms and conditions of your employment remain unchanged. Your updated compensation will be reflected in your payroll beginning on or around ${fields.EFFECTIVE_DATE}.`,
        { align: 'justify' },
      );

    // ── Next steps ────────────────────────────────────────────────────────
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(12).text('NEXT STEPS');
    doc
      .moveTo(doc.page.margins.left, doc.y + 4)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y + 4)
      .stroke('#cccccc');
    doc.moveDown(0.75);

    doc
      .font('Helvetica')
      .fontSize(11)
      .text(
        `Please review this letter carefully. By signing below, you acknowledge receipt of this promotion and the compensation details outlined above. Your manager, ${fields.MANAGER_NAME}, will be your primary point of contact for any questions regarding this transition.`,
        { align: 'justify' },
      );
    doc.moveDown(0.75);
    doc.text(
      'We are proud of what you have accomplished and excited about the future ahead. Congratulations on this well-deserved promotion.',
      { align: 'justify' },
    );

    // ── Closing ───────────────────────────────────────────────────────────
    doc.moveDown(1);
    doc.font('Helvetica').text('Sincerely,');
    doc.moveDown(2.5);

    renderSignatureLine(doc, fields.MANAGER_NAME, 'Manager', fields.COMPANY_NAME);
    doc.moveDown(1.5);
    renderSignatureLine(doc, 'Alex Bovee', 'Authorized Signatory', fields.COMPANY_NAME);

    // ── Employee acknowledgement ──────────────────────────────────────────
    doc.moveDown(1.5);
    doc.font('Helvetica-Bold').fontSize(12).text('EMPLOYEE ACKNOWLEDGEMENT');
    doc
      .moveTo(doc.page.margins.left, doc.y + 4)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y + 4)
      .stroke('#cccccc');
    doc.moveDown(0.75);
    doc
      .font('Helvetica')
      .fontSize(11)
      .text(
        `I, ${fields.EMPLOYEE_NAME}, acknowledge receipt of this promotion letter and the compensation details described above.`,
      );
    doc.moveDown(2.5);
    renderSignatureLine(doc, fields.EMPLOYEE_NAME, '', '');
    doc.moveDown(0.5);
    doc.text('Date: ___________________');

    // ── Footer ────────────────────────────────────────────────────────────
    doc
      .fontSize(8)
      .fillColor('#888888')
      .text(`Confidential — ${fields.COMPANY_NAME}`, doc.page.margins.left, doc.page.height - 40, {
        align: 'center',
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      });

    doc.end();
  });
}

function renderSignatureLine(
  doc: PDFKit.PDFDocument,
  name: string,
  role: string,
  company: string,
): void {
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.margins.left + 240, doc.y)
    .stroke('#000000');
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(10).text(name);
  if (role) doc.font('Helvetica').fontSize(10).text(role);
  if (company) doc.fontSize(10).text(company);
}
