/**
 * 校验生成的订阅源
 * 运行：node scripts/check-feeds.js
 *
 * 检查 XML 良构性、必需字段、绝对地址、时间倒序。
 * 纯 Node 实现，不依赖第三方包，CI 与本地行为一致。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SITE = 'https://yidoer.github.io';

let failures = 0;
const fail = message => {
  console.log(`FAIL  ${message}`);
  failures += 1;
};

/**
 * 简易 XML 良构性检查：校验标签配对、属性引号、非法裸 & 字符。
 * 忽略 XML 声明、注释与 CDATA 内部内容。
 * 标签之间的文本内容是合法的，只有在根元素之外出现文本才算错。
 */
function checkWellFormed(xml, file) {
  // 抽出 CDATA 与注释，避免其中的 HTML 干扰标签扫描
  const cdataBlocks = [];
  let scan = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (match, inner) => {
    cdataBlocks.push(inner);
    return `\u0000CDATA${cdataBlocks.length - 1}\u0000`;
  });
  scan = scan.replace(/<!--[\s\S]*?-->/g, '');

  // XML 声明必须在最前面且只出现一次
  const declMatch = scan.match(/^<\?xml[^?]*\?>/);
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) fail(`${file} XML 声明缺失或不在首行`);
  if ((xml.match(/<\?xml/g) || []).length !== 1) fail(`${file} XML 声明重复`);
  if (declMatch) scan = scan.slice(declMatch[0].length);

  // 裸 & 只能是实体或数字引用
  const badAmp = scan.match(/&(?!(?:[A-Za-z][A-Za-z0-9]*|#\d+|#x[0-9A-Fa-f]+);)/g);
  if (badAmp) fail(`${file} 存在未转义的 & 字符（${badAmp.length} 处）`);

  // 处理处理指令（如 <?xml-stylesheet?>）后只保留标签与文本
  scan = scan.replace(/<\?[\s\S]*?\?>/g, '');

  const stack = [];
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let match;
  let lastIndex = 0;
  let rootClosed = false;

  while ((match = tagRe.exec(scan)) !== null) {
    const [full, closing, name, attrs, selfClose] = match;

    // 只检查根元素之外的游离文本
    const between = scan.slice(lastIndex, match.index).replace(/\u0000CDATA\d+\u0000/g, '');
    if (between.trim()) {
      if (stack.length === 0) {
        fail(`${file} 在 <${name}> 前存在根元素之外的游离文本: ${JSON.stringify(between.trim().slice(0, 40))}`);
      }
    }
    lastIndex = match.index + full.length;

    // 属性必须成对带引号
    if (attrs.trim()) {
      const stripped = attrs.replace(/[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*')/g, '').trim();
      if (stripped) fail(`${file} <${name}> 属性格式异常: ${JSON.stringify(stripped)}`);
    }

    if (selfClose) {
      if (stack.length === 0) rootClosed = true;
      continue;
    }

    if (closing) {
      const top = stack.pop();
      if (top !== name) {
        fail(`${file} 标签不匹配：</${name}> 对应的是 <${top}>`);
        return;
      }
      if (stack.length === 0) rootClosed = true;
    } else {
      if (rootClosed) fail(`${file} 根元素之后又出现 <${name}>，XML 只能有一个根元素`);
      stack.push(name);
    }
  }

  if (stack.length) fail(`${file} 存在未闭合标签: ${stack.join(', ')}`);
  const tail = scan.slice(lastIndex).replace(/\u0000CDATA\d+\u0000/g, '').trim();
  if (tail) fail(`${file} 根元素之后存在多余内容`);
}

const decodeEntities = text => String(text)
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
  .replace(/&#x([0-9A-Fa-f]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

const pick = (block, re) => {
  const m = block.match(re);
  return m ? m[1] : null;
};

function checkRss(file, expectMin) {
  console.log(`===== ${file} =====`);
  const full = path.join(root, file);
  if (!fs.existsSync(full)) { fail(`${file} 不存在`); return; }
  const xml = fs.readFileSync(full, 'utf8');

  checkWellFormed(xml, file);
  if (!/<rss version="2\.0"/.test(xml)) fail(`${file} 根元素不是 RSS 2.0`);

  const channel = pick(xml, /<channel>([\s\S]*)<\/channel>/);
  if (!channel) { fail(`${file} 缺少 channel`); return; }
  for (const field of ['title', 'link', 'description', 'language', 'lastBuildDate']) {
    if (!new RegExp(`<${field}>[^<]+</${field}>`).test(channel)) fail(`${file} channel 缺少 ${field}`);
  }
  if (!/<atom:link[^>]*rel="self"/.test(channel)) fail(`${file} 缺少 atom:link rel=self`);

  const items = xml.split('<item>').slice(1).map(block => block.split('</item>')[0]);
  console.log(`  条目数: ${items.length}`);
  if (items.length < expectMin) fail(`${file} 条目数少于预期`);

  const dates = [];
  items.forEach((item, i) => {
    const n = i + 1;
    for (const field of ['title', 'link', 'guid', 'pubDate', 'description']) {
      if (!pick(item, new RegExp(`<${field}[^>]*>([\\s\\S]*?)</${field}>`))) fail(`${file} 第 ${n} 条缺少 ${field}`);
    }
    const link = pick(item, /<link>([^<]+)<\/link>/);
    if (link && !link.startsWith(SITE)) fail(`${file} 第 ${n} 条 link 不是本站绝对地址: ${link}`);

    const pub = pick(item, /<pubDate>([^<]+)<\/pubDate>/);
    if (pub) {
      const time = new Date(pub);
      if (Number.isNaN(time.getTime())) fail(`${file} 第 ${n} 条 pubDate 无法解析: ${pub}`);
      else dates.push(time);
    }

    const encoded = pick(item, /<content:encoded>([\s\S]*?)<\/content:encoded>/);
    if (!encoded) fail(`${file} 第 ${n} 条缺少 content:encoded`);
    else {
      const html = decodeEntities(encoded.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''));
      if (!html.trim()) fail(`${file} 第 ${n} 条正文为空`);
      if (/(?:src|href)="\//.test(html)) fail(`${file} 第 ${n} 条正文含未转绝对地址的相对链接`);
      if (/<p>\s*<\/(?:ul|ol|blockquote|table)>/.test(html)) fail(`${file} 第 ${n} 条正文有非法空块`);
    }
  });

  for (let i = 1; i < dates.length; i += 1) {
    if (dates[i] > dates[i - 1]) fail(`${file} 第 ${i + 1} 条时间晚于上一条，未按倒序排列`);
  }

  console.log(`  大小: ${Buffer.byteLength(xml)} bytes`);
}

function checkAtom(file, expectMin) {
  console.log(`===== ${file} =====`);
  const full = path.join(root, file);
  if (!fs.existsSync(full)) { fail(`${file} 不存在`); return; }
  const xml = fs.readFileSync(full, 'utf8');

  checkWellFormed(xml, file);
  if (!/<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/.test(xml)) fail(`${file} 根元素不是 Atom feed`);

  for (const field of ['title', 'id', 'updated']) {
    if (!new RegExp(`<${field}[^>]*>[^<]+</${field}>`).test(xml)) fail(`${file} feed 缺少 ${field}`);
  }
  if (!/<link[^>]*rel="self"/.test(xml)) fail(`${file} 缺少 rel=self 链接`);
  if (!/<author>\s*<name>[^<]+<\/name>\s*<\/author>/.test(xml)) fail(`${file} 缺少 author`);

  const entries = xml.split('<entry>').slice(1).map(block => block.split('</entry>')[0]);
  console.log(`  条目数: ${entries.length}`);
  if (entries.length < expectMin) fail(`${file} 条目数少于预期`);

  const dates = [];
  entries.forEach((entry, i) => {
    const n = i + 1;
    for (const field of ['title', 'id', 'published', 'updated']) {
      if (!pick(entry, new RegExp(`<${field}>([^<]+)</${field}>`))) fail(`${file} 第 ${n} 条缺少 ${field}`);
    }
    const link = pick(entry, /<link href="([^"]+)"/);
    if (!link) fail(`${file} 第 ${n} 条缺少 link`);
    else if (!link.startsWith(SITE)) fail(`${file} 第 ${n} 条 link 不是本站绝对地址: ${link}`);

    const content = pick(entry, /<content type="html">([\s\S]*?)<\/content>/);
    if (!content) fail(`${file} 第 ${n} 条缺少 content type=html`);
    else {
      const html = decodeEntities(content);
      if (!/<[a-z]/.test(html)) fail(`${file} 第 ${n} 条 content 不是 HTML`);
      if (/(?:src|href)="\//.test(html)) fail(`${file} 第 ${n} 条正文含未转绝对地址的相对链接`);
    }

    const pub = pick(entry, /<published>([^<]+)<\/published>/);
    if (pub) {
      const time = new Date(pub);
      if (Number.isNaN(time.getTime())) fail(`${file} 第 ${n} 条 published 无法解析: ${pub}`);
      else dates.push(time);
    }
  });

  for (let i = 1; i < dates.length; i += 1) {
    if (dates[i] > dates[i - 1]) fail(`${file} 第 ${i + 1} 条时间晚于上一条，未按倒序排列`);
  }

  console.log(`  大小: ${Buffer.byteLength(xml)} bytes`);
}

checkRss('feed.xml', 1);
checkRss('feed-notes.xml', 1);
checkAtom('feed-atom.xml', 1);

console.log('');
console.log(failures === 0 ? '订阅源校验通过。' : `发现 ${failures} 个问题。`);
process.exit(failures === 0 ? 0 : 1);
