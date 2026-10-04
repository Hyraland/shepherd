// 把 CGTrader 的小羊模型打包加密成 assets/sheep.pack，
// 网页里用 WebCrypto 解密后交给 GLTFLoader（见 src/sheepPack.js）。CGTrader 的授权要求不能直接公开模型文件。
// 用法：node tools/pack-sheep.mjs   （每次都会生成新的密钥，写进 src/sheepKey.js）
//
// 打包格式（加密前）：'YLPK' + 头部长度（uint32）+ 头部 JSON {files: [{name, size}]} + 各文件内容依次相接
// 加密：AES-256-GCM，输出 = 12 字节 IV + 密文
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { webcrypto as crypto } from 'crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'models/sheep_cgtrader');
const tmp = mkdtempSync(join(tmpdir(), 'sheep-pack-'));

const jpeg = (name, out) => {
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', join(SRC, name), '--out', join(tmp, out)], { stdio: 'ignore' });
  return readFileSync(join(tmp, out));
};
const gltf = JSON.parse(readFileSync(join(SRC, 'Sheep.gltf'), 'utf8'));
const rename = { 'Sheep Body': ['body.jpg', 'image/jpeg', () => jpeg('Sheep Body.png', 'body.jpg')],
  'Sheep Head': ['head.jpg', 'image/jpeg', () => jpeg('Sheep Head.png', 'head.jpg')],
  'Sheep Head Eye': ['eye.png', 'image/png', () => readFileSync(join(SRC, 'Sheep Head Eye.png'))] };
const files = [];
for (const im of gltf.images) {
  const [name, mime, read] = rename[im.name];
  im.uri = name; im.mimeType = mime;
  files.push([name, read()]);
}
gltf.buffers[0].uri = 'mesh.bin';
files.push(['mesh.bin', readFileSync(join(SRC, 'Sheep.bin'))]);
files.unshift(['sheep.gltf', Buffer.from(JSON.stringify(gltf))]);
rmSync(tmp, { recursive: true, force: true });

const header = Buffer.from(JSON.stringify({ files: files.map(([name, data]) => ({ name, size: data.length })) }));
const len = Buffer.alloc(4); len.writeUInt32LE(header.length);
const plain = Buffer.concat([Buffer.from('YLPK'), len, header, ...files.map(([, d]) => d)]);

const keyBytes = crypto.getRandomValues(new Uint8Array(32));
const iv = crypto.getRandomValues(new Uint8Array(12));
const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
writeFileSync(join(ROOT, 'assets/sheep.pack'), Buffer.concat([Buffer.from(iv), Buffer.from(cipher)]));
writeFileSync(join(ROOT, 'src/sheepKey.js'),
  `// 由 tools/pack-sheep.mjs 生成：解密 assets/sheep.pack 的密钥\nexport const SHEEP_KEY = '${Buffer.from(keyBytes).toString('base64')}';\n`);
console.log('packed', files.map(([n, d]) => `${n} ${(d.length / 1024).toFixed(0)}KB`).join(', '), '→', (plain.length / 1048576).toFixed(2), 'MB');
