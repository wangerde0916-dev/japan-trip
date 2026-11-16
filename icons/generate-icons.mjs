// Optional icon source: node icons/generate-icons.mjs. Only Node built-ins.
import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const colors = {
  navy: [20, 46, 76], red: [223, 91, 80], snow: [255, 255, 255],
  mountain: [152, 176, 200], line: [220, 230, 238]
};
const mountain = [[95,350],[225,170],[365,350]];
const slope = [[95,350],[185,225],[207,217],[227,236],[245,219],[269,227],[365,350]];
const foreground = [[95,350],[140,337],[185,329],[235,327],[280,329],[327,338],[370,348],[417,350],[417,383],[95,383]];
function polygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [a, b] = points[i];
    const [c, d] = points[j];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) inside = !inside;
  }
  return inside;
}
const circle = (x, y, cx, cy, r) => (x-cx)**2 + (y-cy)**2 <= r*r;
function sample(x, y) {
  let color = colors.navy;
  if (circle(x,y,335,177,46)) color = colors.red;
  if (polygon(x,y,mountain)) color = colors.snow;
  if (polygon(x,y,slope)) color = colors.mountain;
  if (polygon(x,y,foreground)) color = colors.snow;
  if ((x >= 174 && x <= 339 && Math.abs(y-365) <= 3) || circle(x,y,174,365,3) || circle(x,y,339,365,3)) color = colors.line;
  if (circle(x,y,174,365,9)) color = colors.red;
  if (circle(x,y,339,365,9)) color = colors.navy;
  return color;
}
const crcTable = Array.from({length:256}, (_, n) => {
  for (let i=0;i<8;i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, content) {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(content.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(Buffer.concat([type,content])));
  return Buffer.concat([length,type,content,check]);
}
for (const size of [192,512]) {
  const raw = Buffer.alloc(size * (1 + size * 3));
  const scale = 512 / size;
  for (let y=0;y<size;y++) {
    for (let x=0;x<size;x++) {
      const total = [0,0,0];
      for (const dy of [0.25,0.75]) for (const dx of [0.25,0.75]) {
        const color = sample((x+dx)*scale,(y+dy)*scale);
        for (let channel=0;channel<3;channel++) total[channel] += color[channel];
      }
      const offset = y*(1+size*3)+1+x*3;
      for (let channel=0;channel<3;channel++) raw[offset+channel] = Math.round(total[channel]/4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size,0);
  header.writeUInt32BE(size,4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',header), chunk('IDAT',deflateSync(raw)), chunk('IEND',Buffer.alloc(0))
  ]);
  await writeFile(new URL(`./icon-${size}.png`,import.meta.url),png);
  console.log(`Generated icon-${size}.png (${png.length} bytes)`);
}
