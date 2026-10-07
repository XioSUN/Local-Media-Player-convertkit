import { picker } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { ConvertService, type ConvertResult, type ConvertTarget } from '../service/ConvertService';
import { type DocKind } from '../service/DocKind.ets';
import { ExtensionPackageManager, type InstallPhase } from '../service/ExtensionPackageManager';
import { type RegistryPackage } from '../core/extpack/RegistryCore.ts';
import { DT } from './DesignTokens';

const PREF_FILE = 'convert_settings';
const KEY_REGISTRY = 'registryUrl';
const DEFAULT_REGISTRY_URL = 'http://127.0.0.1:8765/registry.json';

/** 目标格式矩阵（v2：按源类型展示可用目标，convertio 式交互） */
interface TargetOption {
  target: ConvertTarget;
  label: string;
}

function opt(target: ConvertTarget, label: string): TargetOption {
  const o: TargetOption = { target: target, label: label };
  return o;
}

function buildMatrix(): Record<string, TargetOption[]> {
  const r: Record<string, TargetOption[]> = {};
  r['docx'] = [opt('pdf', 'PDF'), opt('txt', 'TXT')];
  r['pdf'] = [opt('docx', 'Word'), opt('xlsx', 'Excel'), opt('epub', 'EPUB')];
  r['xlsx'] = [opt('pdf', 'PDF')];
  r['epub'] = [opt('pdf', 'PDF')];
  r['txt'] = [opt('pdf', 'PDF')];
  r['unsupported'] = [];
  return r;
}

const TARGET_MATRIX: Record<string, TargetOption[]> = buildMatrix();

function buildKindLabel(): Record<string, string> {
  const r: Record<string, string> = {};
  r['docx'] = 'Word 文档';
  r['pdf'] = 'PDF 文档';
  r['xlsx'] = 'Excel 表格';
  r['epub'] = 'EPUB 电子书';
  r['txt'] = '文本文件';
  return r;
}

const KIND_LABEL: Record<string, string> = buildKindLabel();

/** 导出按钮组内边距常量（DesignTokens 未含此粒度，就近集中定义） */

/**
 * 文档转换 + 扩展包市场（浅色功能页）。
 * 宪法第六条：每个操作有错误出口与阶段进度；禁用态带原因。
 */
@Component
export struct ConvertHome {
  @StorageProp('statusBarHeight') statusBarHeight: number = 0;
  @StorageProp('navBarHeight') navBarHeight: number = 0;
  @State message: string = '转换能力已内置，选择文件即可导出 PDF / Word / Excel / EPUB / TXT';
  @State selectedName: string = '';
  @State sourceKind: string = 'none';
  @State busy: boolean = false;
  @State installedCount: number = 0;
  @State installedLines: string[] = [];
  @State market: RegistryPackage[] = [];
  @State installStatus: string = '';
  @State registryUrl: string = DEFAULT_REGISTRY_URL;
  @State urlEditing: boolean = false;
  private convertService?: ConvertService;
  private packManager?: ExtensionPackageManager;
  private selectedUri: string = '';
  private prefs?: preferences.Preferences;

  aboutToAppear(): void {
    const ctx = getContext(this) as common.Context;
    this.convertService = new ConvertService(ctx);
    this.packManager = new ExtensionPackageManager(ctx);
    this.packManager.load().then(() => this.refreshInstalled());
    preferences.getPreferences(ctx, PREF_FILE).then((p: preferences.Preferences) => {
      this.prefs = p;
      const saved = p.getSync(KEY_REGISTRY, DEFAULT_REGISTRY_URL) as string;
      this.registryUrl = saved;
    });
    // 联调钩子：aa start --ps autoTestFile <filesDir 下文件名|绝对路径|file://URI> --ps autoTestTarget pdf
    // 模拟器 picker(UIExtension) 关闭后窗口失焦，UI 驱动不可靠，用它直连转换链取堆栈
    const atFile = AppStorage.get<string>('autoTestFile') ?? '';
    if (atFile !== '' && this.convertService) {
      AppStorage.setOrCreate('autoTestFile', '');
      this.runAutoTest(ctx, atFile, AppStorage.get<string>('autoTestTarget') ?? 'pdf');
    }
  }

  private async runAutoTest(ctx: common.Context, atFile: string, atTarget: string): Promise<void> {
    const svc = this.convertService;
    if (svc === undefined) {
      return;
    }
    const target = atTarget as ConvertTarget;
    const src = atFile.startsWith('/') || atFile.startsWith('file://') ? atFile : `${ctx.filesDir}/${atFile}`;
    const name = atFile.substring(atFile.lastIndexOf('/') + 1);
    const kind = await svc.sniffKind(src, name);
    const r = await svc.convert(src, name, target);
    this.message = `[autotest:${kind}] ${r.message}`;
  }

  private refreshInstalled(): void {
    const list = this.packManager?.listInstalled() ?? [];
    this.installedCount = list.length;
    this.installedLines = list.map((p) => `${p.enabled ? '✅' : '⏸'} ${p.name} ${p.version}`);
  }

