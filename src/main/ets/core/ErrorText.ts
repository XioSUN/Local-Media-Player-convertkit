/**
 * ErrorText — 健壮错误文本提取（bug 看护，见 docs/TEST-GUARDS.md #1）。
 * 历史根因：设备 API（如 zlib.unzipFile）抛出的 BusinessError 可能只有 code
 * 没有 message，UI 直接渲染得到 "undefined"/"TypeError: …length…"。
 * 不变式：任何输入（undefined/null/BusinessError/Error/字符串/空对象）都产出
 * 非空中文可读文本。
 */
export function errText(e: unknown | null | undefined): string {
  if (e === undefined || e === null) {
    return '未知错误';
  }
  const maybe = e as Record<string, Object | undefined>;
  const msg = maybe['message'];
  if (typeof msg === 'string' && msg.length > 0) {
    return msg;
  }
  const code = maybe['code'];
  if (typeof code === 'string' || typeof code === 'number') {
    return `错误码 ${String(code)}`;
  }
  return String(e);
}
