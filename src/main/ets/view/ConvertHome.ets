import { picker } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { window } from '@kit.ArkUI';
import { notificationManager } from '@kit.NotificationKit';
import notification from '@ohos.notification';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { ConvertService, type ConvertResult, type ConvertTarget } from '../service/ConvertService';
import { type DocKind } from '../service/DocKind.ets';
import { DT } from './DesignTokens';

const CVT_DOMAIN = 0x0203;
const CVT_TAG = 'LMP-Convert-UI';
const THEME_IDS: number[] = [0, 1, 2, 3];

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
  r['mobi'] = [opt('pdf', 'PDF')];
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
  r['mobi'] = 'MOBI 电子书';
  return r;
}

const KIND_LABEL: Record<string, string> = buildKindLabel();

/** 主题皮肤选择弹层（四主题：纯白/米白/纯黑/护眼绿） */
@CustomDialog
struct ThemeSheetDialog {
  controller?: CustomDialogController;
  onPick: (id: number) => void = () => {};

  private currentId(): number {
    return AppStorage.get<number>(DT.THEME_KEY) ?? DT.DEFAULT_THEME;
  }

  build() {
    Column({ space: 12 }) {
      Text('主题皮肤')
        .fontSize(DT.F_SECTION)
        .fontWeight(FontWeight.Medium)
        .fontColor(DT.TEXT)
        .width('100%')
      ForEach(THEME_IDS, (id: number) => {
        Row({ space: 12 }) {
          // 双色预览：页面底 + 卡片
          Row({ space: 4 }) {
            Column()
              .width(40)
              .height(28)
              .borderRadius(6)
              .backgroundColor(DT.themeBg(id))
            Column()
              .width(24)
              .height(28)
              .borderRadius(6)
              .backgroundColor(DT.themeCard(id))
          }
          Text(DT.themeName(id))
            .fontSize(DT.F_BODY)
            .fontColor(DT.TEXT)
            .layoutWeight(1)
          if (this.currentId() === id) {
            SymbolGlyph($r('sys.symbol.checkmark'))
              .fontSize(20)
              .fontColor([DT.ACCENT])
          }
        }
        .width('100%')
        .height(DT.TAP_MIN)
        .padding({ left: 12, right: 12 })
        .borderRadius(DT.R_CHIP)
        .backgroundColor(this.currentId() === id ? DT.CARD_2 : Color.Transparent)
        .onClick(() => {
          this.onPick(id);
          this.controller?.close();
        })
      }, (id: number) => `theme-${id}`)
    }
    .padding(DT.PAD)
    .backgroundColor(DT.CARD)
    .borderRadius(DT.R_CARD)
    .width('86%')
  }
}

/** 转换完成小窗（成功结果确认 + 保存出口） */
@CustomDialog
struct ConvertDoneDialog {
  controller?: CustomDialogController;
  @Link ok: boolean;
  @Link title: string;
  @Link detail: string;
  onSave: () => void = () => {};

  build() {
    Column({ space: 14 }) {
      SymbolGlyph(this.ok ? $r('sys.symbol.checkmark_circle_fill') : $r('sys.symbol.xmark_circle_fill'))
        .fontSize(46)
        .fontColor([this.ok ? DT.SUCCESS : DT.DANGER])
      Text(this.title)
        .fontSize(DT.F_SECTION)
        .fontWeight(FontWeight.Medium)
        .fontColor(DT.TEXT)
      Text(this.detail)
        .fontSize(DT.F_SUB)
        .fontColor(DT.TEXT_2)
        .textAlign(TextAlign.Center)
        .width('100%')
      Row({ space: 10 }) {
        if (this.ok) {
          Button('保存到…')
            .fontSize(DT.F_SUB)
            .height(DT.TAP_MIN - 8)
            .layoutWeight(1)
            .fontColor('#FFFFFF')
            .borderRadius(DT.R_CHIP)
            .linearGradient({ angle: 135, colors: [[DT.GRAD_FROM, 0], [DT.GRAD_TO, 1]] })
            .onClick(() => {
              this.controller?.close();
              this.onSave();
            })
          Button('关闭')
            .fontSize(DT.F_SUB)
            .height(DT.TAP_MIN - 8)
            .layoutWeight(1)
            .fontColor(DT.TEXT)
            .backgroundColor(DT.CARD_2)
            .borderRadius(DT.R_CHIP)
            .onClick(() => {
              this.controller?.close();
            })
        } else {
          Button('知道了')
            .fontSize(DT.F_SUB)
            .height(DT.TAP_MIN - 8)
            .layoutWeight(1)
            .fontColor(DT.TEXT)
            .backgroundColor(DT.CARD_2)
            .borderRadius(DT.R_CHIP)
            .onClick(() => {
              this.controller?.close();
            })
        }
      }
      .width('100%')
    }
    .padding(DT.PAD + 6)
    .backgroundColor(DT.CARD)
    .borderRadius(DT.R_CARD)
    .width('80%')
  }
}