  private converterId(target: string): string {
    if (target === 'pdf') {
      return 'docx-to-pdf';
    }
    return `pdf-to-${target}`;
  }

  /** 当前源类型可用的目标格式 */
  private targets(): TargetOption[] {
    return TARGET_MATRIX[this.sourceKind] ?? [];
  }

  private converterLabel(target: string): string {
    if (target === 'pdf') {
      return 'DOCX → PDF';
    }
    return `PDF → ${target.toUpperCase()}`;
  }

  private pickSource(): void {
    const docPicker = new picker.DocumentViewPicker();
    const opts = new picker.DocumentSelectOptions();
    opts.maxSelectNumber = 1;
    docPicker.select(opts).then(async (uris: string[]) => {
      if (!uris || uris.length === 0) {
        return;
      }
      this.selectedUri = uris[0];
      this.selectedName = decodeURIComponent(this.selectedUri.substring(this.selectedUri.lastIndexOf('/') + 1));
      // 嗅探源类型 → 目标格式矩阵（convertio 式：选完即知能转什么）
      const kind: DocKind = this.convertService !== undefined
        ? await this.convertService.sniffKind(this.selectedUri, this.selectedName)
        : 'unsupported';
      this.sourceKind = kind;
      if (kind === 'unsupported') {
        this.message = `已选择：${this.selectedName}（该格式暂不支持，可试 docx/pdf/xlsx/epub/txt）`;
      } else {
        this.message = `已选择${KIND_LABEL[kind] ?? ''}：${this.selectedName}`;
      }
    }).catch((e: Error) => {
      this.message = `选择文件失败：${e.message}`;
    });
  }

  private runConvert(target: ConvertTarget): void {
    if (!this.selectedUri || !this.convertService) {
      this.message = '请先选择源文件（上方「选择文件」）。';
      return;
    }
    this.busy = true;
    this.message = '转换中…';
    this.convertService.convert(this.selectedUri, this.selectedName, target)
      .then(async (result: ConvertResult) => {
        this.message = result.message;
        if (result.ok) {
          this.message = await this.convertService!.saveResult(result);
        }
        this.busy = false;
      })
      .catch((e: Error) => {
        this.message = `转换失败：${e?.message ?? '未知错误'}`;
        this.busy = false;
      });
  }

  private refreshMarket(): void {
    if (!this.packManager) {
      return;
    }
    this.installStatus = '正在拉取注册表…';
    this.packManager.fetchRegistry(this.registryUrl)
      .then((pkgs: RegistryPackage[]) => {
        this.market = pkgs;
        this.installStatus = `市场共 ${pkgs.length} 个包（视觉预设等扩展资源）。安装即下载并校验（SHA-256）。`;
      })
      .catch((e: Error) => {
        this.market = [];
        this.installStatus = `拉取失败：${e.message}。请检查手机与服务的连通（联调需 fport 转发或局域网地址），可编辑上方地址后重试。`;
      });
  }

  private saveUrl(): void {
    if (this.prefs) {
      this.prefs.put(KEY_REGISTRY, this.registryUrl);
      this.prefs.flush();
    }
    this.urlEditing = false;
  }

  private installPack(pkg: RegistryPackage): void {
    if (!this.packManager) {
      return;
    }
    this.packManager.install(pkg, (phase: InstallPhase, msg: string) => {
      this.installStatus = msg;
    }).then((r) => {
      this.installStatus = r.message;
      this.refreshInstalled();
    });
  }

