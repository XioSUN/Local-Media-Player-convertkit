/**
 * DesignTokens — 全局设计令牌（唯一权威定义见 docs/DESIGN-CONSTITUTION.md）
 *
 * 本文件在 4 个 feature HAR 与 app 各有一份**完全一致**的副本，
 * 由 scripts/check-design-tokens.sh 保证一致性；修改必须先改宪法再同步五处。
 */

export class DT {
  // ── 色彩 · 主色（琥珀暖橙，呼应频谱视觉主题）──
  static readonly ACCENT: string = '#E8742C';
  static readonly ACCENT_DEEP: string = '#C95F1A';
  static readonly GRAD_FROM: string = '#F79E4C'; // 主按钮渐变起点
  static readonly GRAD_TO: string = '#E8611D';   // 主按钮渐变终点

  // ── 中性色 ──
  static readonly BG: string = '#F5F6F8';        // 页面底
  static readonly CARD: string = '#FFFFFF';      // 卡片
  static readonly TEXT: string = '#18212F';      // 主文字
  static readonly TEXT_2: string = '#5A6472';    // 次级文字
  static readonly TEXT_3: string = '#9AA3AF';    // 弱文字/占位
  static readonly DIVIDER: string = '#ECEEF2';   // 分隔线

  // ── 语义色（仅此两个）──
  static readonly SUCCESS: string = '#2E9E5B';
  static readonly DANGER: string = '#D94838';

  // ── 播放器深色页专用 ──
  static readonly DARK_BG: string = '#101014';
  static readonly DARK_MASK: string = '#1C1C22';

  // ── 字号（fp）──
  static readonly F_TITLE: number = 20;
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

  // ── 光感 ──
  static readonly SHADOW_CARD: string = 'rgba(23,32,46,0.08)';   // 卡片低强度阴影
  static readonly SHADOW_GLOW: string = 'rgba(232,113,44,0.35)'; // 主按钮光晕
  static readonly MASK_SCRIM: string = 'rgba(16,16,20,0.55)';    // 视频控件浮层
}
