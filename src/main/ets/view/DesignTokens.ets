/**
 * DesignTokens — 全局设计令牌（唯一权威定义见 docs/DESIGN-CONSTITUTION.md）
 *
 * 本文件在 4 个 feature HAR 与 app 各有一份**完全一致**的副本，
 * 由 scripts/check-design-tokens.sh 保证一致性；修改必须先改宪法再同步五处。
 *
 * v1.5：皮肤主题系统（用户 2026-10-07 指定）——四主题「纯白/米白/纯黑/护眼绿」
 * 用户自选，中性色（底/卡/文字/阴影）随主题切换；品牌色（琥珀）与字号尺寸跨主题恒定。
 * 机制：主题 id 存 AppStorage('themeId')（preferences 持久化，键见 THEME_KEY）；
 * 色彩 getter 每次取值时读当前色板；页面组件须持有 @StorageProp('themeId') 建立重渲染依赖。
 */

/** 主题色板（中性色随主题；画布内容色不在此列） */
export class ThemePalette {
  readonly name: string;      // 主题名（选择器展示）
  readonly dark: boolean;     // true = 深色主题（状态栏浅色内容）
  readonly bg: string;        // 页面底
  readonly card: string;      // 一级卡片
  readonly card2: string;     // 二级卡片 / 次级胶囊底
  readonly divider: string;   // 分隔线 / 滑轨
  readonly text: string;      // 主文字
  readonly text2: string;     // 次级文字
  readonly text3: string;     // 弱文字 / 占位
  readonly shadowCard: string; // 卡片阴影
  readonly maskScrim: string;  // 浮层遮罩
  readonly matColor: string;   // 沉浸材质底色（悬浮卡/悬浮岛玻璃 tint）
  readonly matBrightness: number; // 材质亮度（深色主题压暗、浅色主题提亮）

  constructor(name: string, dark: boolean, bg: string, card: string, card2: string,
    divider: string, text: string, text2: string, text3: string,
    shadowCard: string, maskScrim: string, matColor: string, matBrightness: number) {
    this.name = name;
    this.dark = dark;
    this.bg = bg;
    this.card = card;
    this.card2 = card2;
    this.divider = divider;
    this.text = text;
    this.text2 = text2;
    this.text3 = text3;
    this.shadowCard = shadowCard;
    this.maskScrim = maskScrim;
    this.matColor = matColor;
    this.matBrightness = matBrightness;
  }
}

const THEME_LIST: ThemePalette[] = [
  new ThemePalette('纯白', false, '#FFFFFF', '#F5F5F8', '#ECECF1', '#E2E2E8',
    '#1A1A20', '#55555E', '#8E8E96', 'rgba(15,20,40,0.08)', 'rgba(20,20,25,0.35)', 'rgba(255,255,255,0.70)', 1.06),
  new ThemePalette('米白', false, '#FAF5EA', '#F3EDDF', '#EAE2CF', '#E0D7C2',
    '#2B2317', '#6B5F49', '#9C9078', 'rgba(90,70,30,0.10)', 'rgba(43,35,23,0.35)', 'rgba(255,252,244,0.70)', 1.06),
  new ThemePalette('纯黑', true, '#000000', '#15151B', '#1F1F27', '#28282F',
    '#F2F2F7', '#B8B8C4', '#7C7C8A', 'rgba(0,0,0,0.50)', 'rgba(8,8,12,0.60)', 'rgba(26,26,34,0.62)', 0.85),
  new ThemePalette('护眼绿', false, '#CCE8CF', '#C2E0C6', '#B4D6B9', '#A5C9AB',
    '#1E3322', '#46604B', '#6E8873', 'rgba(30,60,35,0.12)', 'rgba(30,51,34,0.35)', 'rgba(245,255,245,0.72)', 1.05)
];