  build() {
    Column() {
      // 顶栏（让位状态栏）
      Row({ space: 12 }) {
        Text('转换').fontSize(DT.F_TITLE).fontWeight(FontWeight.Bold).fontColor(DT.TEXT)
        Blank()
        Button('选择文件')
          .fontSize(DT.F_SUB)
          .height(DT.TAP_MIN - 8)
          .padding({ left: 18, right: 18 })
          .fontColor(DT.ACCENT)
          .backgroundColor(DT.CARD_2)
          .borderRadius(DT.R_CHIP)
          .onClick(() => this.pickSource())
      }
      .width('100%')
      .padding({ left: DT.PAD, right: DT.PAD, top: this.statusBarHeight + 8, bottom: 12 })

      Scroll() {
        Column({ space: DT.PAD }) {
          // 已选文件卡片
          Row({ space: 10 }) {
            Text('📄').fontSize(20)
            Text(this.selectedName === '' ? '未选择文件' : this.selectedName)
              .fontSize(DT.F_BODY)
              .fontColor(this.selectedName === '' ? DT.TEXT_3 : DT.TEXT)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
          }
          .width('100%')
          .padding(DT.PAD)
          .backgroundColor(DT.CARD)
          .borderRadius(DT.R_CARD)
          .shadow({ radius: 16, color: DT.SHADOW_CARD, offsetY: 4 })

          // 目标格式矩阵（单一渐变主按钮规则 → 首个目标为主按钮，其余胶囊随行）
          if (this.selectedName !== '' && this.targets().length > 0) {
            Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Start }) {
              ForEach(this.targets(), (opt: TargetOption, idx: number) => {
                Button(`导出 ${opt.label}`)
                  .fontSize(DT.F_SUB)
                  .height(DT.TAP_MIN)
                  .padding({ left: 22, right: 22 })
                  .margin({ right: 10, bottom: 10 })
                  .fontColor('#FFFFFF')
                  .borderRadius(DT.R_CHIP)
                  .linearGradient(idx === 0
                    ? { angle: 135, colors: [[DT.GRAD_FROM, 0], [DT.GRAD_TO, 1]] }
                    : { angle: 135, colors: [['#3A3A46', 0], ['#32323E', 1]] })
                  .enabled(!this.busy)
                  .onClick(() => this.runConvert(opt.target))
              }, (opt: TargetOption) => opt.target)
            }
            .width('100%')
          }

          Text(this.message)
            .fontSize(DT.F_SUB)
            .fontColor(DT.TEXT_2)
            .width('100%')
            .maxLines(3)
            .textAlign(TextAlign.LEFT)

          // ── 扩展包市场卡片 ──
          Column({ space: 12 }) {
            Row({ space: 10 }) {
              Text('扩展包市场').fontSize(DT.F_SECTION).fontWeight(FontWeight.Medium).fontColor(DT.TEXT)
              Blank()
              if (this.urlEditing) {
                Button('保存')
                  .fontSize(DT.F_CAPTION)
                  .height(DT.TAP_MIN - 16)
                  .padding({ left: 14, right: 14 })
                  .fontColor('#FFFFFF')
                  .backgroundColor(DT.ACCENT)
                  .borderRadius(DT.R_CHIP)
                  .onClick(() => this.saveUrl())
              } else {
                Button('刷新')
                  .fontSize(DT.F_CAPTION)
                  .height(DT.TAP_MIN - 16)
                  .padding({ left: 14, right: 14 })
                  .fontColor(DT.ACCENT)
                  .backgroundColor(DT.CARD_2)
                  .borderRadius(DT.R_CHIP)
                  .onClick(() => this.refreshMarket())
              }
            }
            .width('100%')

            // 注册表地址（可编辑持久化，宪法第六条错误出口的前提）
            if (this.urlEditing) {
              TextInput({ text: this.registryUrl, placeholder: 'http://192.168.x.x:8765/registry.json' })
                .fontSize(DT.F_SUB)
                .height(DT.TAP_MIN - 4)
                .backgroundColor(DT.BG)
                .borderRadius(DT.R_CHIP)
                .onChange((v: string) => {
                  this.registryUrl = v;
                })
            } else {
              Text(this.registryUrl)
                .fontSize(DT.F_CAPTION)
                .fontColor(DT.TEXT_3)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%')
                .onClick(() => {
                  this.urlEditing = true;
                })
            }

            if (this.installStatus !== '') {
              Text(this.installStatus)
                .fontSize(DT.F_CAPTION)
                .fontColor(DT.TEXT_2)
                .width('100%')
                .maxLines(4)
            }

            if (this.market.length === 0 && this.installStatus === '') {
              Text('尚未拉取。点击「刷新」获取可用功能包。')
                .fontSize(DT.F_CAPTION)
                .fontColor(DT.TEXT_3)
            }

            ForEach(this.market, (pkg: RegistryPackage) => {
              Row({ space: 12 }) {
                Column({ space: 4 }) {
                  Text(pkg.name).fontSize(DT.F_BODY).fontColor(DT.TEXT).fontWeight(FontWeight.Medium)
                  Text(`${pkg.summary} · ${(pkg.size / 1024).toFixed(0)}KB · v${pkg.version}`)
                    .fontSize(DT.F_CAPTION)
                    .fontColor(DT.TEXT_3)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)

                Button('安装')
                  .fontSize(DT.F_SUB)
                  .height(DT.TAP_MIN - 12)
                  .padding({ left: 18, right: 18 })
                  .fontColor('#FFFFFF')
                  .backgroundColor(DT.ACCENT)
                  .borderRadius(DT.R_CHIP)
                  .onClick(() => this.installPack(pkg))
              }
              .width('100%')
              .padding({ top: 10, bottom: 10 })
              .borderRadius(DT.R_CHIP)
              .backgroundColor(DT.CARD_2)
            }, (pkg: RegistryPackage) => `${pkg.id}@${pkg.version}`)

            if (this.installedCount > 0) {
              Divider().color(DT.DIVIDER)
              Text(`已安装 ${this.installedCount} 个`)
                .fontSize(DT.F_CAPTION)
                .fontColor(DT.TEXT_2)
                .width('100%')
              ForEach(this.installedLines, (line: string) => {
                Text(line)
                  .fontSize(DT.F_CAPTION)
                  .fontColor(DT.TEXT_2)
                  .width('100%')
              }, (line: string) => line)
            }
          }
          .width('100%')
          .padding(DT.PAD)
          .backgroundColor(DT.CARD)
          .borderRadius(DT.R_CARD)
          .shadow({ radius: 16, color: DT.SHADOW_CARD, offsetY: 4 })
        }
        .padding({ left: DT.PAD, right: DT.PAD, bottom: this.navBarHeight + DT.PAD })
        .alignItems(HorizontalAlign.Center)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(DT.BG)
  }
}
