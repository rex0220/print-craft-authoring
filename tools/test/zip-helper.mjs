/**
 * テスト用の zip（stored、ZIP64 なし）を作る。plugin-zip.ts の整合性の検査（CRC、名前の一致、重複、範囲）を試すために、
 * 壊し方を指定できる。印刷屋の zip の 2 層（contents.zip + PUBKEY + SIGNATURE）も作れる（合成 zip。印刷屋のコードは含まない）。
 */
import { crc32 } from "../src/plugin-zip.ts";

/**
 * @param {Record<string, string | Buffer>} entries
 * @param {{ badCrc?: string; badLocalName?: string; duplicate?: string; badSize?: string }} [corrupt]
 */
export function makeZip(entries, corrupt = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const names = Object.keys(entries);
  if (corrupt.duplicate) names.push(corrupt.duplicate);
  for (const name of names) {
    const data = Buffer.isBuffer(entries[name]) ? entries[name] : Buffer.from(entries[name], "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const localNameBuf = corrupt.badLocalName === name ? Buffer.from(name.toUpperCase() + "x", "utf8") : nameBuf;
    let crc = crc32(data);
    if (corrupt.badCrc === name) crc = (crc ^ 0xffffffff) >>> 0;
    const size = corrupt.badSize === name ? data.length + 1 : data.length;
    const local = Buffer.alloc(30 + localNameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(localNameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localNameBuf.copy(local, 30);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

/** 印刷屋の zip と同じ 2 層の合成 zip（中身はスタブ。版や entry の有無を変えられる） */
export function makePluginZip(inner, outerExtra = {}) {
  const contents = makeZip(inner);
  return makeZip({ "contents.zip": contents, PUBKEY: "stub", SIGNATURE: "stub", ...outerExtra });
}

/** 合成 zip の中身の既定（Ver.6 の形。コードはすべてスタブ） */
export function stubInnerEntries(overrides = {}) {
  return {
    "manifest.json": JSON.stringify({ manifest_version: 1, version: 6, name: { ja: "stub" }, config: { js: ["config_js/print-craft-authoring-api.js"] } }),
    "desktop_js/KintoneFormulaPCraft.min.js": "window.rex0220p = { KintoneFormulaPCraft: function () { this.funs = {}; } };",
    "desktop_js/bignumber.min.js": "window.rex0220_BigNumber = function () {};",
    "desktop_js/moment-timezone-with-data.min.js": "/* stub */",
    "config_js/print-craft-authoring-api.js": "window.rex0220PrintCraftAuthoring = { apiVersion: 1, pluginVersion: \"6\" };",
    ...overrides
  };
}