/**
 * 文档转换页（浅色功能页）。
 * v3（2026-10-07）：转换能力全内置，扩展包市场 UI 移除；
 * 完成后弹出结果小窗（宪法第九条：结果确认）+ 系统通知；
 * 顶栏入口：主题皮肤（四主题用户自选，宪法 v1.5）。
 */
@Component
export struct ConvertHome {
  @StorageProp('statusBarHeight') statusBarHeight: number = 0;
  @StorageProp('navBarHeight') navBarHeight: number = 0;
  // 主题依赖：themeId 变更触发本页重渲染（宪法第五条 v1.5）
  @StorageProp('themeId') themeId: number = DT.DEFAULT_THEME;
  @State message: string = '转换能力已内置，支持 PDF / Word / Excel / EPUB / MOBI / TXT 互转与 PDF 合并';
  @State selectedName: string = '';
  @State sourceKind: string = 'none';
  @State busy: boolean = false;
  @State doneOk: boolean = true;
  @State doneTitle: string = '';
  @State doneDetail: string = '';
  private convertService?: ConvertService;
  private selectedUri: string = '';
  private pendingResult?: ConvertResult;

  private themeSheet: CustomDialogController = new CustomDialogController({
    builder: ThemeSheetDialog({ onPick: (id: number): void => { this.applyTheme(id); } }),
    customStyle: true,
    autoCancel: true
  });
  private doneSheet: CustomDialogController = new CustomDialogController({
    builder: ConvertDoneDialog({
      ok: this.doneOk,
      title: this.doneTitle,
      detail: this.doneDetail,
      onSave: (): void => { this.doSave(); }
    }),
    customStyle: true,
    autoCancel: true
  });

  aboutToAppear(): void {
    const ctx = getContext(this) as common.Context;
    this.convertService = new ConvertService(ctx);
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
    if (r.ok) {
      // 与 UI 路径共用完成流程（小窗 + 通知），联调即真实验证
      await this.completeConvert(r);
    }
  }

  /** 转换成功公共出口：结果小窗 + 系统通知（宪法第九条：结果确认） */
  private async completeConvert(result: ConvertResult): Promise<void> {
    this.pendingResult = result;
    const kb = result.outputBytes !== undefined ? (result.outputBytes.length / 1024).toFixed(1) : '?';
    this.doneOk = true;
    this.doneTitle = '转换完成';
    this.doneDetail = `${result.suggestedName ?? '输出文件'} · ${kb} KB，可保存或继续转换`;
    await this.notifyDone(result.suggestedName ?? '', this.doneDetail);
    this.doneSheet.open();
  }

  /** 主题依赖锚点：build 中读取 themeId，保证换肤时整页重渲染 */
  private themeBG(): string {
    return this.themeId >= 0 ? DT.BG : DT.BG;
  }

  /** 应用主题：AppStorage 全 app 重渲染 + preferences 持久化 + 状态栏随明暗 */
  private async applyTheme(id: number): Promise<void> {
    AppStorage.setOrCreate(DT.THEME_KEY, id);
    try {
      const ctx = getContext(this) as common.Context;
      const prefs = await preferences.getPreferences(ctx, DT.THEME_PREF_FILE);
      await prefs.put(DT.THEME_KEY, id);
      await prefs.flush();
    } catch (_) {
      // 持久化失败不阻塞换肤
    }
    try {
      const win = await window.getLastWindow(getContext(this));
      const dark = DT.themeDark(id);
      await win.setWindowSystemBarProperties({
        statusBarContentColor: dark ? '#F2F2F7' : '#1A1A20',
        isStatusBarLightIcon: dark
      });
    } catch (_) {
      // 状态栏配色失败不阻塞换肤
    }
  }

