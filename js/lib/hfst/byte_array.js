/**
 * Binary data handling classes for reading HFST files.
 */

const float32ConvBuf = new ArrayBuffer(4);
const float32ConvUint = new Uint32Array(float32ConvBuf);
const float32ConvFloat = new Float32Array(float32ConvBuf);

/**
 * Reinterprets an unsigned 32-bit integer's bit pattern as a 32-bit float.
 * @param {number} uintVal
 * @returns {number}
 */
export function uint32BitsToFloat32(uintVal) {
  float32ConvUint[0] = uintVal;
  return float32ConvFloat[0];
}

/**
 * High-performance sequential binary reader over an ArrayBuffer or Uint8Array.
 */
export class BinaryReader {
  /**
   * @param {Uint8Array | ArrayBuffer | Buffer} input
   */
  constructor(input) {
    if (input instanceof Uint8Array) {
      this.bytes = input;
    } else if (input instanceof ArrayBuffer) {
      this.bytes = new Uint8Array(input);
    } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
      this.bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    } else {
      throw new TypeError('Expected Uint8Array, Buffer, or ArrayBuffer');
    }
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.offset = 0;
  }

  get remaining() {
    return this.bytes.length - this.offset;
  }

  readBytes(n) {
    if (this.offset + n > this.bytes.length) {
      throw new RangeError(
        `Unexpected end of binary data: requested ${n} bytes at offset ${this.offset}, but only ${this.bytes.length - this.offset} bytes remain`
      );
    }
    const slice = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }

  getUByte() {
    if (this.offset >= this.bytes.length) {
      throw new RangeError(`Unexpected end of data at offset ${this.offset}`);
    }
    const val = this.bytes[this.offset];
    this.offset += 1;
    return val;
  }

  getUShort() {
    const val = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return val;
  }

  getUInt() {
    const val = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return val;
  }

  getBool() {
    return this.getUInt() !== 0;
  }

  getFloat() {
    const val = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return val;
  }
}

/**
 * A class for handling byte arrays with various read operations,
 * matching pyhfst.byte_array.ByteArray.
 */
export class ByteArray {
  /**
   * @param {number | Uint8Array | ArrayBuffer | ByteArray} [s] - Size or buffer
   * @param {ByteArray | null} [another] - Optional another ByteArray to clone from
   */
  constructor(s = 0, another = null) {
    if (another != null) {
      const neededSize = Math.max(
        typeof s === 'number' ? s : (s?.getSize?.() ?? 0),
        another.getSize()
      );
      this.bytes = new Uint8Array(neededSize);
      const src = another.getBytes();
      this.bytes.set(src.subarray(0, neededSize));
      this.size = neededSize;
    } else if (typeof s === 'number') {
      this.bytes = new Uint8Array(s);
      this.size = s;
    } else if (s instanceof ByteArray) {
      this.bytes = new Uint8Array(s.bytes);
      this.size = s.size;
    } else if (s instanceof Uint8Array) {
      this.bytes = s;
      this.size = s.length;
    } else if (s instanceof ArrayBuffer) {
      this.bytes = new Uint8Array(s);
      this.size = this.bytes.length;
    } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(s)) {
      this.bytes = new Uint8Array(s.buffer, s.byteOffset, s.byteLength);
      this.size = this.bytes.length;
    } else {
      this.bytes = new Uint8Array(0);
      this.size = 0;
    }

    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.index = 0;
  }

  getSize() {
    return this.size;
  }

  get_size() {
    return this.getSize();
  }

  get(i) {
    return this.bytes[i];
  }

  getBytes() {
    return this.bytes;
  }

  get_bytes() {
    return this.getBytes();
  }

  getUByte() {
    const result = this.bytes[this.index];
    this.index += 1;
    return result;
  }

  get_ubyte() {
    return this.getUByte();
  }

  getUShort() {
    const result = this.view.getUint16(this.index, true);
    this.index += 2;
    return result;
  }

  get_ushort() {
    return this.getUShort();
  }

  getUInt() {
    const result = this.view.getUint32(this.index, true);
    this.index += 4;
    return result;
  }

  get_uint() {
    return this.getUInt();
  }

  getBool() {
    return this.getUInt() !== 0;
  }

  get_bool() {
    return this.getBool();
  }

  getFloat() {
    const result = this.view.getFloat32(this.index, true);
    this.index += 4;
    return result;
  }

  get_float() {
    return this.getFloat();
  }
}
