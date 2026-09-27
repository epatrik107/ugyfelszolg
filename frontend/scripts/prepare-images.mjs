// Run from frontend when source artwork changes; generated assets are committed.
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
const dir = 'public/images';
for (const width of [640, 1024, 1600]) {
  for (const format of ['avif', 'webp']) await sharp(`${dir}/hero-letter-desk.png`).resize({width}).toFormat(format, {quality: 48}).toFile(`${dir}/hero-letter-desk-${width}.${format}`);
}
await sharp('public/favicon.svg').resize(512,512).png().toFile(`${dir}/logo-512.png`);
await sharp('public/favicon.svg').resize(180,180).png().toFile('public/apple-touch-icon.png');
const sizes = [16,32,48];
const pngs = await Promise.all(sizes.map((s) => sharp('public/favicon.svg').resize(s,s).png().toBuffer()));
const header = Buffer.alloc(6 + sizes.length * 16); header.writeUInt16LE(1,2); header.writeUInt16LE(sizes.length,4);
let offset = header.length;
for (let i=0;i<sizes.length;i++) { const pos=6+i*16;header[pos]=sizes[i];header[pos+1]=sizes[i];header.writeUInt16LE(1,pos+4);header.writeUInt16LE(32,pos+6);header.writeUInt32LE(pngs[i].length,pos+8);header.writeUInt32LE(offset,pos+12);offset+=pngs[i].length; }
await writeFile('public/favicon.ico', Buffer.concat([header,...pngs]));
const overlay = Buffer.from('<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="630" fill="#10233f" fill-opacity="0.86"/><g fill="white" font-family="Arial, sans-serif"><text x="85" y="190" font-size="48">Levélsegéd</text><text x="85" y="300" font-size="64" font-weight="bold">Hivatalos levél</text><text x="85" y="385" font-size="64" font-weight="bold">írása online</text><text x="85" y="485" font-size="32">Udvarias. Érthető. Határozott.</text></g></svg>');
await sharp(`${dir}/hero-letter-desk.png`).resize(1200,630,{fit:'cover'}).composite([{input:overlay}]).jpeg({quality:82}).toFile(`${dir}/og-levelseged.jpg`);
