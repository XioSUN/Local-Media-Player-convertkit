import { picker } from '@kit.CoreFileKit';
import { ConvertService, type ConvertResult } from '../service/ConvertService';
import { ExtensionPackageManager, type InstallPhase } from '../service/ExtensionPackageManager';
import type { RegistryPackage } from '../core/extpack/RegistryCore.ts';

/** 默认注册表地址（本地联服用 scripts 启动 server；发布环境替换为 HTTPS 服务） */
const DEFAULT_REGISTRY_URL = 'http://127.0.0.1:8765/registry.json';

/**
 * ConvertHome — 文档转换 + 扩展包市场页。
 *
 * 三个转换能力：docx→pdf / pdf→docx / pdf→xlsx。
 * 转换能力默认「未解锁」，需从扩展包市场下载对应功能包（下载→SHA-256 校验→
 * 解包→manifest 校验→安装记录）。扩展包协议见 docs/EXTENSION-PACK-SPEC.md。
 */
@Component
export struct ConvertHome {
  @State message: string = '选择源文件并选择目标格式；转换能力需安装对应功能包';
  @State selectedUri: string = '';
  @State selectedName: string = '';
  @State busy: boolean = false;
  @State installed: Array<string> = [];
  @State market: Array<RegistryPackage> = [];
  @State installStatus: string = '';
  private convertService?: ConvertService;
  private packManager?: ExtensionPackageManager;

  aboutToAppear(): void {
    const ctx = getContext(this);
    this.convertService = new ConvertService(ctx);
    this.packManager = new ExtensionPackageManager(ctx);
    this.packManager.load().then(() => this.refreshInstalled());
  }

  private refreshInstalled(): void {
    this.installed = (this.packManager?.listInstalled() ?? [])
      .map((p) => `${p.enabled ? '✅' : '⏸'} ${p.name} ${p.version}`);
  }

  private converterUnlocked(id: string): boolean {
    return this.packManager?.isConverterUnlocked(id) ?? false;
  }

  private async pickSource(): Promise<void> {
    try {
      const docPicker = new picker.DocumentViewPicker();
      const opts = new picker.DocumentSelectOptions();
      opts.maxSelectNumber = 1;
      const uris: string[] = await docPicker.select(opts);
      if (!uris || uris.length === 0) {
        return;
      }
      this.selectedUri = uris[0];
      this.selectedName = decodeURIComponent(this.selectedUri.substring(this.selectedUri.lastIndexOf('/') + 1));
      this.message = `已选择: ${this.selectedName}`;
    } catch (e) {
      this.message = `选择失败: ${(e as Error).message}`;
    }
  }

  private async runConvert(target: 'pdf' | 'docx' | 'xlsx'): Promise<void> {
    if (!this.selectedUri || !this.convertService) {
      this.message = '请先选择源文件';
      return;
    }
    if (!this.converterUnlocked(`${target === 'pdf' ? 'docx-to-pdf' : 'pdf-to-' + target}`)) {
      this.message = `该能力需安装功能包 — 请在下方「扩展包市场」安装`;
      return;
    }
    this.busy = true;
    this.message = '转换中…';
    const result: ConvertResult = await this.convertService.convert(this.selectedUri, this.selectedName, target);
    this.message = result.message;
    if (result.ok) {
      this.message = await this.convertService.saveResult(result);
    }
    this.busy = false;
  }

  private async refreshMarket(): Promise<void> {
    if (!this.packManager) {
      return;
    }
    try {
      this.market = await this.packManager.fetchRegistry(DEFAULT_REGISTRY_URL);
      this.installStatus = `市场共 ${this.market.length} 个包（${DEFAULT_REGISTRY_URL}）`;
    } catch (e) {
      this.installStatus = `拉取注册表失败: ${(e as Error).message}（请先启动 server：scripts/run-server.sh）`;
    }
  }

  private async installPack(pkg: RegistryPackage): Promise<void> {
    if (!this.packManager) {
      return;
    }
    const onPhase = (phase: InstallPhase, msg: string) => {
      this.installStatus = `${msg}`;
    };
    const result = await this.packManager.install(pkg, onPhase);
    this.installStatus = result.message;
    this.refreshInstalled();
  }

  build() {
    Column({ space: 10 }) {
      Text('文档转换').fontSize(16).fontWeight(FontWeight.Bold).padding({ left: 16 })

      Row({ space: 10 }) {
        Button('选择源文件')
          .fontSize(12)
          .backgroundColor(0x22000000)
          .onClick(() => this.pickSource())
        Text(this.selectedName === '' ? '未选择' : this.selectedName)
          .fontSize(11)
          .maxLines(1)
          .layoutWeight(1)
      }
      .padding({ left: 16, right: 16 })

      Row({ space: 8 }) {
        Button('导出 PDF')
          .fontSize(12)
          .buttonStyle(ButtonStyleMode.EMPHASIZED)
          .backgroundColor('#3d5a80')
          .enabled(!this.busy)
          .onClick(() => this.runConvert('pdf'))
        Button('导出 Word')
          .fontSize(12)
          .buttonStyle(ButtonStyleMode.EMPHASIZED)
          .backgroundColor('#2d6a4f')
          .enabled(!this.busy)
          .onClick(() => this.runConvert('docx'))
        Button('导出 Excel')
          .fontSize(12)
          .buttonStyle(ButtonStyleMode.EMPHASIZED)
          .backgroundColor('#7f5539')
          .enabled(!this.busy)
          .onClick(() => this.runConvert('xlsx'))
      }
      .padding({ left: 16, right: 16 })

      Text(this.message)
        .fontSize(11)
        .fontColor('#555555')
        .padding({ left: 16, right: 16 })

      Divider()

      Row({ space: 10 }) {
        Text('扩展包市场').fontSize(14).fontWeight(FontWeight.Medium)
        Blank()
        Button('刷新')
          .fontSize(12)
          .backgroundColor(0x22000000)
          .onClick(() => this.refreshMarket())
      }
      .padding({ left: 16, right: 16 })

      Text(this.installStatus)
        .fontSize(10)
        .fontColor('#888888')
        .maxLines(2)
        .padding({ left: 16, right: 16 })

      List({ space: 4 }) {
        ForEach(this.market, (pkg: RegistryPackage) => {
          ListItem() {
            Row({ space: 8 }) {
              Column({ space: 2 }) {
                Text(`${pkg.name} ${pkg.version}`).fontSize(13)
                Text(`${pkg.summary} · ${(pkg.size / 1024).toFixed(0)}KB`).fontSize(10).fontColor('#888888')
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)

              Button('安装')
                .fontSize(12)
                .backgroundColor('#3d5a80')
                .onClick(() => this.installPack(pkg))
            }
            .padding({ left: 16, right: 16, top: 6, bottom: 6 })
          }
        }, (pkg: RegistryPackage) => `${pkg.id}@${pkg.version}`)
      }
      .layoutWeight(1)
      .width('100%')

      if (this.installed.length > 0) {
        Column({ space: 2 }) {
          Text('已安装').fontSize(12).fontWeight(FontWeight.Medium)
          ForEach(this.installed, (line: string) => {
            Text(line).fontSize(11).fontColor('#555555')
          }, (line: string) => line)
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 8 })
      }
    }
    .width('100%')
    .height('100%')
  }
}
