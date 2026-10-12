import crypto from 'node:crypto';
import sharp from 'sharp';

export const WATERMARK_METHOD = 'dct-qim-v2';
export const LEGACY_WATERMARK_METHOD = 'dct-qim-v1';

const BLOCK = 8;
const TILE = 16;
const STEP = 12;
const COEFFICIENTS = [[1, 2], [2, 1], [2, 2], [1, 3], [3, 1], [3, 2]];
const SLOTS_PER_BLOCK = COEFFICIENTS.length;
const TILE_SLOTS = TILE * TILE * SLOTS_PER_BLOCK;
const ID_BYTES = 8;
const PAYLOAD_BITS = (ID_BYTES + 2) * 8;
const MIN_DIMENSION = 128;
const OUTPUT_QUALITY = 92;
const ELIGIBLE_LOW = 4;
const ELIGIBLE_HIGH = 251;
const MIN_VOTES = PAYLOAD_BITS * 3;
const MIN_CONFIDENCE = 0.2;
const MAX_PIXELS = 40_000_000;

const BASIS = COEFFICIENTS.map(([u, v]) => {
  const table = new Float64Array(BLOCK * BLOCK);
  const cu = u === 0 ? Math.sqrt(1 / BLOCK) : Math.sqrt(2 / BLOCK);
  const cv = v === 0 ? Math.sqrt(1 / BLOCK) : Math.sqrt(2 / BLOCK);
  for (let y = 0; y < BLOCK; y += 1) {
    for (let x = 0; x < BLOCK; x += 1) {
      table[y * BLOCK + x] = cu * cv
        * Math.cos(((2 * y + 1) * u * Math.PI) / (2 * BLOCK))
        * Math.cos(((2 * x + 1) * v * Math.PI) / (2 * BLOCK));
    }
  }
  return table;
});

function crc16(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function normaliseWatermarkId(value) {
  const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length < ID_BYTES * 2) throw new Error('Watermark identifier is too short');
  return hex.slice(0, ID_BYTES * 2);
}

