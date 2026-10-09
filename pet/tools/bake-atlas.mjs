// Bake the crab's sprite atlas with a real GPU. Headful Chrome only: headless never yields a
// WebGPU adapter on this machine.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, outFile, size = '440'] = process.argv.slice(2);
const port = 9334;
const profile = mkdtempSync(join(tmpdir(), 'bake-'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu',
  '--window-size=900,900',
  '--no-sandbox',
  'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const main = async () => {
  let ver = null;
  for (let i = 0; i < 80 && !ver; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) ver = await r.json(); } catch {}
    if (!ver) await sleep(250);
  }
  if (!ver) throw new Error('chrome never came up');

  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const logs = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push('[' + m.params.type + '] ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push('[exception] ' + (d.exception?.description || d.text));
    }
  });
  await new Promise(r => ws.addEventListener('open', r));
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: Number(size), height: Number(size), deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.navigate', { url });
  await sleep(6000);

  const r = await send('Runtime.evaluate', {
    expression: '(async () => { const out = await window.__bake.bake(); return JSON.stringify({ bytes: out.bytes, cell: out.cell, cols: out.cols, rows: out.rows, names: out.names, src: out.src, box: out.box, dataUrl: out.dataUrl }); })()',
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  const out = JSON.parse(r.result.value);
  const b64 = out.dataUrl.split(',')[1];
  writeFileSync(outFile, Buffer.from(b64, 'base64'));
  delete out.dataUrl;
  console.log('BAKED', JSON.stringify(out));
  console.log('--- logs ---');
  console.log(logs.join('\n') || '(none)');
};

main().catch(e => { console.error('FAIL', e); process.exitCode = 1; })
  .finally(() => { try { chrome.kill(); } catch {} });
