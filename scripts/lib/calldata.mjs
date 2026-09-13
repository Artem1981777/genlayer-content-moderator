// GenLayer calldata encoder — a faithful port of genlayer-js src/abi/calldata
// (MIT), needed because the consensus contract on Bradbury accepts only the
// flat addTransaction(address,address,uint256,uint256,bytes,uint256) entrypoint
// and current SDK releases encode the legacy struct variant, which reverts.
const BITS_IN_TYPE = 3;
const TYPE_SPECIAL = 0;
const TYPE_PINT = 1;
const TYPE_NINT = 2;
const TYPE_BYTES = 3;
const TYPE_STR = 4;
const TYPE_ARR = 5;
const TYPE_MAP = 6;

const SPECIAL_NULL = 0 << BITS_IN_TYPE | TYPE_SPECIAL;
const SPECIAL_FALSE = 1 << BITS_IN_TYPE | TYPE_SPECIAL;
const SPECIAL_TRUE = 2 << BITS_IN_TYPE | TYPE_SPECIAL;
const SPECIAL_ADDR = 3 << BITS_IN_TYPE | TYPE_SPECIAL;

function writeNum(to, data) {
  if (data === 0n) {
    to.push(0);
    return;
  }
  while (data > 0n) {
    let cur = Number(data & 0x7fn);
    data >>= 7n;
    if (data > 0n) cur |= 128;
    to.push(cur);
  }
}

function encodeNumWithType(to, data, type) {
  writeNum(to, data << BigInt(BITS_IN_TYPE) | BigInt(type));
}

function encodeNum(to, data) {
  if (data >= 0n) encodeNumWithType(to, data, TYPE_PINT);
  else encodeNumWithType(to, -data - 1n, TYPE_NINT);
}

function compareString(l, r) {
  for (let i = 0; i < l.length && i < r.length; i++) {
    const cur = l[i] - r[i];
    if (cur !== 0) return cur;
  }
  return l.length - r.length;
}

function encodeMap(to, arr) {
  const entries = Array.from(arr, ([k, v]) => [
    Array.from(k, (x) => x.codePointAt(0)),
    v,
  ]);
  entries.sort((a, b) => compareString(a[0], b[0]));
  for (let i = 1; i < entries.length; i++) {
    if (compareString(entries[i - 1][0], entries[i][0]) === 0) {
      throw new Error(`duplicate calldata key '${entries[i][0]}'`);
    }
  }
  encodeNumWithType(to, BigInt(entries.length), TYPE_MAP);
  for (const [k, v] of entries) {
    writeNum(to, BigInt(k.length));
    for (const c of k) to.push(c);
    encodeImpl(to, v);
  }
}

function encodeImpl(to, data) {
  if (data === null || data === undefined) {
    to.push(SPECIAL_NULL);
    return;
  }
  if (data === true) { to.push(SPECIAL_TRUE); return; }
  if (data === false) { to.push(SPECIAL_FALSE); return; }
  switch (typeof data) {
    case "number": {
      if (!Number.isInteger(data)) throw new Error(`floats not supported: ${data}`);
      encodeNum(to, BigInt(data));
      return;
    }
    case "bigint": encodeNum(to, data); return;
    case "string": {
      const str = new TextEncoder().encode(data);
      encodeNumWithType(to, BigInt(str.length), TYPE_STR);
      for (const c of str) to.push(c);
      return;
    }
    case "object": {
      if (data instanceof Uint8Array) {
        encodeNumWithType(to, BigInt(data.length), TYPE_BYTES);
        for (const c of data) to.push(c);
      } else if (data instanceof Array) {
        encodeNumWithType(to, BigInt(data.length), TYPE_ARR);
        for (const c of data) encodeImpl(to, c);
      } else if (data instanceof Map) {
        encodeMap(to, data.entries());
      } else {
        encodeMap(to, Object.entries(data));
      }
      return;
    }
    default:
      throw new Error(`invalid calldata input '${data}'`);
  }
}

export function encode(data) {
  const to = [];
  encodeImpl(to, data);
  return new Uint8Array(to);
}

// Same shape as genlayer-js makeCalldataObject: method key is "".
export function makeCalldataObject(method, args, kwargs) {
  const ret = {};
  if (method) ret[""] = method;
  if (args && args.length > 0) ret["args"] = args;
  if (kwargs instanceof Map) {
    if (kwargs.size > 0) ret["kwargs"] = kwargs;
  } else if (kwargs && Object.keys(kwargs).length > 0) {
    ret["kwargs"] = kwargs;
  }
  return ret;
}
