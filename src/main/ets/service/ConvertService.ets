import { picker } from '@kit.CoreFileKit';
import fs from '@ohos.file.fs';
import { zlib } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import { MappedZipSource, type ZipSource, type ZipEntry } from '../core/zip/ZipCodec.ts';
import {
  docxToPdf, pdfToDocx, pdfToXlsx,
  epubToPdf, txtToPdf, pdfToEpub, xlsxToPdf, docxToTxt
} from '../core/Converters.ts';
import { detectDocKind, type DocKind } from './DocKind.ets';
import { inflateZlib } from '../core/pdf/Inflate.ts';
import { hilog } from '@kit.PerformanceAnalysisKit';
import type { PdfInflate } from '../core/pdf/PdfTextExtractor.ts';
import { routeConversion } from '../core/ConvertRoute.ts';
import { errText } from '../core/ErrorText.ts';

const CVT_DOMAIN = 0x0203;
const CVT_TAG = 'LMP-Convert';

/** 转换结果 */
export interface ConvertResult {
  ok: boolean;
  message: string;
  outputBytes?: Uint8Array;
  suggestedName?: string;
}

/** 目标格式（v2 扩展：+epub/txt） */
export type ConvertTarget = 'pdf' | 'docx' | 'xlsx' | 'epub' | 'txt';

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

  /**
   * 把源 URI 落到沙箱真实路径。
   * fs.* 接受 file:// URI，但 zlib.unzipFile 只认真实路径——直接喂 URI 会抛
   * 无 message 的 code:-1（用户看到的“undefined/TypeError”错误即此）。
   */
  private async stageToLocal(uri: string, destPath: string): Promise<void> {
    await fs.mkdir(this.tmpDir, true).catch(() => undefined);
    try {
      await fs.copyFile(uri, destPath);
      return;
    } catch (_) {
      // 个别版本 copyFile 不收 URI → 手工缓冲复制（fs.open/read 认 URI）
      const src = await fs.open(uri, fs.OpenMode.READ_ONLY);
      try {
        const stat = await fs.stat(src.fd);
        const buf = new ArrayBuffer(stat.size);
        await fs.read(src.fd, buf);
        const dst = await fs.open(destPath, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
        try {
          await fs.write(dst.fd, buf);
        } finally {
          await fs.close(dst.fd);
        }
      } finally {
        await fs.close(src.fd);
      }
    }
  }

  /** ZIP 容器文档（docx/xlsx/epub）→ MappedZipSource（解包临时目录） */
  private async openZip(uri: string, label: string): Promise<ZipSource> {
    const stamp = Date.now();
    const srcLocal = `${this.tmpDir}/src_${stamp}`;
    const dest = `${this.tmpDir}/${label}_${stamp}`;
    await fs.mkdir(dest, true).catch(() => undefined);
    await this.stageToLocal(uri, srcLocal);
    hilog.info(CVT_DOMAIN, CVT_TAG, 'unzip %{public}s -> %{public}s', label, dest);
    try {
      await zlib.unzipFile(srcLocal, dest, {});
    } catch (e) {
      throw new Error(`解压 ${label.toUpperCase()} 失败（${errText(e as Object)}），文件可能损坏或格式不受支持`);
    }
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
   * v2 格式矩阵：docx→{pdf,txt} / pdf→{docx,xlsx,epub} / xlsx→{pdf} / epub→{pdf} / txt→{pdf}
   * @param sourceUri 源文件 URI
   * @param sourceName 源文件名
   * @param target 目标格式 'pdf' | 'docx' | 'xlsx' | 'epub' | 'txt'
   */
  async convert(sourceUri: string, sourceName: string, target: ConvertTarget): Promise<ConvertResult> {
    try {
      const head = await this.readHead(sourceUri);
      const kind = detectDocKind(head, sourceName);
      let output: Uint8Array;
      const baseName = sourceName.replace(/\.[^.]+$/, '');

      const route = routeConversion(kind, target);
      switch (route) {
        case 'docxToPdf':
          output = docxToPdf(await this.openZip(sourceUri, 'docx'));
          break;
        case 'docxToTxt':
          output = docxToTxt(await this.openZip(sourceUri, 'docx'));
          break;
        case 'pdfToDocx':
          output = pdfToDocx(await this.readAll(sourceUri), this.inflateAdapter);
          break;
        case 'pdfToXlsx':
          output = pdfToXlsx(await this.readAll(sourceUri), this.inflateAdapter);
          break;
        case 'pdfToEpub':
          output = pdfToEpub(await this.readAll(sourceUri), this.inflateAdapter);
          break;
        case 'xlsxToPdf':
          output = xlsxToPdf(await this.openZip(sourceUri, 'xlsx'));
          break;
        case 'epubToPdf':
          output = epubToPdf(await this.openZip(sourceUri, 'epub'));
          break;
        case 'txtToPdf':
          output = txtToPdf(await this.readAll(sourceUri));
          break;
        default:
          return { ok: false, message: `不支持 ${this.kindLabel(kind)} → ${target.toUpperCase()}（docx→PDF/TXT、pdf→Word/Excel/EPUB、xlsx→PDF、epub→PDF、txt→PDF）` };
      }

      return {
        ok: true,
        message: `转换成功（${(output.length / 1024).toFixed(1)} KB）`,
        outputBytes: output,
        suggestedName: `${baseName}.${target}`
      };
    } catch (e) {
      const msg = errText(e as Object);
      const stack = (e as Record<string, string>)['stack'] ?? '';
      hilog.error(CVT_DOMAIN, CVT_TAG, 'convert failed: %{public}s | %{public}s', msg, stack);
      return { ok: false, message: `转换失败：${msg}` };
    }
  }

  /** 供 UI 选档后嗅探源类型（决定目标格式矩阵） */
  async sniffKind(sourceUri: string, sourceName: string): Promise<DocKind> {
    try {
      const head = await this.readHead(sourceUri);
      return detectDocKind(head, sourceName);
    } catch (_) {
      return 'unsupported';
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

  /** 递归删除（该 SDK 的 fs 无 rm/recursive，walk + unlink + rmdir） */
  private async rmtree(p: string): Promise<void> {
    const stat = await fs.stat(p).catch(() => undefined);
    if (stat === undefined) {
      return;
    }
    if (stat.isDirectory()) {
      const names = await fs.listFile(p).catch(() => [] as string[]);
      for (const n of names) {
        await this.rmtree(`${p}/${n}`);
      }
      await fs.rmdir(p).catch(() => undefined);
    } else {
      await fs.unlink(p).catch(() => undefined);
    }
  }

  async cleanup(): Promise<void> {
    await this.rmtree(this.tmpDir);
  }
}
