const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataPath = path.join(root, 'data', 'articles.json');
const rawData = fs.readFileSync(dataPath, 'utf8');
const data = parseArticlesJson(rawData, dataPath);
const template = fs.readFileSync(path.join(__dirname, 'article-template.html'), 'utf8');
fs.rmSync(path.join(root, 'articles'), { recursive: true, force: true });

for (const article of data.articles || []) {
  if (!article.id || !article.path || !article.path.startsWith('/articles/')) {
    throw new Error(`Invalid article path for ${article.id || article.title || 'unknown article'}`);
  }

  const outputDirectory = path.join(root, ...article.path.split('/').filter(Boolean));
  const html = template
    .replaceAll('__ID__', escapeHtml(article.id))
    .replaceAll('__TITLE__', escapeHtml(article.title))
    .replaceAll('__DESCRIPTION__', escapeHtml(article.excerpt || article.title))
    .replaceAll('__PATH__', article.path);

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'index.html'), html);
  for (const legacyPath of article.legacyPaths || []) writeRedirect(legacyPath, article.path);
}

console.log(`Generated ${(data.articles || []).length} article pages.`);

function parseArticlesJson(raw, filePath) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    // Recover files where only the `"articles": [...]` property was pasted.
    const propertyStart = raw.lastIndexOf('"articles"');
    const arrayStart = raw.indexOf('[', propertyStart);
    const arrayEnd = findMatchingBracket(raw, arrayStart);
    if (propertyStart >= 0 && arrayStart >= 0 && arrayEnd >= 0) {
      try {
        const repaired = { articles: JSON.parse(raw.slice(arrayStart, arrayEnd + 1)) };
        fs.writeFileSync(filePath, JSON.stringify(repaired, null, 2) + '\n');
        console.warn(`Repaired malformed ${filePath}; replace the repository file with the exported JSON to keep it valid.`);
        return repaired;
      } catch (_) {
        // Fall through to the actionable error below.
      }
    }
    throw new Error(`无法解析 ${filePath}。请用导出的完整 JSON 文件覆盖它，不要把 "articles": [...] 追加到旧文件中。原始错误：${error.message}`);
  }
}

function findMatchingBracket(value, start) {
  if (start < 0) return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '[') depth += 1;
    else if (character === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function writeRedirect(legacyPath, targetPath) {
  if (!legacyPath.startsWith('/articles/') || legacyPath === targetPath) return;
  const outputDirectory = path.join(root, ...legacyPath.split('/').filter(Boolean));
  const target = escapeHtml(targetPath);
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'index.html'), `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${target}"><link rel="canonical" href="https://yidoer.github.io${target}"><title>正在跳转</title></head><body><p><a href="${target}">前往新地址</a></p><script>location.replace(${JSON.stringify(targetPath)})<\/script></body></html>`);
}
