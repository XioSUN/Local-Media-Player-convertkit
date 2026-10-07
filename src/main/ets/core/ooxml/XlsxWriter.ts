/**
 * XlsxWriter — 工作簿模型 → 最小合法 XLSX（纯逻辑，STORE ZIP，inlineStr 单元格）
 *
 * 产出文件：[Content_Types].xml / _rels/.rels / xl/workbook.xml /
 * xl/_rels/workbook.xml.rels / xl/styles.xml / xl/worksheets/sheetN.xml
 */

import { ZipWriter } from '../zip/ZipCodec.ts';

export type CellValue = string | number | null;

export interface Worksheet {
  name: string;
  rows: CellValue[][];
}

export interface Workbook {
  sheets: Worksheet[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 0 → A, 25 → Z, 26 → AA（Excel 列字母） */
export function colLetter(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

const CONTENT_TYPES = (sheetCount: number): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${Array.from({ length: sheetCount }, (_, i) =>
  `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
).join('\n')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

function workbookXml(sheets: Worksheet[]): string {
  const items = sheets
    .map((s, i) => `<sheet name="${esc(s.name.length > 0 ? s.name : `Sheet${i + 1}`)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${items}</sheets>
</workbook>`;
}

function workbookRels(sheetCount: number): string {
  const rels = Array.from({ length: sheetCount }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join('');
  const stylesRel = `<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}${stylesRel}</Relationships>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`;

function sheetXml(rows: CellValue[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          if (value === null || value === undefined || value === '') {
            return '';
          }
          const ref = `${colLetter(c)}${r + 1}`;
          if (typeof value === 'number' && Number.isFinite(value)) {
            return `<c r="${ref}"><v>${value}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${body}</sheetData>
</worksheet>`;
}

export class XlsxWriter {
  private wb: Workbook;

  constructor(wb: Workbook) {
    if (!wb.sheets || wb.sheets.length === 0) {
      throw new Error('XlsxWriter: 至少需要一个工作表');
    }
    this.wb = wb;
  }

  build(): Uint8Array {
    const zip = new ZipWriter();
    const n = this.wb.sheets.length;
    zip.addText('[Content_Types].xml', CONTENT_TYPES(n));
    zip.addText('_rels/.rels', ROOT_RELS);
    zip.addText('xl/workbook.xml', workbookXml(this.wb.sheets));
    zip.addText('xl/_rels/workbook.xml.rels', workbookRels(n));
    zip.addText('xl/styles.xml', STYLES_XML);
    this.wb.sheets.forEach((sheet, i) => {
      zip.addText(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet.rows));
    });
    return zip.finish();
  }
}
