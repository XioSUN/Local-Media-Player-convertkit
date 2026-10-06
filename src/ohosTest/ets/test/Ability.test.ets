import { describe, it, expect } from '@ohos/hypium';
import { ExtensionPackageManager } from '../../../../main/ets/service/ExtensionPackageManager';
import { detectDocKind } from '../../../../main/ets/service/DocKind.ets';

export default function abilityTests(): void {
  describe('convertKitOnDevice', () => {
    it('包管理器初始无安装', 0, async () => {
      const mockContext = { filesDir: '/data/local/tmp' } as Context;
      const mgr = new ExtensionPackageManager(mockContext);
      await mgr.load();
      expect(mgr.listInstalled().length).assertEqual(0);
    });

    it('类型探测：PDF 魔数', 0, () => {
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
      expect(detectDocKind(bytes, 'x')).assertEqual('pdf');
    });

    it('类型探测：docx 容器', 0, () => {
      const text = 'PK[Content_Types].xml word/document.xml';
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) { bytes[i] = text.charCodeAt(i); }
      expect(detectDocKind(bytes, 'a.docx')).assertEqual('docx');
    });
  });
}
