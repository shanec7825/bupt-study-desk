// Pure transformation; school HTML, names and instructions are personal content.
// Never put these values in GitHub Actions logs.
export function plainText(content, limit = 2400) {
  let value = String(content ?? "");
  value = value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?(?:p|div|li|br|h[1-6]|tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  value = value.replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : "";
    });
  return value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, limit);
}

export function mergeWorkDetails(primary, submitView) {
  // /work/detail normally contains the authoritative assignment content.
  const result = { ...(submitView || {}) };
  for (const [key, value] of Object.entries(primary || {})) {
    if (value !== null && value !== undefined && value !== "") result[key] = value;
  }
  return result;
}

export function normalizeAttachmentList(detail, metadata = []) {
  const meta = new Map();
  for (const r of metadata) {
    const id = String(r?.id || r?.storageId || "").trim();
    if (id) meta.set(id, r);
  }
  const unique = new Map();
  for (const entry of Array.isArray(detail?.assignmentResource) ? detail.assignmentResource : []) {
    const id = String(entry?.resourceId || entry?.id || "").trim();
    if (!id) continue;
    const m = meta.get(id) || {};
    const name = String(m.name || entry.resourceName || ("attachment-" + id)).trim();
    const ext = String(m.ext || "").trim();
    unique.set(id, {
      resourceId: id, name, ext,
      // Use signed links for immediate export only; never write them to Tasks.
      downloadUrl: String(m.downloadUrl || m.url || "").trim()
    });
  }
  return [...unique.values()];
}

export function normalizeHomeworkDetail(detail, attachments) {
  const instructions = plainText(detail?.assignmentContent, 3500);
  const teacherComment = plainText(detail?.assignmentComment, 1000);
  const className = plainText(detail?.className, 180);
  const chapter = plainText(detail?.chapterName, 180);
  return {
    assignmentId: String(detail?.id || detail?.assignmentId || ""),
    title: String(detail?.assignmentTitle || detail?.title || ""),
    siteId: String(detail?.siteId || detail?.courseInfo?.id || ""),
    siteName: String(detail?.siteName || detail?.courseInfo?.name || ""),
    instructions, teacherComment, className, chapter,
    deadline: String(detail?.assignmentEndTime || detail?.endTime || ""),
    attachments
  };
}

export function detailsForGoogle(detail) {
  if (!detail) return "";
  const lines = [];
  if (detail.instructions) lines.push("作业要求：\n" + detail.instructions.slice(0, 2500));
  if (detail.teacherComment) lines.push("教师说明：\n" + detail.teacherComment.slice(0, 550));
  if (detail.attachments?.length) {
    const names = detail.attachments.slice(0, 20).map(a => "• " + a.name).join("\n");
    lines.push("附件（前往教学云下载）：\n" + names);
  }
  return lines.join("\n\n").slice(0, 3700);
}

export const DETAIL_BEGIN = "[BUPT_DETAIL_BEGIN]";
export const DETAIL_END = "[BUPT_DETAIL_END]";
export function mergeGeneratedTaskNotes(original, detailText) {
  const old = String(original || "");
  if (!detailText) return old;
  const block = DETAIL_BEGIN + "\n" + detailText + "\n" + DETAIL_END;
  const s = old.indexOf(DETAIL_BEGIN);
  const e = old.indexOf(DETAIL_END);
  if (s >= 0 && e > s) return old.slice(0, s) + block + old.slice(e + DETAIL_END.length);
  return old + "\n\n" + block;
}

export function safeAttachmentUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    const suffixes = [
      "bupt.edu.cn", "aliyuncs.com", "myqcloud.com", "qcloud.com",
      "ksyuncs.com", "volces.com"
    ];
    if (!suffixes.some(d => host === d || host.endsWith("." + d))) return null;
    if (url.port && url.port !== "443") return null;
    return url;
  } catch { return null; }
}

export function safeAttachmentName(name, fallback = "attachment") {
  const text = String(name || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/^\.+/, "").trim().slice(0, 100);
  return text || fallback;
}