export class DT {
  // ── 主题系统 ──
  static readonly THEME_KEY: string = 'themeId';          // AppStorage / preferences 键
  static readonly THEME_PREF_FILE: string = 'app_settings'; // preferences 文件名
  static readonly DEFAULT_THEME: number = 2;               // 默认纯黑（延续深色沉浸基线）
  static readonly THEME_COUNT: number = THEME_LIST.length;

  static themeName(id: number): string {
    return (THEME_LIST[id] ?? THEME_LIST[DT.DEFAULT_THEME]).name;
  }
  static themeDark(id: number): boolean {
    return (THEME_LIST[id] ?? THEME_LIST[DT.DEFAULT_THEME]).dark;
  }
  /** 主题预览取色（选择器色板用，不依赖当前 AppStorage） */
  static themeBg(id: number): string {
    return (THEME_LIST[id] ?? THEME_LIST[DT.DEFAULT_THEME]).bg;
  }
  static themeCard(id: number): string {
    return (THEME_LIST[id] ?? THEME_LIST[DT.DEFAULT_THEME]).card;
  }

  private static palette(): ThemePalette {
    const id = AppStorage.get<number>(DT.THEME_KEY) ?? DT.DEFAULT_THEME;
    return THEME_LIST[id] ?? THEME_LIST[DT.DEFAULT_THEME];
  }

  // ── 色彩 · 主题驱动（页面以 @StorageProp('themeId') 建立重渲染依赖）──
  static get BG(): string { return DT.palette().bg; }
  static get CARD(): string { return DT.palette().card; }
  static get CARD_2(): string { return DT.palette().card2; }
  static get DIVIDER(): string { return DT.palette().divider; }
  static get TEXT(): string { return DT.palette().text; }
  static get TEXT_2(): string { return DT.palette().text2; }
  static get TEXT_3(): string { return DT.palette().text3; }
  static get SHADOW_CARD(): string { return DT.palette().shadowCard; }
  static get MASK_SCRIM(): string { return DT.palette().maskScrim; }
  static get MAT_COLOR(): string { return DT.palette().matColor; }
  static get MAT_BRIGHTNESS(): number { return DT.palette().matBrightness; }

  // ── 色彩 · 品牌（跨主题恒定，琥珀暖橙呼应频谱视觉主题）──
  static readonly ACCENT: string = '#E8742C';
  static readonly ACCENT_DEEP: string = '#C95F1A';
  static readonly GRAD_FROM: string = '#F79E4C'; // 主按钮渐变起点
  static readonly GRAD_TO: string = '#E8611D';   // 主按钮渐变终点
  static readonly SHADOW_GLOW: string = 'rgba(232,113,44,0.35)'; // 主按钮光晕

  // ── 色彩 · 语义（跨主题恒定）──
  static readonly SUCCESS: string = '#34B46A';
  static readonly DANGER: string = '#E05646';

  // ── 画布常量（频谱/视频等深色画布内容，不随主题——宪法第四条「画布内容」）──
  static readonly DARK_BG: string = '#101014';
  static readonly DARK_MASK: string = '#1C1C22';
  static readonly LIGHT_BG: string = '#F5F6F8'; // 历史保留

  // ── 字号（fp）──
  static readonly F_TITLE: number = 28;   // 页面大标题（HMOS 视频规格）
  static readonly F_SECTION: number = 17;
  static readonly F_BODY: number = 16;
  static readonly F_SUB: number = 14;
  static readonly F_CAPTION: number = 13;

  // ── 尺寸（vp）──
  static readonly TAP_MIN: number = 48;   // 最小可点高度（可用性红线）
  static readonly PAD: number = 16;       // 栅格间距
  static readonly R_CARD: number = 16;    // 卡片圆角
  static readonly R_BTN: number = 24;     // 主按钮圆角（胶囊）
  static readonly R_CHIP: number = 18;    // 次级胶囊
  static readonly ISLAND_CLEAR: number = 80; // 悬浮岛总净空（岛高+留边），页面底部避让用
}
