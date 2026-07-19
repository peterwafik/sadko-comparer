/* ============================================================================
   SADKO headless-browser tier — a real Chrome driven over CDP, no deps.
   ----------------------------------------------------------------------------
   Talks to Chrome over its PIPE transport (--remote-debugging-pipe): CDP JSON
   messages, NUL-delimited, over fd3 (write) / fd4 (read). This deliberately
   avoids Node's built-in WebSocket, which crashes against Chrome's CDP socket
   on Windows. No puppeteer/playwright.

   One persistent headless Chrome is shared; each job creates a target, runs an
   optional in-page async script (so a store's OWN authorized fetch fires with
   its OWN token — this is how we reach B.TECH, whose search API is bearer-
   gated and refuses plain fetch), returns the script value and/or rendered
   DOM, then disposes the target.

   export renderPage(url, { waitMs, script }) → { html, value }
   export headlessAvailable() → boolean
   ========================================================================== */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find(p => { try { return existsSync(p); } catch { return false; } });

export function headlessAvailable() { return !!CHROME; }

let proc = null, io = null, launching = null;

function startBrowser() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-cdp-'));
  const p = spawn(CHROME, [
    '--headless=new', '--remote-debugging-pipe', '--disable-gpu', '--no-sandbox',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--mute-audio',
    '--blink-settings=imagesEnabled=false', '--lang=ar-EG', `--user-data-dir=${dir}`,
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });   // fd3 write, fd4 read

  const nextId = (() => { let n = 0; return () => ++n; })();
  const waiters = new Map();
  const evHandlers = new Set();
  let buf = Buffer.alloc(0);

  p.stdio[4].on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    let i;
    while ((i = buf.indexOf(0)) !== -1) {
      const msg = buf.subarray(0, i).toString('utf8');
      buf = buf.subarray(i + 1);
      let m; try { m = JSON.parse(msg); } catch { continue; }
      if (m.id && waiters.has(m.id)) {
        const w = waiters.get(m.id); waiters.delete(m.id);
        m.error ? w.rej(new Error(m.error.message)) : w.res(m.result);
      } else if (m.method) evHandlers.forEach(h => h(m));
    }
  });
  p.on('exit', () => { proc = null; io = null; for (const w of waiters.values()) w.rej(new Error('chrome-exit')); });

  function send(method, params = {}, sessionId) {
    const id = nextId();
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((res, rej) => {
      waiters.set(id, { res, rej });
      try { p.stdio[3].write(JSON.stringify(payload) + '\0'); }
      catch (e) { waiters.delete(id); rej(e); }
      setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); rej(new Error('cdp-timeout ' + method)); } }, 30000);
    });
  }
  proc = p;
  io = { send, onEvent: fn => { evHandlers.add(fn); return () => evHandlers.delete(fn); } };
}

async function ensureChrome() {
  if (!CHROME) throw new Error('no-chrome');
  if (proc && io) return;
  if (launching) return launching;
  launching = (async () => {
    startBrowser();
    // handshake: Target.getBrowserContexts confirms the pipe is live
    for (let i = 0; i < 30; i++) {
      try { await io.send('Target.setDiscoverTargets', { discover: false }); launching = null; return; }
      catch { await new Promise(r => setTimeout(r, 200)); }
    }
    launching = null;
    throw new Error('chrome-no-start');
  })();
  return launching;
}

export async function renderPage(url, { waitMs = 3500, script = null } = {}) {
  await ensureChrome();
  const { targetId } = await io.send('Target.createTarget', { url });
  const { sessionId } = await io.send('Target.attachToTarget', { targetId, flatten: true });
  const S = sessionId;
  try {
    // We only need Runtime; Page.enable hangs on some anti-automation sites, so
    // skip it and just give the page a fixed budget to load + settle its XHR.
    await io.send('Runtime.enable', {}, S).catch(() => {});
    await new Promise(r => setTimeout(r, waitMs));

    let value = null;
    if (script) {
      const r = await io.send('Runtime.evaluate', {
        expression: `(async()=>{ try { return JSON.stringify(await (${script})); } catch(e){ return JSON.stringify({__err:String(e&&e.message||e)}); } })()`,
        awaitPromise: true, returnByValue: true,
      }, S);
      try { value = JSON.parse(r.result?.value); } catch { value = r.result?.value ?? null; }
    }
    const dom = await io.send('Runtime.evaluate',
      { expression: 'document.documentElement.outerHTML', returnByValue: true }, S);
    return { html: String(dom.result?.value || ''), value };
  } finally {
    try { await io.send('Target.closeTarget', { targetId }); } catch {}
  }
}

export async function shutdown() { try { proc && proc.kill(); } catch {} }
