/**
 * ConvertRoute — 转换路由矩阵（bug 看护，见 docs/TEST-GUARDS.md #4、#7）。
 * 历史根因：支持矩阵散落在 service 分支与 RegistryCore.BUILTIN_CONVERTERS 两处，
 * 手工同步会漂移。本表为唯一权威：routeConversion 是唯一路由出口，
 * 与 BUILTIN_CONVERTERS 的一致性由测试钉死。
 */
import { type DocKind } from './DocKind.ts';

export type ConvertRoute =
  | 'docxToPdf' | 'docxToTxt'
  | 'pdfToDocx' | 'pdfToXlsx' | 'pdfToEpub'
  | 'xlsxToPdf'
  | 'epubToPdf'
  | 'txtToPdf';

export function routeConversion(kind: DocKind, target: string): ConvertRoute | null {
  if (kind === 'docx' && target === 'pdf') { return 'docxToPdf'; }
  if (kind === 'docx' && target === 'txt') { return 'docxToTxt'; }
  if (kind === 'pdf' && target === 'docx') { return 'pdfToDocx'; }
  if (kind === 'pdf' && target === 'xlsx') { return 'pdfToXlsx'; }
  if (kind === 'pdf' && target === 'epub') { return 'pdfToEpub'; }
  if (kind === 'xlsx' && target === 'pdf') { return 'xlsxToPdf'; }
  if (kind === 'epub' && target === 'pdf') { return 'epubToPdf'; }
  if (kind === 'txt' && target === 'pdf') { return 'txtToPdf'; }
  return null;
}
