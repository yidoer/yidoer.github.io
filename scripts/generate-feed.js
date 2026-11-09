/**
 * 生成 RSS 2.0 + Atom 订阅源
 * 运行：node scripts/generate-feed.js
 *
 * 输出：
 *   /feed.xml      完整的 RSS 2.0（文章 + 小记，含正文 HTML）
 *   /feed-notes.xml  仅小记
 *   /feed-atom.xml   仅文章（Atom 1.0）
 *
 * 正文 HTML 由 js/markdown.js 渲染，与网页端完全一致。
 */
const fs = require('fs');
const path = require('path');
const Markdown = require(path.join(__dirname, '..', 'js', 'markdown.js'));

const root = path.resolve(__dirname, '..');
const SITE = 'https://yidoer.github.io';
const SITE_TITLE = '人间浊物 琅上清书';
const SITE_DESC = '个人博客 — 长篇大论与片言只语。';
const AUTHOR = '人间浊物';
const MAX_ITEMS = 30;

const articles = readCollection('data/articles.json', 'articles');
const notes = readCollection('data/notes.json', 'notes');

// ---------- 统一成 feed item ----------
function toArticleItem(article) {
  const url = SITE + article.path;
  return {
    title: article.title || '无题',
    link: url,
    guid: article.id || url,
    date: parseDate(article.date),
    // 文章列表里的摘要可能为空，退回用正文生成
    summary: article.excerpt || excerptFrom(article.content, 160),
    contentHtml: Markdown.parse(article.content || ''),
    categories: [article.category, ...(article.tags || [])].filter(Boolean),
    kind: 'article'
  };
}

function toNoteItem(note) {
  const url = SITE + note.path;
  const raw = note.content || '';
  // 小记本身没有标题，用正文首句做标题；取到第一个句末标点，读起来才完整
  return {
    title: `小记 · ${noteTitleFrom(raw)}`,
    link: url,
    guid: note.id || url,
    date: parseDate(note.date),
    summary: excerptFrom(raw, 160),
    contentHtml: Markdown.parse(raw),
    categories: ['小记'],
    kind: 'note'
  };
}

function noteTitleFrom(text) {
  const plain = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '无题';
  // 优先在句末标点处断开；没有标点再按字数截断
  const sentence = plain.match(/^[^。！？!?]{1,40}[。！？!?]/);
  if (sentence) return sentence[0];
  return plain.length > 30 ? `${plain.slice(0, 30)}…` : plain;
}

function readCollection(relativePath, key) {
  const full = path.join(root, relativePath);
  if (!fs.existsSync(full)) {
    console.warn(`跳过 ${relativePath}（文件不存在）`);
    return [];
  }
  const data = JSON.parse(fs.readFileSync(full, 'utf8'));
  return data[key] || [];
}

