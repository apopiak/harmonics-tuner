// Regression test for the voice.html mode classifier.
//
// Stubs getUserMedia with a synthesized oscillator graph in headless Chromium
// and asserts the displayed mode for eight scenarios. No microphone needed.
//
// Setup (dev-only; the tools themselves stay dependency-free):
//   npm install playwright-core
//   node test/voice-scenarios.js
//
// Browser resolution: uses your installed Chrome by default. To point at a
// specific Chromium binary instead: CHROMIUM_PATH=/path/to/chromium node test/...
//
// Takes ~45 s: each scenario needs a few seconds of synthetic audio for the
// rolling classification window plus label hysteresis to settle.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');

// Injected before page load: replaces getUserMedia with a synth graph the
// scenarios reshape. All synthesis happens page-side in a real AudioContext,
// so the full analyser pipeline is exercised.
const initScript = () => {
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    master.connect(dest);
    window.__synth = { ctx, master, nodes: [] };

    window.__clear = () => {
      for (const n of window.__synth.nodes) { try { n.stop ? n.stop() : n.disconnect(); } catch (e) {} }
      window.__synth.nodes = [];
      if (window.__speechTimer) { clearInterval(window.__speechTimer); window.__speechTimer = null; }
    };

    // harmonic-rich sustained "sung" tone: H1..H8 at 1/n amplitudes
    window.__voiceOn = (f0 = 220) => {
      const { ctx, master, nodes } = window.__synth;
      for (let n = 1; n <= 8; n++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f0 * n;
        g.gain.value = 0.25 / n;
        o.connect(g); g.connect(master);
        o.start();
        nodes.push(o, g);
      }
    };

    // pure sine "whistle"
    window.__whistleOn = (f = 1490) => {
      const { ctx, master, nodes } = window.__synth;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.value = 0.3;
      o.connect(g); g.connect(master);
      o.start();
      nodes.push(o, g);
    };

    // sygyt-style: low drone with one boosted, isolated high harmonic
    window.__sygytOn = (f0 = 110, boostN = 9) => {
      const { ctx, master, nodes } = window.__synth;
      for (let n = 1; n <= 12; n++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f0 * n;
        g.gain.value = n === boostN ? 0.3 : 0.25 / n;
        o.connect(g); g.connect(master);
        o.start();
        nodes.push(o, g);
      }
    };

    // kargyraa-style: drone plus strong subharmonic at f0/2
    window.__kargyraaOn = (f0 = 110) => {
      const { ctx, master, nodes } = window.__synth;
      const parts = [[f0 / 2, 0.15]];
      for (let n = 1; n <= 8; n++) parts.push([f0 * n, 0.25 / n]);
      for (const [f, a] of parts) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.value = a;
        o.connect(g); g.connect(master);
        o.start();
        nodes.push(o, g);
      }
    };

    // sung note with 5.5 Hz vibrato (±40 cents)
    window.__vibratoOn = (f0 = 220) => {
      const { ctx, master, nodes } = window.__synth;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      lfo.start();
      nodes.push(lfo);
      for (let n = 1; n <= 8; n++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f0 * n;
        g.gain.value = 0.25 / n;
        const depth = ctx.createGain();
        depth.gain.value = f0 * n * 0.0234; // ±40 cents
        lfo.connect(depth); depth.connect(o.frequency);
        o.connect(g); g.connect(master);
        o.start();
        nodes.push(o, g, depth);
      }
    };

    // speech-like: continuously gliding f0 (~500 ¢/s, direction flips at the
    // range edges) with ~180 ms amplitude gaps every ~480 ms (syllable rate)
    window.__speechOn = () => {
      const { ctx, master, nodes } = window.__synth;
      const oscs = [];
      const gate = ctx.createGain();
      gate.gain.value = 1;
      gate.connect(master);
      for (let n = 1; n <= 6; n++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 140 * n;
        g.gain.value = 0.25 / n;
        o.connect(g); g.connect(gate);
        o.start();
        nodes.push(o, g);
        oscs.push(o);
      }
      nodes.push(gate);
      let f0 = 140, dir = 1, phase = 0;
      window.__speechTimer = setInterval(() => {
        phase += 60;
        f0 *= Math.pow(2, dir * 0.025);
        if (f0 > 210 || f0 < 110) dir = -dir;
        const t = ctx.currentTime;
        oscs.forEach((o, i) => o.frequency.linearRampToValueAtTime(f0 * (i + 1), t + 0.06));
        const inGap = (phase % 480) < 180;
        gate.gain.setTargetAtTime(inGap ? 0 : 1, t, 0.01);
      }, 60);
    };

    return dest.stream;
  };
};

const SCENARIOS = [
  { name: 'singing 220 Hz',        setup: () => window.__voiceOn(220),                              expect: /^Singing/ },
  { name: 'whistle 1490 Hz',       setup: () => window.__whistleOn(1490),                           expect: /^Whistling$/ },
  { name: 'whistle + singing',     setup: () => { window.__voiceOn(220); window.__whistleOn(1490); }, expect: /^Whistling \+ singing$/ },
  { name: 'speech-like',           setup: () => window.__speechOn(),                                expect: /^Speech$/, waitMs: 4500 },
  { name: 'vibrato singing',       setup: () => window.__vibratoOn(220),                            expect: /^Singing/, waitMs: 4000 },
  { name: 'sygyt (drone + H9)',    setup: () => window.__sygytOn(110, 9),                           expect: /^Throat singing \(overtone\)$/ },
  { name: 'kargyraa (drone+f0/2)', setup: () => window.__kargyraaOn(110),                           expect: /^Throat singing \(kargyraa\)$/ },
  { name: 'whistle + speech',      setup: () => { window.__whistleOn(2200); window.__speechOn(); },  expect: /^Whistling \+ speech$/, waitMs: 4500 },
];

function serve() {
  const types = { '.html': 'text/html', '.md': 'text/plain' };
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, path.normalize(req.url.split('?')[0]).replace(/^([/\\])+/, ''));
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const args = ['--autoplay-policy=no-user-gesture-required'];
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH, args }
      : { channel: 'chrome', args }
  );
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  await page.addInitScript(initScript);
  await page.goto(`http://127.0.0.1:${port}/voice.html`);
  await page.click('#toggle');
  await page.waitForTimeout(500);

  let failures = 0;
  for (const s of SCENARIOS) {
    await page.evaluate(s.setup);
    await page.waitForTimeout(s.waitMs || 3500);
    const mode = await page.evaluate(() => document.querySelector('#technique .tname').textContent);
    const ok = s.expect.test(mode);
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.name.padEnd(24)} → "${mode}"${ok ? '' : `  (expected ${s.expect})`}`);
    await page.evaluate(() => window.__clear());
    await page.waitForTimeout(1500); // let the window drain + hysteresis reset
  }

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} scenario(s) failed` : '\nall scenarios passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
