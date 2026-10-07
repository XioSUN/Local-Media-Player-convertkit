/**
 * PdfMerge — 多份简单结构 PDF → 一份（纯逻辑，v3）。
 *
 * 适用面：无 ObjStm / 无加密 / 间接引用均为 "N 0 R" 的 PDF
 * （覆盖自产 PdfWriter 输出与多数常规生成器产物）。
 * 机制：逐份解析对象表 → 统一重编号（映射替换所有 "old 0 R" 引用）
 * → 各文档根 Pages 挂 /Parent 指向新顶层 Pages（Kids 汇总）
 * → 重写 xref/trailer。不支持的输入抛可读错误（宪法第六条错误出口）。
 */

interface PdfObject {
  num: number;
  body: string; // 不含 "N 0 obj" 头与 "endobj"
}

interface ParsedPdf {
  objects: PdfObject[];
  rootPagesNum: number; // 文档根 Pages 对象号（原编号）
  pageCount: number;
}

function findAllObjects(bytes: Uint8Array): PdfObject[] {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  const out: PdfObject[] = [];
  if (s.includes('/ObjStm')) {
    throw new Error('该 PDF 使用对象流（ObjStm），暂不支持合并');
  }
  if (s.includes('/Encrypt')) {
    throw new Error('该 PDF 已加密，暂不支持合并');
  }
  const re = /(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push({ num: parseInt(m[1], 10), body: m[2] });
  }
  return out;
}

function parseSingle(bytes: Uint8Array): ParsedPdf {
  const objects = findAllObjects(bytes);
  if (objects.length === 0) {
    throw new Error('未找到 PDF 对象（文件可能损坏）');
  }
  let rootPagesNum = -1;
  let pageCount = 0;
  for (const obj of objects) {
    if (/\/Type\s*\/Pages\b/.test(obj.body) && /\/Kids/.test(obj.body)) {
      const kidsCount = /\/Count\s+(\d+)/.exec(obj.body);
      // 根 Pages = 无 /Parent 的 Pages 节点
      if (!/\/Parent/.test(obj.body)) {
        rootPagesNum = obj.num;
        pageCount = kidsCount !== null ? parseInt(kidsCount[1], 10) : 1;
        break;
      }
    }
  }
  if (rootPagesNum < 0) {
    throw new Error('未找到根页面树（非常规 PDF 结构）');
  }
  return { objects, rootPagesNum, pageCount };
}

export function mergePdfs(inputs: Uint8Array[]): Uint8Array {
  if (inputs.length < 2) {
    throw new Error('合并至少需要两份 PDF');
  }
  const parsed: ParsedPdf[] = [];
  for (const b of inputs) {
    parsed.push(parseSingle(b));
  }

  // 统一重编号：1..N（跨文档顺序分配）
  let next = 1;
  const renumber: Array<Map<number, number>> = [];
  for (const doc of parsed) {
    const map = new Map<number, number>();
    for (const obj of doc.objects) {
      map.set(obj.num, next);
      next += 1;
    }
    renumber.push(map);
  }
  const newPagesNum = next;
  const newCatalogNum = next + 1;

  const parts: string[] = ['%PDF-1.5\n'];
  const xrefOffsets: number[] = [0]; // obj 编号从 1 起
  let pos = parts[0].length;
  const totalObjects = newCatalogNum;

  const emit = (num: number, body: string): void => {
    const chunk = `${num} 0 obj\n${body}\nendobj\n`;
    xrefOffsets[num] = pos;
    pos += chunk.length;
    parts.push(chunk);
  };

  for (let d = 0; d < parsed.length; d++) {
    const doc = parsed[d];
    const map = renumber[d];
    for (const obj of doc.objects) {
      // 替换所有间接引用 + 对象自身编号；根 Pages 注入 /Parent
      let body = obj.body.replace(/(\d+)\s+0\s+R\b/g, (whole: string, n: string): string => {
        const mapped = map.get(parseInt(n, 10));
        return mapped !== undefined ? `${mapped} 0 R` : whole;
      });
      if (obj.num === doc.rootPagesNum) {
        body = body.replace(/<<\s*/, `<< /Parent ${newPagesNum} 0 R `);
      }
      emit(map.get(obj.num) as number, body);
    }
  }

  const kids: string[] = [];
  let count = 0;
  for (let d = 0; d < parsed.length; d++) {
    kids.push(`${renumber[d].get(parsed[d].rootPagesNum) as number} 0 R`);
    count += parsed[d].pageCount;
  }
  emit(newPagesNum, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>`);
  emit(newCatalogNum, `<< /Type /Catalog /Pages ${newPagesNum} 0 R >>`);

  const xrefPos = pos;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjects; i++) {
    const off = xrefOffsets[i];
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  parts.push(`${xref}trailer\n<< /Size ${totalObjects + 1} /Root ${newCatalogNum} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  let out = '';
  for (const p of parts) {
    out += p;
  }
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) {
    bytes[i] = out.charCodeAt(i) & 0xff;
  }
  return bytes;
}
