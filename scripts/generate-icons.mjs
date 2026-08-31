/**
 * Tallia のアイコン一式を生成する。
 *
 *   node scripts/generate-icons.mjs   （= npm run icons）
 *
 * 依存パッケージなしで動く。図形を数式で定義し、スーパーサンプリングで
 * ラスタライズして PNG / ICO を書き出す。SVG も同じ定義から生成するため、
 * ベクタとビットマップが必ず一致する。
 *
 * 出力:
 *   public/icon.svg                     ブラウザ用ベクタファビコン
 *   public/favicon.ico                  16 / 32 / 48（小サイズは 3 本線に簡略化）
 *   public/apple-touch-icon.png         180x180・全面塗り（iOS が角丸を付けるため）
 *   public/icons/icon-<size>.png        PWA 通常アイコン（角丸・背景透過）
 *   public/icons/icon-maskable-<size>.png  PWA マスカブル（全面塗り・安全域内に収める）
 */

import { deflateSync, crc32 as zlibCrc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const iconsDir = join(publicDir, 'icons');

// ---------------------------------------------------------------- デザイン定義

/** 背景グラデーション。左上（インディゴ）→ 右下（バイオレット）。 */
const GRADIENT = { from: '#6366f1', to: '#4c1d95' };
const MARK_COLOR = '#ffffff';
/** 角丸の半径。iOS のスクワークルに近い比率。 */
const CORNER_RADIUS = 0.22;

/**
 * タリーマークの形状パラメータ（すべて一辺を 1 とした比率）。
 * standard は 4 本線 + 斜線、compact は小サイズ用に 3 本線へ簡略化したもの。
 */
const MARK_PRESETS = {
  standard: { bars: 4, barW: 0.068, gap: 0.078, barH: 0.54, diagThick: 0.078, diagOverhang: 0.055 },
  compact: { bars: 3, barW: 0.11, gap: 0.13, barH: 0.5, diagThick: 0.1, diagOverhang: 0.08 },
};
/** 斜線の傾き（度）。右上がり。 */
const DIAG_ANGLE = -20;

/**
 * タリーマークを構成する矩形を返す。中心は (0.5, 0.5)。
 * @param {keyof typeof MARK_PRESETS} preset
 * @param {number} scale マーク全体の拡縮率（マスカブルで安全域に収めるのに使う）
 */
function markShapes(preset, scale = 1) {
  const p = MARK_PRESETS[preset];
  const totalW = p.bars * p.barW + (p.bars - 1) * p.gap;
  const shapes = [];

  for (let i = 0; i < p.bars; i++) {
    const cx = -totalW / 2 + p.barW / 2 + i * (p.barW + p.gap);
    shapes.push({ cx: cx * scale, cy: 0, w: p.barW * scale, h: p.barH * scale, angle: 0 });
  }
  shapes.push({
    cx: 0,
    cy: 0,
    w: (totalW + 2 * p.diagOverhang) * scale,
    h: p.diagThick * scale,
    angle: DIAG_ANGLE,
  });

  // 中心を (0.5, 0.5) に移す。
  return shapes.map((s) => ({ ...s, cx: s.cx + 0.5, cy: s.cy + 0.5 }));
}

// ------------------------------------------------------------------ 図形の判定

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 角丸矩形（0..1 の正方形）の内側か。radius が 0 なら全面。 */
function inRoundedSquare(x, y, radius) {
  if (radius <= 0) return true;
  const dx = Math.max(radius - x, x - (1 - radius), 0);
  const dy = Math.max(radius - y, y - (1 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

/** 回転した矩形の内側か。 */
function inRect(x, y, rect) {
  const rad = (rect.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const px = x - rect.cx;
  const py = y - rect.cy;
  const lx = px * cos + py * sin;
  const ly = -px * sin + py * cos;
  return Math.abs(lx) <= rect.w / 2 && Math.abs(ly) <= rect.h / 2;
}

// ------------------------------------------------------------- ラスタライザ

/**
 * アイコンを RGBA バッファに描画する。
 * @param {{size: number, preset: keyof typeof MARK_PRESETS, fullBleed: boolean, markScale: number}} opts
 */
function render({ size, preset, fullBleed, markScale }) {
  const radius = fullBleed ? 0 : CORNER_RADIUS;
  const from = hexToRgb(GRADIENT.from);
  const to = hexToRgb(GRADIENT.to);
  const mark = hexToRgb(MARK_COLOR);
  // 小さいアイコンほど 1 ピクセルの精度が効くのでサンプル数を増やす。
  const samples = size <= 64 ? 8 : 4;
  // 32px 以下では縦棒をピクセル境界に合わせる。半端な位置だと灰色に滲んで
  // タブ上でただの四角に見えてしまうため。
  const snap = size <= 32;

  const shapes = markShapes(preset, markScale).map((s) => ({
    cx: s.cx * size,
    cy: s.cy * size,
    w: s.w * size,
    h: s.h * size,
    angle: s.angle,
  }));
  if (snap) {
    for (const s of shapes) {
      if (s.angle !== 0) continue;
      const x0 = Math.round(s.cx - s.w / 2);
      const x1 = Math.max(x0 + 1, Math.round(s.cx + s.w / 2));
      const y0 = Math.round(s.cy - s.h / 2);
      const y1 = Math.max(y0 + 1, Math.round(s.cy + s.h / 2));
      s.cx = (x0 + x1) / 2;
      s.w = x1 - x0;
      s.cy = (y0 + y1) / 2;
      s.h = y1 - y0;
    }
  }

  const out = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = px + (sx + 0.5) / samples;
          const y = py + (sy + 0.5) / samples;
          if (!inRoundedSquare(x / size, y / size, radius)) continue;

          let color;
          if (shapes.some((s) => inRect(x, y, s))) {
            color = mark;
          } else {
            const t = Math.min(1, Math.max(0, (x + y) / (2 * size)));
            color = [
              from[0] + (to[0] - from[0]) * t,
              from[1] + (to[1] - from[1]) * t,
              from[2] + (to[2] - from[2]) * t,
            ];
          }
          // 不透明な色なので、そのまま加算して最後に被覆率で割る（＝プリマルチプライ）。
          r += color[0];
          g += color[1];
          b += color[2];
          a += 1;
        }
      }

      const total = samples * samples;
      const i = (py * size + px) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
        out[i + 3] = Math.round((a / total) * 255);
      }
    }
  }

  return out;
}

