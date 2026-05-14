import path from 'node:path';

const MD_IMAGE_RE = /(!\[)([^\]]*)(\]\(\s*)(<[^>]+>|[^)\r\n]+?)(\s*(?:"[^"]*")?\s*\))/g;
const MD_LINK_RE = /(?<!!)(\[)([^\]]*)(\]\(\s*)(<[^>]+>|[^)\r\n]+?)(\s*(?:"[^"]*")?\s*\))/g;
const HTML_IMG_RE = /(<img\b[^>]*?\bsrc=)("([^"]*)"|'([^']*)')([^>]*>)/gi;

function unwrapAngle(u) {
  if (u.length >= 2 && u.startsWith('<') && u.endsWith('>')) {
    return u.slice(1, -1);
  }
  return u;
}

function safeDecode(u) {
  try {
    return decodeURI(u);
  } catch {
    return u;
  }
}

function urlBaseName(rawUrl) {
  const cleaned = rawUrl.split('#')[0].split('?')[0];
  const decoded = safeDecode(cleaned);
  return decoded.split(/[\\/]/).pop() || '';
}

function stripExt(name) {
  const dotIdx = name.lastIndexOf('.');
  return dotIdx > 0 ? name.slice(0, dotIdx) : name;
}

/**
 * 判定 markdown 图片的 alt 是否与 URL 的最后一段文件名一致：
 * - 同时支持「带扩展名」与「去掉扩展名」两种写法
 * - alt 为空、或与文件名不一致时返回 false，意味着用户已经定制过命名
 */
export function altMatchesUrl(alt, rawUrl) {
  if (typeof alt !== 'string') return false;
  const a = alt.trim();
  if (!a) return false;
  const base = urlBaseName(rawUrl);
  if (!base) return false;
  return a === base || a === stripExt(base);
}

/**
 * 根据「旧 URL → 新 URL」的关系推导新的 alt：
 * - 若旧 alt 与旧 URL 文件名一致（默认命名），同步替换为新 URL 的文件名
 *   并保持原来「带扩展名 / 不带扩展名」的写法
 * - 否则视为用户自定义命名，原样返回 alt
 */
export function deriveNewAlt(alt, rawOldUrl, newUrl) {
  if (typeof alt !== 'string') return alt;
  const a = alt.trim();
  if (!a) return alt;
  const oldBase = urlBaseName(rawOldUrl);
  if (!oldBase) return alt;
  const newBase = urlBaseName(newUrl);
  if (a === oldBase) return newBase;
  if (a === stripExt(oldBase)) return stripExt(newBase);
  return alt;
}

export function findResources(markdown) {
  const items = [];
  for (const m of markdown.matchAll(MD_IMAGE_RE)) {
    items.push({
      kind: 'md-image',
      raw: unwrapAngle(m[4]),
      alt: m[2] ?? '',
    });
  }
  for (const m of markdown.matchAll(HTML_IMG_RE)) {
    items.push({ kind: 'html-image', raw: m[3] ?? m[4] ?? '' });
  }
  for (const m of markdown.matchAll(MD_LINK_RE)) {
    items.push({
      kind: 'md-link',
      raw: unwrapAngle(m[4]),
      text: m[2] ?? '',
    });
  }
  return items;
}

export function classifyResource(raw, baseDir, publicDomain) {
  if (!raw) return { kind: 'invalid', raw };

  if (raw.startsWith('data:') || raw.startsWith('blob:')) {
    return { kind: 'inline-skip', raw };
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    if (
      publicDomain &&
      (raw === publicDomain || raw.startsWith(`${publicDomain}/`))
    ) {
      return { kind: 'cdn-skip', raw };
    }
    return { kind: 'remote-skip', raw };
  }

  if (raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) {
    return { kind: 'anchor-skip', raw };
  }

  const cleaned = raw.split('#')[0].split('?')[0];
  if (!cleaned) return { kind: 'invalid', raw };

  const decoded = safeDecode(cleaned);
  const absolutePath = path.isAbsolute(decoded)
    ? decoded
    : path.resolve(baseDir, decoded);

  return { kind: 'local', raw, absolutePath };
}

export function replaceResources(markdown, mapping) {
  if (mapping.size === 0) return markdown;

  let out = markdown.replace(
    MD_IMAGE_RE,
    (match, lead, alt, midOpen, urlToken, tail) => {
      const raw = unwrapAngle(urlToken);
      if (!mapping.has(raw)) return match;
      const newUrl = mapping.get(raw);
      // URL 始终替换；alt 仅在原来是「默认命名」时同步更新，否则保留用户自定义
      const newAlt = deriveNewAlt(alt, raw, newUrl);
      return `${lead}${newAlt}${midOpen}${newUrl}${tail}`;
    }
  );

  out = out.replace(HTML_IMG_RE, (match, head, _full, dq, sq, tail) => {
    const raw = dq ?? sq ?? '';
    if (!mapping.has(raw)) return match;
    const quote = dq != null ? '"' : "'";
    return `${head}${quote}${mapping.get(raw)}${quote}${tail}`;
  });

  out = out.replace(
    MD_LINK_RE,
    (match, lead, text, midOpen, urlToken, tail) => {
      const raw = unwrapAngle(urlToken);
      if (!mapping.has(raw)) return match;
      return `${lead}${text}${midOpen}${mapping.get(raw)}${tail}`;
    }
  );

  return out;
}
