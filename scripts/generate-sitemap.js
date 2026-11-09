const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const site = 'https://yidoer.github.io';

const articles = JSON.parse(fs.readFileSync(path.join(root, 'data', 'articles.json'), 'utf8')).articles || [];
const notes = JSON.parse(fs.readFileSync(path.join(root, 'data', 'notes.json'), 'utf8')).notes || [];

const newest = values => values
  .map(value => String(value || '').slice(0, 10))
  .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
  .sort()
  .pop();

const articleLatest = newest(articles.map(item => item.date));
const noteLatest = newest(notes.map(item => item.date));
const siteLatest = newest([articleLatest, noteLatest, '2026-09-20']);

const entries = [
  { loc: '/', lastmod: siteLatest, changefreq: 'weekly', priority: '1.0' },
  { loc: '/articles.html', lastmod: articleLatest, changefreq: 'weekly', priority: '0.8' },
  { loc: '/notes.html', lastmod: noteLatest, changefreq: 'weekly', priority: '0.8' },
  { loc: '/about.html', lastmod: siteLatest, changefreq: 'monthly', priority: '0.5' },
  { loc: '/feed.xml', lastmod: siteLatest, changefreq: 'daily', priority: '0.4' },
  { loc: '/feed-notes.xml', lastmod: noteLatest, changefreq: 'daily', priority: '0.4' },
  { loc: '/feed-atom.xml', lastmod: articleLatest, changefreq: 'weekly', priority: '0.4' },
  ...articles.map(item => ({ loc: item.path, lastmod: item.date, changefreq: 'monthly', priority: '0.7' })),
  ...notes.map(item => ({ loc: item.path, lastmod: item.date, changefreq: 'monthly', priority: '0.6' }))
];

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...entries.map(entry => [
    '  <url>',
    `    <loc>${escapeXml(site + entry.loc)}</loc>`,
    entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>` : '',
    `    <changefreq>${entry.changefreq}</changefreq>`,
    `    <priority>${entry.priority}</priority>`,
    '  </url>'
  ].filter(Boolean).join('\n')),
  '</urlset>',
  ''
].join('\n');

fs.writeFileSync(path.join(root, 'sitemap.xml'), xml);
console.log(`Generated sitemap.xml with ${entries.length} URLs.`);

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
