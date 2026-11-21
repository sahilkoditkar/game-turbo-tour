#!/usr/bin/env node
// Portal builds: node scripts/build.mjs <target>   (targets: see TARGETS; dependency-free, Node >= 18)
// Copies only what the game needs (index.html, showroom.html, style.css, src/**, vendor/**, assets/**) into a zip whose root
// is the game, with the target's tags injected into index.html. The repository's own index.html is untouched.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// One entry per portal. `platform` sets window.TURBOTOUR_PLATFORM (the adapter in src/platform/); `head` is
// injected before </head>. A new portal (e.g. poki) = one entry here + one adapter in src/platform/index.js.
const TARGETS = {
  web: { zip: 'turbotour-web.zip', platform: null, head: [] },
  crazygames: {
    zip: 'turbotour-crazygames.zip',
    platform: 'crazygames',
    // the v3 SDK is a plain <script> in the page, init()ed by the game (src/platform/crazygames.js)
    head: ['<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>'],
  },
};

// 404.html, robots.txt and sitemap.xml are for the GitHub Pages site only
const INCLUDE = ['index.html', 'showroom.html', 'site.webmanifest', 'style.css', 'src', 'vendor', 'assets'];
const SKIP = (rel) => /(^|\/)(\.[^/]*|README[^/]*|.*\.md)$/i.test(rel); // dotfiles, READMEs, docs

function walk(abs, out) {
  const st = statSync(abs);
  if (st.isDirectory()) { for (const n of readdirSync(abs).sort()) walk(join(abs, n), out); return; }
  const rel = relative(ROOT, abs).split(sep).join('/');
  if (!SKIP(rel)) out.push(rel);
}

function patchIndex(html, t) {
  const tags = [...t.head];
  if (t.platform) tags.push(`<script>window.TURBOTOUR_PLATFORM = ${JSON.stringify(t.platform)};</script>`);
  if (!tags.length) return html;
  if (!html.includes('</head>')) throw new Error('index.html has no </head>');
  return html.replace('</head>', tags.map((x) => '  ' + x + '\n').join('') + '</head>');
}

// ---------------------------------------------------------------- minimal zip writer (deflate via zlib)
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
function zip(entries) { // entries: [{ name, data: Buffer }]
  const parts = [], central = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 9 });
    const store = deflated.length >= data.length;
    const body = store ? data : deflated;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(store ? 0 : 8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(store ? 0 : 8, 10); cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28); // extra, comment, disk, internal attrs = 0
    cen.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: a regular rw-r--r-- file
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, end]);
}

// ---------------------------------------------------------------- main
const name = process.argv[2];
const t = TARGETS[name];
if (!t) { console.error(`usage: node scripts/build.mjs <${Object.keys(TARGETS).join('|')}>`); process.exit(1); }

const files = [];
for (const p of INCLUDE) if (existsSync(join(ROOT, p))) walk(join(ROOT, p), files);
const entries = files.map((rel) => {
  let data = readFileSync(join(ROOT, rel));
  if (rel === 'index.html') data = Buffer.from(patchIndex(data.toString('utf8'), t), 'utf8');
  return { name: rel, data };
});
const raw = entries.reduce((s, e) => s + e.data.length, 0);
const out = join(ROOT, 'dist', t.zip);
mkdirSync(dirname(out), { recursive: true });
const buf = zip(entries);
writeFileSync(out, buf);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`${relative(ROOT, out).split(sep).join('/')}\n  target: ${name}${t.platform ? ` (window.TURBOTOUR_PLATFORM = '${t.platform}')` : ''}\n  files:  ${entries.length}\n  size:   ${kb(buf.length)} zipped, ${kb(raw)} unpacked (${raw} bytes)`);
