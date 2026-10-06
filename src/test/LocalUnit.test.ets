import { describe, it, expect } from '@ohos/hypium';
import { ZipWriter, MemoryZipSource } from '../main/ets/core/zip/ZipCodec.ts';
import { parseDocxXml } from '../main/ets/core/ooxml/DocxParser.ts';
import { DocxWriter } from '../main/ets/core/ooxml/DocxWriter.ts';
import { PdfWriter } from '../main/ets/core/pdf/PdfWriter.ts';
import { sha256Hex } from '../main/ets/core/extpack/Hash.ts';
import { compareVersions, validateManifest } from '../main/ets/core/extpack/ExtensionManifest.ts';

export default function localUnitTests(): void {
  describe('convertKitCore', () => {
    it('ZIP 写读 round-trip', 0, () => {
      const zip = new ZipWriter();
      zip.addText('a.txt', '内容A');
      const src = MemoryZipSource.from(zip.finish());
      expect(src.readText('a.txt')).assertEqual('内容A');
    });

    it('DOCX 写读 round-trip', 0, () => {
      const docx = new DocxWriter({
        paragraphs: [{ style: 'normal', runs: [{ text: '测试段落' }] }]
      });
      const src = MemoryZipSource.from(docx.build());
      const doc = parseDocxXml(src.readText('word/document.xml') ?? '');
      expect(doc.paragraphs.length).assertEqual(1);
      expect(doc.paragraphs[0].runs[0].text).assertEqual('测试段落');
    });

    it('PDF 头与 EOF', 0, () => {
      const pdf = new PdfWriter();
      pdf.addParagraph('Hello');
      const bytes = pdf.build();
      const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      expect(head).assertEqual('%PDF');
    });

    it('SHA-256 向量', 0, () => {
      expect(sha256Hex('abc')).assertEqual('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('版本比较', 0, () => {
      expect(compareVersions('1.2.0', '1.1.9')).assertEqual(1);
      expect(compareVersions('1.0.0', '1.0.0')).assertEqual(0);
    });

    it('清单校验', 0, () => {
      const errors = validateManifest({
        schemaVersion: 1, id: 'pack-demo', name: 'Demo', version: '1.0.0',
        kind: 'visual-preset', minAppVersion: '1.0.0', description: 'demo'
      });
      expect(errors.length).assertEqual(0);
    });
  });
}
