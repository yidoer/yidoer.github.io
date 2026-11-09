/**
 * 数据文件校验：在 CI 中拦下会让站点静默崩掉的错误数据。
 * 运行：node scripts/validate-data.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const problems = [];

function loadJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    problems.push(`${relativePath}：文件不存在`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (error) {
    problems.push(`${relativePath}：JSON 解析失败 — ${error.message}`);
    return null;
  }
}

function checkCollection(name, prefix, items, requiredFields) {
  const seenIds = new Set();
  const seenPaths = new Set();

  items.forEach((item, index) => {
    const label = `${name}[${index}]${item && item.id ? ` (${item.id})` : ''}`;

    for (const field of requiredFields) {
      if (!item || item[field] === undefined || item[field] === null || item[field] === '') {
        problems.push(`${label}：缺少必填字段 ${field}`);
      }
    }

    if (!item) return;

    if (item.id) {
      if (seenIds.has(item.id)) problems.push(`${label}：id 重复`);
      seenIds.add(item.id);
    }

    if (item.path) {
      if (!item.path.startsWith(prefix)) {
        problems.push(`${label}：path 必须以 ${prefix} 开头，实际为 ${item.path}`);
      }
      if (seenPaths.has(item.path)) problems.push(`${label}：path 重复 — ${item.path}`);
      seenPaths.add(item.path);
    }

    if (item.date && !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
      problems.push(`${label}：date 应为 YYYY-MM-DD，实际为 ${item.date}`);
    }

    if (item.legacyPaths) {
      for (const legacy of item.legacyPaths) {
        if (!legacy.startsWith(prefix)) {
          problems.push(`${label}：legacyPaths 必须以 ${prefix} 开头 — ${legacy}`);
        }
        if (legacy === item.path) {
          problems.push(`${label}：legacyPaths 与 path 相同 — ${legacy}`);
        }
      }
    }
  });
}

const articleData = loadJson('data/articles.json');
if (articleData) {
  if (!Array.isArray(articleData.articles)) {
    problems.push('data/articles.json：缺少 articles 数组');
  } else {
    checkCollection('articles', '/articles/', articleData.articles, ['id', 'path', 'title', 'date']);
  }
}

const noteData = loadJson('data/notes.json');
if (noteData) {
  if (!Array.isArray(noteData.notes)) {
    problems.push('data/notes.json：缺少 notes 数组');
  } else {
    checkCollection('notes', '/notes/', noteData.notes, ['id', 'path', 'content', 'date']);
  }
}

if (problems.length > 0) {
  console.error(`数据校验失败，共 ${problems.length} 个问题：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('数据校验通过。');
