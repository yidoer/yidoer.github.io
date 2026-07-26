const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'notes.json'), 'utf8'));
const template = fs.readFileSync(path.join(__dirname, 'note-template.html'), 'utf8');
fs.rmSync(path.join(root, 'notes'), { recursive: true, force: true });
for (const note of data.notes || []) {
  if (!note.id || !note.path || !note.path.startsWith('/notes/')) throw new Error(`Invalid note data for ${note.id || 'unknown note'}`);
  const notePath = note.path.endsWith('/') ? note.path : `${note.path}/`;
  const output = path.join(root, ...notePath.split('/').filter(Boolean));
  const html = template.replaceAll('__ID__', escapeHtml(note.id)).replaceAll('__DATE__', escapeHtml(note.date)).replaceAll('__DESCRIPTION__', escapeHtml(note.content || '小记')).replaceAll('__PATH__', notePath);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'index.html'), html);
  for (const legacyPath of note.legacyPaths || []) writeRedirect(legacyPath, notePath);
}
console.log(`Generated ${(data.notes || []).length} note pages.`);
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
function writeRedirect(legacyPath, targetPath) {
  if (!legacyPath.startsWith('/notes/') || legacyPath === targetPath) return;
  const output = path.join(root, ...legacyPath.split('/').filter(Boolean));
  const target = escapeHtml(targetPath);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'index.html'), `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${target}"><link rel="canonical" href="https://yidoer.github.io${target}"><title>正在跳转</title></head><body><p><a href="${target}">前往新地址</a></p><script>location.replace(${JSON.stringify(targetPath)})<\/script></body></html>`);
}