function payloadBits(idHex) {
  const idBytes = Buffer.from(normaliseWatermarkId(idHex), 'hex');
  const checksum = crc16(idBytes);
  const bytes = Buffer.concat([idBytes, Buffer.from([checksum >> 8, checksum & 0xff])]);
  const bits = new Uint8Array(PAYLOAD_BITS);
  for (let i = 0; i < PAYLOAD_BITS; i += 1) bits[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  return bits;
}

function bitsToId(bits) {
  const bytes = Buffer.alloc(PAYLOAD_BITS / 8);
  for (let i = 0; i < PAYLOAD_BITS; i += 1) {
    if (bits[i]) bytes[i >> 3] |= 1 << (7 - (i & 7));
  }
  const idBytes = bytes.subarray(0, ID_BYTES);
  const checksum = (bytes[ID_BYTES] << 8) | bytes[ID_BYTES + 1];
  return checksum === crc16(idBytes) ? idBytes.toString('hex') : null;
}

export function isWatermarkConfigured() {
  try {
    watermarkKey();
    return true;
  } catch {
    return false;
  }
}

function watermarkKey(secretOverride) {
  const secret = secretOverride ?? (process.env.WATERMARK_SECRET || process.env.ANALYTICS_HMAC_SECRET);
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('Watermark secret is not configured securely');
  return crypto.createHmac('sha256', secret).update('aurora-invisible-watermark-v1').digest();
}

const tableCache = new Map();

function keyedTable(secretOverride) {
  const key = watermarkKey(secretOverride);
  const cacheId = key.toString('hex');
  if (tableCache.has(cacheId)) return tableCache.get(cacheId);

  let counter = 0;
  const nextBytes = () => {
    const block = crypto.createHmac('sha256', key).update(`stream:${counter}`).digest();
    counter += 1;
    return block;
  };
  let pool = Buffer.alloc(0);
  const take = (length) => {
    while (pool.length < length) pool = Buffer.concat([pool, nextBytes()]);
    const out = pool.subarray(0, length);
    pool = pool.subarray(length);
    return out;
  };

  const order = Array.from({ length: TILE_SLOTS }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = take(4).readUInt32BE(0) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const bitIndex = new Uint8Array(TILE_SLOTS);
  const dither = new Float64Array(TILE_SLOTS);
  for (let slot = 0; slot < TILE_SLOTS; slot += 1) {
    bitIndex[slot] = order[slot] % PAYLOAD_BITS;
    dither[slot] = (take(2).readUInt16BE(0) / 65536) * 2 * STEP;
  }
  const table = { bitIndex, dither };
  if (tableCache.size >= 4) tableCache.delete(tableCache.keys().next().value);
  tableCache.set(cacheId, table);
  return table;
}

function tileSlot(blockX, blockY, slot) {
  return ((blockY % TILE) * TILE + (blockX % TILE)) * SLOTS_PER_BLOCK + slot;
}

function quantise(value, bit, dither) {
  const offset = dither + bit * STEP;
  return offset + 2 * STEP * Math.round((value - offset) / (2 * STEP));
}

function latticeDistance(value, bit, dither) {
  const offset = dither + bit * STEP;
  const period = 2 * STEP;
  let remainder = (value - offset) % period;
  if (remainder < 0) remainder += period;
  return Math.min(remainder, period - remainder);
}

function softVote(value, dither) {
  return (latticeDistance(value, 1, dither) - latticeDistance(value, 0, dither)) / STEP;
}

function blockCoefficient(plane, width, originX, originY, slot) {
  const basis = BASIS[slot];
  let sum = 0;
  for (let y = 0; y < BLOCK; y += 1) {
    const rowStart = (originY + y) * width + originX;
    const basisStart = y * BLOCK;
    for (let x = 0; x < BLOCK; x += 1) sum += plane[rowStart + x] * basis[basisStart + x];
  }
  return sum;
}

async function decodeRaw(input) {
  const pipeline = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).rotate().removeAlpha().toColourspace('srgb');
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function lumaPlane(data, width, height, channels) {
  const plane = new Float32Array(width * height);
  for (let i = 0, p = 0; i < plane.length; i += 1, p += channels) {
    plane[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return plane;
}

export async function embedWatermark(inputBuffer, watermarkId) {
  const bits = payloadBits(watermarkId);
  const { bitIndex, dither } = keyedTable();
  const { data, width, height, channels } = await decodeRaw(inputBuffer);
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) throw new Error('Image is too small to protect');

  const plane = lumaPlane(data, width, height, channels);
  const blocksX = Math.floor(width / BLOCK);
  const blocksY = Math.floor(height / BLOCK);
  const delta = new Float32Array(BLOCK * BLOCK);

  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      const originX = bx * BLOCK;
      const originY = by * BLOCK;

      delta.fill(0);
      for (let slot = 0; slot < SLOTS_PER_BLOCK; slot += 1) {
        const index = tileSlot(bx, by, slot);
        const original = blockCoefficient(plane, width, originX, originY, slot);
        const target = quantise(original, bits[bitIndex[index]], dither[index]);
        const change = target - original;
        const basis = BASIS[slot];
        for (let i = 0; i < delta.length; i += 1) delta[i] += change * basis[i];
      }

      for (let y = 0; y < BLOCK; y += 1) {
        for (let x = 0; x < BLOCK; x += 1) {
          const offset = ((originY + y) * width + originX + x) * channels;
          const shift = delta[y * BLOCK + x];
          for (let c = 0; c < 3; c += 1) {
            const next = Math.round(data[offset + c] + shift);
            data[offset + c] = next < 0 ? 0 : next > 255 ? 255 : next;
          }
        }
      }
    }
  }

  const buffer = await sharp(data, { raw: { width, height, channels } })
    .jpeg({ quality: OUTPUT_QUALITY, chromaSubsampling: '4:4:4', mozjpeg: false })
    .withMetadata({ orientation: 1 })
    .toBuffer();
  return { buffer, width, height, method: WATERMARK_METHOD };
}

function sampleCoefficients(plane, width, height, offsetX, offsetY, maxBlocks, masked) {
  const blocksX = Math.floor((width - offsetX) / BLOCK);
  const blocksY = Math.floor((height - offsetY) / BLOCK);
  const spanX = Math.min(blocksX, maxBlocks);
  const spanY = Math.min(blocksY, maxBlocks);
  if (spanX < TILE || spanY < TILE) return null;
  const startX = Math.floor((blocksX - spanX) / 2);
  const startY = Math.floor((blocksY - spanY) / 2);
  const values = new Float32Array(spanX * spanY * SLOTS_PER_BLOCK);
  const usable = new Uint8Array(spanX * spanY);
  let cursor = 0;
  let block = 0;
  for (let j = 0; j < spanY; j += 1) {
    for (let i = 0; i < spanX; i += 1) {
      const originX = offsetX + (startX + i) * BLOCK;
      const originY = offsetY + (startY + j) * BLOCK;
      let keep = 1;
      if (masked) {
        let low = 255;
        let high = 0;
        for (let y = 0; y < BLOCK && keep; y += 1) {
          const rowStart = (originY + y) * width + originX;
          for (let x = 0; x < BLOCK; x += 1) {
            const value = plane[rowStart + x];
            if (value < low) low = value;
            if (value > high) high = value;
          }
        }
        if (low < ELIGIBLE_LOW || high > ELIGIBLE_HIGH) keep = 0;
      }
      usable[block] = keep;
      block += 1;
      if (keep) {
        for (let slot = 0; slot < SLOTS_PER_BLOCK; slot += 1) {
          values[cursor + slot] = blockCoefficient(plane, width, originX, originY, slot);
        }
      }
      cursor += SLOTS_PER_BLOCK;
    }
  }
  return { values, usable, spanX, spanY, startX, startY };
}

function tally(sample, phaseX, phaseY, table) {
  const sums = new Float64Array(PAYLOAD_BITS);
  let votes = 0;
  let block = 0;
  for (let j = 0; j < sample.spanY; j += 1) {
    for (let i = 0; i < sample.spanX; i += 1) {
      if (sample.usable[block]) {
        const tileBase = (((j + phaseY) % TILE) * TILE + ((i + phaseX) % TILE)) * SLOTS_PER_BLOCK;
        const valueBase = block * SLOTS_PER_BLOCK;
        for (let slot = 0; slot < SLOTS_PER_BLOCK; slot += 1) {
          const index = tileBase + slot;
          sums[table.bitIndex[index]] += softVote(sample.values[valueBase + slot], table.dither[index]);
        }
        votes += SLOTS_PER_BLOCK;
      }
      block += 1;
    }
  }
  if (votes < MIN_VOTES) return { sums, confidence: 0, votes };
  let confidence = 0;
  for (let b = 0; b < PAYLOAD_BITS; b += 1) confidence += Math.abs(sums[b]);
  return { sums, confidence: confidence / votes, votes };
}

function searchOffsets(plane, width, height, table, offsets, masked) {
  const coarseBlocks = masked ? 64 : 40;
  const candidates = [];

  for (const [offsetX, offsetY] of offsets) {
    const sample = sampleCoefficients(plane, width, height, offsetX, offsetY, coarseBlocks, masked);
    if (!sample) continue;
    let best = null;
    for (let phaseY = 0; phaseY < TILE; phaseY += 1) {
      for (let phaseX = 0; phaseX < TILE; phaseX += 1) {
        const result = tally(sample, phaseX, phaseY, table);
        if (!best || result.confidence > best.confidence) best = { ...result, offsetX, offsetY, phaseX, phaseY, startX: sample.startX, startY: sample.startY };
      }
    }
    if (best) candidates.push(best);
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  for (const candidate of candidates.slice(0, 3)) {
    const sample = sampleCoefficients(plane, width, height, candidate.offsetX, candidate.offsetY, 128, masked);
    if (!sample) continue;
    const phaseX = (((candidate.phaseX + sample.startX - candidate.startX) % TILE) + TILE) % TILE;
    const phaseY = (((candidate.phaseY + sample.startY - candidate.startY) % TILE) + TILE) % TILE;
    const refined = tally(sample, phaseX, phaseY, table);
    const bits = new Uint8Array(PAYLOAD_BITS);
    for (let b = 0; b < PAYLOAD_BITS; b += 1) bits[b] = refined.sums[b] >= 0 ? 0 : 1;
    const id = bitsToId(bits);
    if (id && refined.confidence > MIN_CONFIDENCE) {
      return {
        id,
        confidence: Number(refined.confidence.toFixed(4)),
        offsetX: candidate.offsetX,
        offsetY: candidate.offsetY,
        masked
      };
    }
  }
  return null;
}

function extractFromPlane(plane, width, height, table) {
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) return null;

  const origin = [[0, 0]];
  const others = [];
  for (let offsetY = 0; offsetY < BLOCK; offsetY += 1) {
    for (let offsetX = 0; offsetX < BLOCK; offsetX += 1) {
      if (offsetX || offsetY) others.push([offsetX, offsetY]);
    }
  }

  // Images embedded with dct-qim-v2 carry the mark in every block. Images
  // issued by dct-qim-v1 only carry it in blocks that were not flat or clipped,
  // so the masked pass ignores the blocks that could never have been marked.
  for (const offsets of [origin, others]) {
    for (const masked of [false, true]) {
      const found = searchOffsets(plane, width, height, table, offsets, masked);
      if (found) return found;
    }
  }
  return null;
}

export async function describeImage(inputBuffer) {
  const { data, width, height, channels } = await decodeRaw(inputBuffer);
  const plane = lumaPlane(data, width, height, channels);
  const blocksX = Math.floor(width / BLOCK);
  const blocksY = Math.floor(height / BLOCK);
  let clipped = 0;
  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      let low = 255;
      let high = 0;
      for (let y = 0; y < BLOCK; y += 1) {
        const rowStart = (by * BLOCK + y) * width + bx * BLOCK;
        for (let x = 0; x < BLOCK; x += 1) {
          const value = plane[rowStart + x];
          if (value < low) low = value;
          if (value > high) high = value;
        }
      }
      if (low < ELIGIBLE_LOW || high > ELIGIBLE_HIGH) clipped += 1;
    }
  }
  const total = Math.max(1, blocksX * blocksY);
  return { width, height, clippedShare: clipped / total };
}