// ------------------------------------------------------------- PNG / ICO 出力

const crc32 =
  typeof zlibCrc32 === 'function'
    ? (buf) => zlibCrc32(buf)
    : (() => {
        const table = Array.from({ length: 256 }, (_, n) => {
          let c = n;
          for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
          return c >>> 0;
        });
        return (buf) => {
          let c = 0xffffffff;
          for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
          return (c ^ 0xffffffff) >>> 0;
        };
      })();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // 10..12 は圧縮方式・フィルタ方式・インタレース（すべて 0）。

  // 各スキャンラインの先頭にフィルタタイプ 0（None）を付ける。
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** PNG を各エントリに埋め込んだ ICO を作る（Vista 以降・全モダンブラウザが対応）。 */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dir = [];
  for (const { size, png } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[4] = 1; // color planes
    e[6] = 32; // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    dir.push(e);
    offset += png.length;
  }

  return Buffer.concat([header, ...dir, ...entries.map((e) => e.png)]);
}

// ------------------------------------------------------------------ SVG 出力

function svg(preset, markScale, radius) {
  const S = 512;
  const rects = markShapes(preset, markScale)
    .map((s) => {
      const w = (s.w * S).toFixed(2);
      const h = (s.h * S).toFixed(2);
      const x = (s.cx * S - (s.w * S) / 2).toFixed(2);
      const y = (s.cy * S - (s.h * S) / 2).toFixed(2);
      const rot = s.angle
        ? ` transform="rotate(${s.angle} ${(s.cx * S).toFixed(2)} ${(s.cy * S).toFixed(2)})"`
        : '';
      return `    <rect x="${x}" y="${y}" width="${w}" height="${h}"${rot} />`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" role="img" aria-label="Tallia">
  <title>Tallia</title>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${GRADIENT.from}" />
      <stop offset="1" stop-color="${GRADIENT.to}" />
    </linearGradient>
  </defs>
  <rect width="${S}" height="${S}" rx="${(radius * S).toFixed(2)}" fill="url(#g)" />
  <g fill="${MARK_COLOR}">
${rects}
  </g>
</svg>
`;
}

// ---------------------------------------------------------------------- 実行

const PWA_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const MASKABLE_SIZES = [192, 512];
const FAVICON_SIZES = [16, 32, 48];

mkdirSync(iconsDir, { recursive: true });

const written = [];
function write(path, data) {
  writeFileSync(path, data);
  written.push([path.replace(`${root}/`, ''), data.length]);
}

// 通常の PWA アイコン（角丸・背景透過）。
for (const size of PWA_SIZES) {
  const rgba = render({ size, preset: 'standard', fullBleed: false, markScale: 1 });
  write(join(iconsDir, `icon-${size}x${size}.png`), encodePng(size, rgba));
}

// マスカブル。プラットフォーム側が好きな形に切り抜くので全面塗りにし、
// マークは安全域（中央 80% の円）に確実に収まるよう少し縮める。
for (const size of MASKABLE_SIZES) {
  const rgba = render({ size, preset: 'standard', fullBleed: true, markScale: 0.78 });
  write(join(iconsDir, `icon-maskable-${size}x${size}.png`), encodePng(size, rgba));
}

// iOS は透過部分を黒く塗り、角丸も自前で付けるため全面塗りにする。
write(
  join(publicDir, 'apple-touch-icon.png'),
  encodePng(180, render({ size: 180, preset: 'standard', fullBleed: true, markScale: 0.82 })),
);

// ファビコン。48px 未満は 4 本線が潰れるので 3 本線に切り替える。
write(
  join(publicDir, 'favicon.ico'),
  encodeIco(
    FAVICON_SIZES.map((size) => ({
      size,
      png: encodePng(
        size,
        render({
          size,
          preset: size < 48 ? 'compact' : 'standard',
          fullBleed: false,
          markScale: 1,
        }),
      ),
    })),
  ),
);

write(join(publicDir, 'icon.svg'), Buffer.from(svg('standard', 1, CORNER_RADIUS), 'utf8'));

for (const [path, bytes] of written) {
  console.log(`${path.padEnd(40)} ${String(bytes).padStart(7)} bytes`);
}
