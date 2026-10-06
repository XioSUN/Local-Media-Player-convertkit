import { picker } from '@kit.CoreFileKit';
import fs from '@ohos.file.fs';
import { zlib } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import { MappedZipSource, type ZipSource, type ZipEntry } from '../core/zip/ZipCodec.ts';
import { docxToPdf, pdfToDocx, pdfToXlsx } from '../core/Converters.ts';
import { detectDocKind, type DocKind } from './DocKind.ets';
import { inflateZlib } from '../core/pdf/Inflate.ts';
import type { PdfInflate } from '../core/pdf/PdfTextExtractor.ts';

/** 转换结果 */
export interface ConvertResult {
  ok: boolean;
  message: string;
  outputBytes?: Uint8Array;
  suggestedName?: string;
}

/**
 * ConvertService — 设备侧转换服务。
 *
 * 平台适配：
 *  - DOCX 读取：zlib.UnzipFile 解包到临时目录 → MappedZipSource
 *  - PDF FlateDecode：zlib.decompress（RFC1950 zlib 流）
 *  - 输出保存：DocumentViewPicker.save（免权限）
 */
export class ConvertService {
  private context: common.Context;
  private tmpDir: string;

  constructor(context: common.Context) {
    this.context = context;
    this.tmpDir = `${context.filesDir}/convert_tmp`;
  }

  /**
   * FlateDecode（zlib 流）解压：设备端 @ohos.zlib 无内存解压 API，
   * 使用核心层纯 TS 实现（Node 测试与 node:zlib 交叉验证过）。
   */
  private inflateAdapter: PdfInflate = (data: Uint8Array): Uint8Array => inflateZlib(data);

  /** DOCX → MappedZipSource（解包临时目录） */
  private async openDocx(uri: string): Promise<ZipSource> {
    const dest = `${this.tmpDir}/docx_${Date.now()}`;
    await fs.mkdir(dest, true).catch(() => undefined);
    await zlib.unzipFile(uri, dest, { level: 1 });
    const entries: ZipEntry[] = [];
    await this.collectDir(dest, '', entries);
    return new MappedZipSource(entries);
  }

  private async collectDir(dir: string, prefix: string, out: ZipEntry[]): Promise<void> {
    const names = await fs.listFile(dir);
    for (const n of names) {
      const full = `${dir}/${n}`;
      const rel = prefix.length > 0 ? `${prefix}/${n}` : n;
      const stat = await fs.stat(full);
      if (stat.isDirectory()) {
        await this.collectDir(full, rel, out);
      } else {
        const file = await fs.open(full, fs.OpenMode.READ_ONLY);
        try {
          const buf = new ArrayBuffer(stat.size);
          await fs.read(file.fd, buf);
          out.push({ name: rel, data: new Uint8Array(buf) });
        } finally {
          await fs.close(file.fd);
        }
      }
    }
  }

  private async readAll(uri: string): Promise<Uint8Array> {
    const file = await fs.open(uri, fs.OpenMode.READ_ONLY);
    try {
      const stat = await fs.stat(file.fd);
      const buf = new ArrayBuffer(stat.size);
      await fs.read(file.fd, buf);
      return new Uint8Array(buf);
    } finally {
      await fs.close(file.fd);
    }
  }

  /**
   * 执行转换（根据源类型自动路由）。
   * @param sourceUri 源文件 URI
   * @param sourceName 源文件名
   * @param target 目标格式 'pdf' | 'docx' | 'xlsx'
   */
  async convert(sourceUri: string, sourceName: string, target: 'pdf' | 'docx' | 'xlsx'): Promise<ConvertResult> {
    try {
      const head = await this.readHead(sourceUri);
      const kind = detectDocKind(head, sourceName);
      let output: Uint8Array;
      const baseName = sourceName.replace(/\.[^.]+$/, '');

      if (kind === 'docx' && target === 'pdf') {
        const source = await this.openDocx(sourceUri);
        output = docxToPdf(source);
      } else if (kind === 'pdf' && target === 'docx') {
        const bytes = await this.readAll(sourceUri);
        output = pdfToDocx(bytes, this.inflateAdapter);
      } else if (kind === 'pdf' && target === 'xlsx') {
        const bytes = await this.readAll(sourceUri);
        output = pdfToXlsx(bytes, this.inflateAdapter);
      } else {
        return { ok: false, message: `不支持 ${this.kindLabel(kind)} → ${target.toUpperCase()}（可用：docx→pdf / pdf→docx / pdf→xlsx）` };
      }

      return {
        ok: true,
        message: `转换成功（${(output.length / 1024).toFixed(1)} KB）`,
        outputBytes: output,
        suggestedName: `${baseName}.${target}`
      };
    } catch (e) {
      return { ok: false, message: `转换失败: ${(e as Error).message}` };
    }
  }

  private async readHead(uri: string): Promise<Uint8Array> {
    const file = await fs.open(uri, fs.OpenMode.READ_ONLY);
    try {
      const buf = new ArrayBuffer(1024);
      await fs.read(file.fd, buf);
      return new Uint8Array(buf);
    } finally {
      await fs.close(file.fd);
    }
  }

  private kindLabel(kind: DocKind): string {
    return kind.toUpperCase();
  }

  /** 通过系统保存面板写出结果 */
  async saveResult(result: ConvertResult): Promise<string> {
    if (!result.outputBytes || !result.suggestedName) {
      return '无可保存的输出';
    }
    const savePicker = new picker.DocumentViewPicker();
    const opts = new picker.DocumentSaveOptions();
    opts.newFileNames = [result.suggestedName];
    const uris = await savePicker.save(opts);
    if (!uris || uris.length === 0) {
      return '已取消保存';
    }
    const file = await fs.open(uris[0], fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    try {
      await fs.write(file.fd, result.outputBytes.buffer as ArrayBuffer);
    } finally {
      await fs.close(file.fd);
    }
    return `已保存: ${uris[0]}`;
  }

  async cleanup(): Promise<void> {
    await fs.rmdir(this.tmpDir).catch(() => undefined);
  }
}