function parseDate(value) {
  // 只有日期没有时间时，固定按 UTC 中午处理，避免时区导致日期前后跳一天
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return new Date(`${value}T12:00:00Z`);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function excerptFrom(text, length) {
  const plain = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > length ? `${plain.slice(0, length)}…` : plain;
}

function absoluteUrls(html) {
  // feed 里的相对路径在阅读器中会失效，统一补成绝对地址
  return String(html)
    .replace(/(<img\b[^>]*\bsrc=")\/(?!\/)/g, `$1${SITE}/`)
    .replace(/(<a\b[^>]*\bhref=")\/(?!\/)/g, `$1${SITE}/`);
}

// ---------- XML 工具 ----------
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cdata(value) {
  // CDATA 内不能出现 "]]>"，拆开拼接是标准做法
  return `<![CDATA[${String(value ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

const rfc822 = date => date.toUTCString();
const iso8601 = date => date.toISOString();

// ---------- RSS 2.0 ----------
function buildRss(items, { title, description, selfPath, link }) {
  const latest = items.length ? items[0].date : new Date();
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '  <channel>',
    `    <title>${esc(title)}</title>`,
    `    <link>${esc(link)}</link>`,
    `    <description>${esc(description)}</description>`,
    '    <language>zh-CN</language>',
    `    <lastBuildDate>${rfc822(latest)}</lastBuildDate>`,
    `    <managingEditor>${esc(AUTHOR)}</managingEditor>`,
    `    <webMaster>${esc(AUTHOR)}</webMaster>`,
    `    <atom:link href="${esc(SITE + selfPath)}" rel="self" type="application/rss+xml"/>`
  ];

  for (const item of items) {
    lines.push(
      '    <item>',
      `      <title>${esc(item.title)}</title>`,
      `      <link>${esc(item.link)}</link>`,
      `      <guid isPermaLink="false">${esc(item.guid)}</guid>`,
      `      <pubDate>${rfc822(item.date)}</pubDate>`,
      `      <description>${esc(item.summary)}</description>`,
      `      <content:encoded>${cdata(absoluteUrls(item.contentHtml))}</content:encoded>`,
      ...item.categories.map(category => `      <category>${esc(category)}</category>`),
      '    </item>'
    );
  }

  lines.push('  </channel>', '</rss>', '');
  return lines.join('\n');
}

// ---------- Atom 1.0 ----------
function buildAtom(items, { title, description, selfPath, link }) {
  const latest = items.length ? items[0].date : new Date();
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${esc(title)}</title>`,
    `  <subtitle>${esc(description)}</subtitle>`,
    `  <link href="${esc(link)}"/>`,
    `  <link href="${esc(SITE + selfPath)}" rel="self" type="application/atom+xml"/>`,
    `  <id>${esc(SITE + '/')}</id>`,
    `  <updated>${iso8601(latest)}</updated>`,
    `  <author><name>${esc(AUTHOR)}</name></author>`
  ];

  for (const item of items) {
    lines.push(
      '  <entry>',
      `    <title>${esc(item.title)}</title>`,
      `    <link href="${esc(item.link)}"/>`,
      `    <id>${esc(item.guid)}</id>`,
      `    <published>${iso8601(item.date)}</published>`,
      `    <updated>${iso8601(item.date)}</updated>`,
      `    <summary>${esc(item.summary)}</summary>`,
      `    <content type="html">${esc(absoluteUrls(item.contentHtml))}</content>`,
      ...item.categories.map(category => `    <category term="${esc(category)}"/>`),
      '  </entry>'
    );
  }

  lines.push('</feed>', '');
  return lines.join('\n');
}

// ---------- 组合并输出 ----------
// 订阅源必须按时间倒序，最新一条在最前面，否则阅读器里顺序是乱的。
const newestFirst = items => [...items].sort((a, b) => b.date - a.date).slice(0, MAX_ITEMS);

const articleItems = newestFirst(articles.map(toArticleItem));
const noteItems = newestFirst(notes.map(toNoteItem));
const allItems = newestFirst([...articleItems, ...noteItems]);

const outputs = [
  ['feed.xml', buildRss(allItems, {
    title: SITE_TITLE,
    description: SITE_DESC,
    selfPath: '/feed.xml',
    link: `${SITE}/`
  })],
  ['feed-notes.xml', buildRss(noteItems, {
    title: `${SITE_TITLE} · 小记`,
    description: '片言只语，随感随记。',
    selfPath: '/feed-notes.xml',
    link: `${SITE}/notes.html`
  })],
  ['feed-atom.xml', buildAtom(articleItems, {
    title: `${SITE_TITLE} · 文章`,
    description: '长篇大论，慎思而著。',
    selfPath: '/feed-atom.xml',
    link: `${SITE}/articles.html`
  })]
];

for (const [filename, content] of outputs) {
  fs.writeFileSync(path.join(root, filename), content);
  console.log(`Generated ${filename} (${Buffer.byteLength(content)} bytes)`);
}

console.log(`共 ${allItems.length} 条：文章 ${articleItems.length}，小记 ${noteItems.length}`);