export async function extractWatermark(inputBuffer, options = {}) {
  const secrets = Array.isArray(options.secrets) && options.secrets.length
    ? options.secrets
    : [{ name: 'environment', value: undefined }];
  const tables = [];
  for (const secret of secrets) {
    try {
      tables.push({ name: secret.name, table: keyedTable(secret.value) });
    } catch {
      // Skip secrets that are missing or too short.
    }
  }
  if (!tables.length) throw new Error('Watermark secret is not configured securely');

  const first = await decodeRaw(inputBuffer);
  const widths = [first.width, ...(Array.isArray(options.widths) ? options.widths : [])]
    .map(Number)
    .filter((value, index, list) => Number.isInteger(value) && value >= MIN_DIMENSION && value <= 12000 && (value === first.width || value > first.width) && list.indexOf(value) === index);

  for (const targetWidth of widths) {
    if (typeof options.onProgress === 'function') options.onProgress(targetWidth);
    let decoded = first;
    if (targetWidth !== first.width) {
      const targetHeight = Math.max(MIN_DIMENSION, Math.round((first.height * targetWidth) / first.width));
      const resized = await sharp(first.data, { raw: { width: first.width, height: first.height, channels: first.channels } })
        .resize(targetWidth, targetHeight, { kernel: 'lanczos3', fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });
      decoded = { data: resized.data, width: resized.info.width, height: resized.info.height, channels: resized.info.channels };
    }
    const plane = lumaPlane(decoded.data, decoded.width, decoded.height, decoded.channels);
    for (const { name, table } of tables) {
      const found = extractFromPlane(plane, decoded.width, decoded.height, table);
      if (found) return { ...found, analysedWidth: decoded.width, secretName: name, method: found.masked ? LEGACY_WATERMARK_METHOD : WATERMARK_METHOD };
    }
  }
  return null;
}
