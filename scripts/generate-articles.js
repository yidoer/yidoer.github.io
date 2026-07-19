const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'articles.json'), 'utf8'));
const template = fs.readFileSync(path.join(__dirname, 'article-template.html'), 'utf8');

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
}

console.log(`Generated ${(data.articles || []).length} article pages.`);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
