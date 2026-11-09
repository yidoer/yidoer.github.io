/**
 * 用 Playwright 检查每个页面的控制台报错与关键渲染结果
 * 用法：node scripts/check-pages.js
 * 需要先启动 scripts/serve.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8899';
const ROOT = path.join(__dirname, '..');

// 详情页由生成脚本产出，数量随内容增长，故按目录实际存在的情况动态收集
function collectDetailPages(dir, check) {
  const found = [];
  const walk = current => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some(e => e.isFile() && e.name === 'index.html')) {
      const rel = path.relative(ROOT, current).split(path.sep).join('/');
      found.push({ path: '/' + rel + '/index.html', check });
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(current, entry.name));
    }
  };
  walk(path.join(ROOT, dir));
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

const PAGES = [
  { path: '/index.html', check: 'article/note 列表' },
  { path: '/articles.html', check: '文章列表' },
  { path: '/notes.html', check: '小记列表' },
  { path: '/about.html', check: '关于页' },
  { path: '/404.html', check: '404 页' },
  { path: '/editor.html', check: '编辑器' },
  { path: '/mobile-editor.html', check: '手机编辑器' },
  ...collectDetailPages('articles', '文章详情'),
  ...collectDetailPages('notes', '小记详情')
];

(async () => {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    console.error('无法启动浏览器：', error.message);
    process.exit(2);
  }

  let failures = 0;

  for (const page of PAGES) {
    const tab = await browser.newPage();
    const problems = [];

    tab.on('console', message => {
      if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    });
    tab.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
    tab.on('requestfailed', request => {
      // 头像等第三方/可选资源失败不算致命，这里只记录同源请求
      if (request.url().startsWith(BASE)) problems.push(`requestfailed: ${request.url()}`);
    });

    try {
      const response = await tab.goto(BASE + page.path, { waitUntil: 'networkidle', timeout: 20000 });
      if (!response || !response.ok()) problems.push(`HTTP ${response ? response.status() : '无响应'}`);
    } catch (error) {
      problems.push(`导航失败: ${error.message}`);
    }

    const info = await tab.evaluate(() => ({
      title: document.title,
      theme: document.documentElement.getAttribute('data-theme'),
      hasFooter: !!document.querySelector('.site-footer'),
      rssLinks: document.querySelectorAll('a[href*="feed"]').length,
      headAlternates: document.querySelectorAll('link[rel="alternate"]').length,
      // 检查是否存在非法的 <p> 嵌套块级元素
      badParagraphs: document.querySelectorAll('p > ul, p > ol, p > blockquote, p > table').length,
      contentLength: (document.body.innerText || '').length
    }));

    const status = problems.length === 0 ? 'OK  ' : 'FAIL';
    if (problems.length) failures += 1;
    console.log(`${status}  ${page.path.padEnd(42)} ${page.check}`);
    console.log(`      title=${JSON.stringify(info.title)} theme=${info.theme} rss=${info.rssLinks} alternates=${info.headAlternates} 正文长度=${info.contentLength}`);
    if (info.badParagraphs) {
      console.log(`      非法 <p> 嵌套: ${info.badParagraphs} 处`);
      failures += 1;
    }
    for (const problem of problems) console.log(`      ${problem}`);

    await tab.close();
  }

  await browser.close();
  console.log('');
  console.log(failures === 0 ? '所有页面检查通过。' : `${failures} 个页面存在问题。`);
  process.exit(failures === 0 ? 0 : 1);
})();
