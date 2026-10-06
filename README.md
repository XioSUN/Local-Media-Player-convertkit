# hmos-convert-kit — HMOS 文档转换与在线扩展包框架（HAR）

应用内文档转换引擎 + 可下载扩展功能包（Word→PDF / PDF→Word / PDF→Excel 解锁）。

## 功能

### 转换引擎（纯 TS，全链路自研零依赖）

| converterId | 流水线 |
|---|---|
| `docx-to-pdf` | ZIP → `word/document.xml` → DocxParser（段落/样式/run）→ PdfWriter（换行/分页/标题/列表） |
| `pdf-to-docx` | PdfTextExtractor（Tj/TJ/Td/Tm，FlateDecode 经注入 inflate）→ 行聚类/字号标题推断 → DocxWriter |
| `pdf-to-xlsx` | PdfTextExtractor → y 聚类 + 列切分（tab/多空格）+ 数字转型 → XlsxWriter |

底层编解码：

- `zip/ZipCodec.ts`：STORE ZIP 写入器（合法 DOCX/XLSX 容器）+ 内存解析器（STORE 直读、DEFLATE 经注入 raw-inflate）；
- `pdf/PdfWriter.ts`：最小合法 PDF 1.4——纯 ASCII 走 Helvetica（WinAnsi），含非 ASCII 自动切换 STSong-Light/UniGB-UCS2-H（UTF-16BE hex，不内嵌字体，依赖查看器亚洲字体包）；
- `extpack/Hash.ts`：纯 TS SHA-256（FIPS 180-4，含标准向量测试）。

### 扩展包框架

- `ExtensionManifest` / `RegistryCore`：清单校验（schema v1）、语义化版本比较、注册表解析、
  安装记录（installed.json）、能力解锁判定 `isConverterUnlocked()`；
- `ExtensionPackageManager.ets`（设备侧）：注册表拉取 → 下载 → SHA-256 常量时间校验 + 大小校验
  → manifest 校验 → 解包至 `files/plugins/<id>/<version>/` → 记录持久化；
- `ConvertHome.ets`：转换操作 + 扩展包市场（刷新/安装/已装列表）。

协议全文见工作区 [`docs/EXTENSION-PACK-SPEC.md`](../../docs/EXTENSION-PACK-SPEC.md)；
本地分发服务见 [`server/`](../../server)（`scripts/run-server.sh` 一键启动）。

## 结构

```text
src/main/ets/
├── core/
│   ├── zip/ZipCodec.ts
│   ├── ooxml/{DocxParser,DocxWriter,XlsxWriter}.ts
│   ├── pdf/{PdfWriter,PdfTextExtractor}.ts
│   ├── Converters.ts
│   └── extpack/{Hash,ExtensionManifest,RegistryCore}.ts
├── service/{ConvertService,ExtensionPackageManager,DocKind}.ets
├── view/ConvertHome.ets
└── Index.ets（根）
```

## 测试

```bash
npm test          # Node 侧 40 用例：ZIP/DOCX/PDF/XLSX 编解码、三转换 round-trip、
                  # SHA-256 向量、清单/注册表、扩展包端到端（构建→起服→下载→校验→安装）
# DevEco：src/test（LocalUnit）+ src/ohosTest
```

## 边界（v1）

- 转换为**基础级**：文本内容往返保真（含中文）；扫描图片型 PDF、复杂 CID/ToUnicode、
  旋转文本不在范围；PDF 生成不内嵌字体子集（查看器需亚洲字体包，Acrobat/Foxit/WPS 均可）；
- 扩展包承载「解锁 + 配置 + 资源」，不承载可执行代码（安全模型见 SPEC §1）。

License: MIT
