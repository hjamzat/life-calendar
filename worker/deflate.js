// Minimal zlib encoder specialised for flat images: run-length matches
// (distance 1) with the fixed Huffman table. Cost is proportional to the
// number of runs, not bytes, and rows known to be empty are skipped entirely.
// Output is larger than real deflate but ~10x cheaper in CPU.

function reverse(code, len) {
  let r = 0;
  for (let i = 0; i < len; i++) {
    r = (r << 1) | (code & 1);
    code >>= 1;
  }
  return r;
}

// Fixed literal/length codes (RFC 1951 §3.2.6), pre-reversed for LSB-first output.
const LIT_CODE = new Uint16Array(288);
const LIT_LEN = new Uint8Array(288);
for (let v = 0; v < 288; v++) {
  let code, len;
  if (v < 144) [code, len] = [0x30 + v, 8];
  else if (v < 256) [code, len] = [0x190 + v - 144, 9];
  else if (v < 280) [code, len] = [v - 256, 7];
  else [code, len] = [0xc0 + v - 280, 8];
  LIT_CODE[v] = reverse(code, len);
  LIT_LEN[v] = len;
}

// Match length 3..258 → (symbol, extra bits, extra value).
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const LEN_SYM = new Uint16Array(259);
const LEN_XB = new Uint8Array(259);
const LEN_XV = new Uint16Array(259);
for (let i = 0; i < LEN_BASE.length; i++) {
  const top = i + 1 < LEN_BASE.length ? LEN_BASE[i + 1] : 259;
  for (let l = LEN_BASE[i]; l < top && l <= 258; l++) {
    LEN_SYM[l] = 257 + i;
    LEN_XB[l] = LEN_EXTRA[i];
    LEN_XV[l] = l - LEN_BASE[i];
  }
}

class BitWriter {
  constructor(size) {
    this.buf = new Uint8Array(size);
    this.pos = 0;
    this.bits = 0;
    this.n = 0;
  }
  write(value, len) {
    this.bits |= value << this.n;
    this.n += len;
    while (this.n >= 8) {
      if (this.pos === this.buf.length) {
        const b = new Uint8Array(this.buf.length * 2);
        b.set(this.buf);
        this.buf = b;
      }
      this.buf[this.pos++] = this.bits & 0xff;
      this.bits >>>= 8;
      this.n -= 8;
    }
  }
  flush() {
    if (this.n > 0) this.write(0, 8 - this.n);
    return this.buf.subarray(0, this.pos);
  }
}

const MOD = 65521;

/**
 * @param {Uint8Array} raw       filtered scanlines (stride bytes per row)
 * @param {number} stride
 * @param {Uint8Array} rowUsed   1 if the row may contain non-zero bytes
 */
export function zlibRLE(raw, stride, rowUsed) {
  const out = new BitWriter(1 << 16);
  out.write(0x78, 8);
  out.write(0x01, 8);
  out.write(1, 1); // BFINAL
  out.write(1, 2); // BTYPE = 01 fixed Huffman

  let a = 1;
  let b = 0;

  const literal = (v) => out.write(LIT_CODE[v], LIT_LEN[v]);
  const match = (len) => {
    const s = LEN_SYM[len];
    out.write(LIT_CODE[s], LIT_LEN[s]);
    if (LEN_XB[len]) out.write(LEN_XV[len], LEN_XB[len]);
    out.write(0, 5); // distance code 0 = distance 1
  };

  const emitRun = (v, n) => {
    // adler32 over n copies of v, in O(1)
    b = (b + (n % MOD) * a + (((n * (n + 1)) / 2) % MOD) * v) % MOD;
    a = (a + n * v) % MOD;
    literal(v);
    let k = n - 1;
    while (k >= 3) {
      // never leave a 1-2 byte tail that can't be a match
      let l = Math.min(k, 258);
      if (k > 258 && k - 258 < 3) l = k - 3;
      match(l);
      k -= l;
    }
    while (k-- > 0) literal(v);
  };

  let runV = -1;
  let runN = 0;
  const rows = raw.length / stride;
  for (let y = 0; y < rows; y++) {
    if (!rowUsed[y]) {
      if (runV === 0) runN += stride;
      else {
        if (runN) emitRun(runV, runN);
        runV = 0;
        runN = stride;
      }
      continue;
    }
    const end = (y + 1) * stride;
    for (let i = y * stride; i < end; i++) {
      const v = raw[i];
      if (v === runV) runN++;
      else {
        if (runN) emitRun(runV, runN);
        runV = v;
        runN = 1;
      }
    }
  }
  if (runN) emitRun(runV, runN);

  literal(256); // end of block
  const body = out.flush();
  const res = new Uint8Array(body.length + 4);
  res.set(body);
  new DataView(res.buffer).setUint32(body.length, ((b << 16) | a) >>> 0);
  return res;
}