  /** 转换完成系统通知（用户未授权则静默跳过） */
  private async notifyDone(name: string, detail: string): Promise<void> {
    try {
      await notificationManager.requestEnableNotification();
      await notificationManager.publish({
        id: CVT_DOMAIN,
        content: {
          contentType: notification.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: { title: '转换完成', text: `${detail}` }
        }
      });
      hilog.info(CVT_DOMAIN, CVT_TAG, 'notification published for %{public}s', name);
    } catch (e) {
      hilog.warn(CVT_DOMAIN, CVT_TAG, 'notification skipped: %{public}s', (e as Error).message);
    }
  }

  /** 当前源类型可用的目标格式 */
  private targets(): TargetOption[] {
    return TARGET_MATRIX[this.sourceKind] ?? [];
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

  /** 多选合并（v3）：picker 多选 PDF → 按选择顺序合并 */
  private async mergePick(): Promise<void> {
    if (!this.convertService) {
      return;
    }
    const docPicker = new picker.DocumentViewPicker();
    const opts = new picker.DocumentSelectOptions();
    opts.maxSelectNumber = 9;
    try {
      const uris: string[] = await docPicker.select(opts);
      if (!uris || uris.length < 2) {
        this.message = '合并请在选择器里勾选两份以上 PDF';
        return;
      }
      this.busy = true;
      this.message = `合并中（${uris.length} 份）…`;
      const r = await this.convertService.mergePdfs(uris, '合并文档.pdf');
      this.busy = false;
      this.message = r.message;
      if (r.ok) {
        await this.completeConvert(r);
      }
    } catch (e) {
      this.busy = false;
      this.message = `选择失败：${(e as Error).message}`;
    }
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
        this.busy = false;
        if (result.ok) {
          this.message = result.message;
          await this.completeConvert(result);
        } else {
          this.message = result.message;
        }
      })
      .catch((e: Error) => {
        this.message = `转换失败：${e?.message ?? '未知错误'}`;
        this.busy = false;
      });
  }

  /** 完成小窗「保存到…」：系统保存面板写出 */
  private doSave(): void {
    const result = this.pendingResult;
    if (!result || !this.convertService) {
      return;
    }
    this.convertService.saveResult(result).then((msg: string) => {
      this.message = msg;
    }).catch((e: Error) => {
      this.message = `保存失败：${e?.message ?? '未知错误'}`;
    });
  }

  build() {
    Column() {
      // 顶栏（让位状态栏）
      Row({ space: 10 }) {
        Text('转换').fontSize(DT.F_TITLE).fontWeight(FontWeight.Bold).fontColor(DT.TEXT)
        Blank()
        // 主题皮肤入口
        Button() {
          SymbolGlyph($r('sys.symbol.paintpalette'))
            .fontSize(20)
            .fontColor([DT.ACCENT])
        }
        .type(ButtonType.Circle)
        .width(DT.TAP_MIN - 6)
        .height(DT.TAP_MIN - 6)
        .backgroundColor(DT.CARD_2)
        .onClick(() => {
          this.themeSheet.open();
        })
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

          // 常驻工具行：PDF 合并（多选）
          Row({ space: 10 }) {
            Button('合并 PDF（选多个）')
              .fontSize(DT.F_SUB)
              .height(DT.TAP_MIN - 8)
              .padding({ left: 16, right: 16 })
              .fontColor(DT.ACCENT)
              .backgroundColor(DT.CARD_2)
              .borderRadius(DT.R_CHIP)
              .enabled(!this.busy)
              .onClick(() => this.mergePick())
            Text('按选择顺序拼接页面')
              .fontSize(DT.F_CAPTION)
              .fontColor(DT.TEXT_3)
              .layoutWeight(1)
              .maxLines(1)
          }
          .width('100%')

          // 目标格式矩阵（单一渐变主按钮规则 → 首个目标为主按钮，其余胶囊随行）
          if (this.selectedName !== '' && this.targets().length > 0) {
            Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Start }) {
              ForEach(this.targets(), (o: TargetOption, idx: number) => {
                Button(`导出 ${o.label}`)
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
                  .onClick(() => this.runConvert(o.target))
              }, (o: TargetOption) => o.target)
            }
            .width('100%')
          }

          Text(this.message)
            .fontSize(DT.F_SUB)
            .fontColor(DT.TEXT_2)
            .width('100%')
            .maxLines(3)
            .textAlign(TextAlign.LEFT)
        }
        .padding({ left: DT.PAD, right: DT.PAD, bottom: this.navBarHeight + DT.ISLAND_CLEAR })
        .alignItems(HorizontalAlign.Center)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.themeBG())
  }
}
