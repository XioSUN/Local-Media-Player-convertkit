import { picker } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { ConvertService, type ConvertResult } from '../service/ConvertService';
import { ExtensionPackageManager, type InstallPhase } from '../service/ExtensionPackageManager';
import { type RegistryPackage } from '../core/extpack/RegistryCore.ts';
import { DT } from './DesignTokens';

const PREF_FILE = 'convert_settings';
const KEY_REGISTRY = 'registryUrl';
const DEFAULT_REGISTRY_URL = 'http://127.0.0.1:8765/registry.json';

/**
 * 文档转换 + 扩展包市场（浅色功能页）。
 * 宪法第六条：每个操作有错误出口与阶段进度；禁用态带原因。
 */
@Component
export struct ConvertHome {
  @StorageProp('statusBarHeight') statusBarHeight: number = 0;
  @StorageProp('navBarHeight') navBarHeight: number = 0;
  @State message: string = '选择文件并导出；转换能力由功能包解锁';
  @State selectedName: string = '';
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
    docPicker.select(opts).then((uris: string[]) => {
      if (!uris || uris.length === 0) {
        return;
      }
      this.selectedUri = uris[0];
      this.selectedName = decodeURIComponent(this.selectedUri.substring(this.selectedUri.lastIndexOf('/') + 1));
      this.message = `已选择：${this.selectedName}`;
    }).catch((e: Error) => {
      this.message = `选择文件失败：${e.message}`;
    });
  }

  private runConvert(target: string): void {
    if (!this.selectedUri || !this.convertService) {
      this.message = '请先选择源文件（上方「选择文件」）。';
      return;
    }
    if (!this.packManager || !this.packManager.isConverterUnlocked(this.converterId(target))) {
      this.message = `${this.converterLabel(target)} 未解锁：请在下方市场安装对应功能包。`;
      return;
    }
    this.busy = true;
    this.message = '转换中…';
    this.convertService.convert(this.selectedUri, this.selectedName, target as 'pdf' | 'docx' | 'xlsx')
      .then(async (result: ConvertResult) => {
        this.message = result.message;
        if (result.ok) {
          this.message = await this.convertService!.saveResult(result);
        }
        this.busy = false;
      })
      .catch((e: Error) => {
        this.message = `转换失败：${e.message}`;
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
        this.installStatus = `市场共 ${pkgs.length} 个包。安装即下载并校验（SHA-256）。`;
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
          .backgroundColor(DT.CARD)
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

          // 三个转换入口（单一渐变主按钮规则 → 横排等权胶囊）
          Row({ space: 10 }) {
            Button('导出 PDF')
              .fontSize(DT.F_SUB)
              .height(DT.TAP_MIN)
              .layoutWeight(1)
              .fontColor('#FFFFFF')
              .borderRadius(DT.R_CHIP)
              .linearGradient({ angle: 135, colors: [[DT.GRAD_FROM, 0], [DT.GRAD_TO, 1]] })
              .enabled(!this.busy)
              .onClick(() => this.runConvert('pdf'))
            Button('导出 Word')
              .fontSize(DT.F_SUB)
              .height(DT.TAP_MIN)
              .layoutWeight(1)
              .fontColor('#FFFFFF')
              .borderRadius(DT.R_CHIP)
              .linearGradient({ angle: 135, colors: [[DT.GRAD_FROM, 0], [DT.GRAD_TO, 1]] })
              .enabled(!this.busy)
              .onClick(() => this.runConvert('docx'))
            Button('导出 Excel')
              .fontSize(DT.F_SUB)
              .height(DT.TAP_MIN)
              .layoutWeight(1)
              .fontColor('#FFFFFF')
              .borderRadius(DT.R_CHIP)
              .linearGradient({ angle: 135, colors: [[DT.GRAD_FROM, 0], [DT.GRAD_TO, 1]] })
              .enabled(!this.busy)
              .onClick(() => this.runConvert('xlsx'))
          }
          .width('100%')

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
                  .backgroundColor(DT.BG)
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
              .backgroundColor(DT.BG)
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
