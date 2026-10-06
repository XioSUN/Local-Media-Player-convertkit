/**
 * DesignTokens — 全局设计令牌（唯一权威定义见 docs/DESIGN-CONSTITUTION.md）
 *
 * 本文件在 4 个 feature HAR 与 app 各有一份**完全一致**的副本，
 * 由 scripts/check-design-tokens.sh 保证一致性；修改必须先改宪法再同步五处。
 *
 * v1.2：全局切换深色沉浸基线（参考 HMOS【视频】首页效果，
 * 用户 2026-10-06 指定）：深底、左上大标题、深色卡片、渐变主按钮。
 */

export class DT {
  // ── 色彩 · 主色（琥珀暖橙，呼应频谱视觉主题）──
  static readonly ACCENT: string = '#E8742C';
  static readonly ACCENT_DEEP: string = '#C95F1A';
  static readonly GRAD_FROM: string = '#F79E4C'; // 主按钮渐变起点
  static readonly GRAD_TO: string = '#E8611D';   // 主按钮渐变终点

  // ── 深色沉浸基线（全局默认，参考 HMOS 视频）──
  static readonly BG: string = '#0D0D12';        // 页面底（近黑）
  static readonly CARD: string = '#1A1A22';      // 一级卡片
  static readonly CARD_2: string = '#24242E';    // 二级卡片 / 次级胶囊底
  static readonly DIVIDER: string = '#2A2A35';   // 分隔线 / 滑轨

  // ── 文字（深底层级）──
  static readonly TEXT: string = '#F2F2F7';      // 主文字
  static readonly TEXT_2: string = '#B8B8C4';    // 次级文字
  static readonly TEXT_3: string = '#7C7C8A';    // 弱文字 / 占位

  // ── 语义色（仅此两个）──
  static readonly SUCCESS: string = '#34B46A';
  static readonly DANGER: string = '#E05646';

  // ── 旧浅色令牌保留（宪法兼容期，仅历史页回退用）──
  static readonly LIGHT_BG: string = '#F5F6F8';

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

  // ── 光感 ──
  static readonly SHADOW_CARD: string = 'rgba(0,0,0,0.35)';     // 深色页卡片阴影
  static readonly SHADOW_GLOW: string = 'rgba(232,113,44,0.35)'; // 主按钮光晕
  static readonly MASK_SCRIM: string = 'rgba(16,16,20,0.55)';    // 浮层遮罩
}
