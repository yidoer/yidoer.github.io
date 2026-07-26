const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'notes.json'), 'utf8'));
const template = fs.readFileSync(path.join(__dirname, 'note-template.html'), 'utf8');
fs.rmSync(path.join(root, 'notes'), { recursive: true, force: true });
for (const note of data.notes || []) {
  if (!note.id || !note.date) throw new Error(`Invalid note data for ${note.id || 'unknown note'}`);
  const notePath = `/notes/${note.date.replaceAll('-', '/')}/${note.id}/`;
  const output = path.join(root, ...notePath.split('/').filter(Boolean));
  const html = template.replaceAll('__ID__', escapeHtml(note.id)).replaceAll('__DATE__', escapeHtml(note.date)).replaceAll('__DESCRIPTION__', escapeHtml(note.content || '小记'));
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'index.html'), html);
}
console.log(`Generated ${(data.notes || []).length} note pages.`);
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
