// A smart contract's bytecode, read statically (PLAN 4.8): the functions its dispatcher answers (each selector, and its
// name when it is a well-known one), whether it is a proxy (EIP-1167 clones, EIP-1967 slots) and to what, the opcodes
// worth a second look (DELEGATECALL, SELFDESTRUCT, tx.origin), and the compiler named in its metadata. Creation code is
// read down to the runtime it deploys. Nothing is executed.
//
// Logic ported from REA (https://github.com/morluto/rea), MIT License, Copyright (c) 2026 morluto: its offline EVM
// reading (dispatch selectors, byte offsets, a raw or hex carrier). REA uses evmole for arguments and mutability; this
// reads the dispatcher's own pattern. Rewritten for Orbz; see docs/third-party/rea.md.
import { selectorOf } from "../keccak.ts";
import { Unreadable } from "./bytes.ts";

/** Signatures worth naming: the token standards, ownership, pausing, proxies, routers. Selectors computed, not typed. */
const KNOWN = [
  "transfer(address,uint256)", "transferFrom(address,address,uint256)", "approve(address,uint256)", "balanceOf(address)", "totalSupply()",
  "allowance(address,address)", "name()", "symbol()", "decimals()", "increaseAllowance(address,uint256)", "decreaseAllowance(address,uint256)",
  "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)", "nonces(address)", "DOMAIN_SEPARATOR()",
  "mint(address,uint256)", "mint(uint256)", "burn(uint256)", "burnFrom(address,uint256)", "burn(address,uint256)",
  "ownerOf(uint256)", "safeTransferFrom(address,address,uint256)", "safeTransferFrom(address,address,uint256,bytes)", "setApprovalForAll(address,bool)",
  "isApprovedForAll(address,address)", "getApproved(uint256)", "tokenURI(uint256)", "baseURI()", "supportsInterface(bytes4)",
  "safeTransferFrom(address,address,uint256,uint256,bytes)", "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)", "uri(uint256)",
  "balanceOfBatch(address[],uint256[])",
  "owner()", "transferOwnership(address)", "renounceOwnership()", "pendingOwner()", "acceptOwnership()",
  "pause()", "unpause()", "paused()", "hasRole(bytes32,address)", "grantRole(bytes32,address)", "revokeRole(bytes32,address)", "renounceRole(bytes32,address)",
  "getRoleAdmin(bytes32)", "DEFAULT_ADMIN_ROLE()",
  "upgradeTo(address)", "upgradeToAndCall(address,bytes)", "implementation()", "admin()", "changeAdmin(address)", "proxiableUUID()",
  "initialize()", "multicall(bytes[])", "withdraw()", "withdraw(uint256)", "deposit()", "receive()",
  "setFee(uint256)", "setTaxFee(uint256)", "excludeFromFee(address)", "includeInFee(address)", "setMaxTxAmount(uint256)", "blacklist(address)",
  "setBlacklist(address,bool)", "enableTrading()", "openTrading()", "setSwapEnabled(bool)", "manualSwap()", "removeLimits()",
  "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)", "swapExactETHForTokens(uint256,address[],address,uint256)",
  "swapExactTokensForETH(uint256,uint256,address[],address,uint256)", "addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)",
  "addLiquidityETH(address,uint256,uint256,uint256,address,uint256)", "getReserves()", "token0()", "token1()", "factory()", "WETH()",
  "getAmountsOut(uint256,address[])", "swap(uint256,uint256,address,bytes)", "sync()", "skim(address)",
  "execute(bytes,bytes[],uint256)", "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))",
];
/** Selectors whose function, in a token, can stop you selling or take what you hold: a closer look before buying it. */
const WATCH = new Set(["setFee(uint256)", "setTaxFee(uint256)", "blacklist(address)", "setBlacklist(address,bool)", "setMaxTxAmount(uint256)", "mint(address,uint256)", "mint(uint256)", "pause()", "upgradeTo(address)", "upgradeToAndCall(address,bytes)"]);
const NAMES = new Map(KNOWN.map((sig) => [selectorOf(sig), sig]));

const SLOT_IMPLEMENTATION = "360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const SLOT_BEACON = "a3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
const SLOT_ADMIN = "b53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
/** ZeppelinOS's slot, before EIP-1967 (USDC's proxy is one): keccak256("org.zeppelinos.proxy.implementation"). */
const SLOT_ZOS = "7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";

export type EvmFacts = {
  size: number;
  creation: boolean;
  functions: { selector: string; name: string | null; watch: boolean }[];
  proxy: string | null;
  opcodes: Record<string, number>;
  push0: boolean;
  compiler: string | null;
  notes: string[];
};

/** Bytecode from text: hex with or without 0x, spaces and line breaks allowed. */
export function bytecodeOf(text: string): Uint8Array {
  const hex = text.replace(/\s+/g, "").replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]*$/.test(hex)) throw new Unreadable("bytecode is hex: 0-9 and a-f only");
  if (hex.length % 2) throw new Unreadable("bytecode has an odd number of hex digits");
  if (hex.length < 4) throw new Unreadable("bytecode is empty");
  if (hex.length > 2 * 2 * 1024 * 1024) throw new Unreadable("bytecode over 2 MB is not a contract");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** Each instruction's offset, opcode and pushed bytes (as hex). */
function* ops(code: Uint8Array): Generator<{ at: number; op: number; arg: string }> {
  for (let i = 0; i < code.length; ) {
    const op = code[i]!;
    const n = op >= 0x60 && op <= 0x7f ? op - 0x5f : 0;
    const arg = n ? [...code.subarray(i + 1, i + 1 + n)].map((b) => b.toString(16).padStart(2, "0")).join("") : "";
    yield { at: i, op, arg };
    i += 1 + n;
  }
}

/** The compiler's CBOR metadata at the code's end (a map, its length in the last two bytes), or null. */
function metadataOf(code: Uint8Array): Uint8Array | null {
  if (code.length < 4) return null;
  const len = (code[code.length - 2]! << 8) | code[code.length - 1]!;
  if (len < 8 || len > code.length - 2) return null;
  const meta = code.subarray(code.length - 2 - len, code.length - 2);
  return meta[0]! >= 0xa1 && meta[0]! <= 0xa7 ? meta : null; // a CBOR map of 1 to 7 entries
}

/** The compiler its metadata names: solc's version, or Vyper. */
function compilerOf(code: Uint8Array): string | null {
  const meta = metadataOf(code);
  if (!meta) return null;
  // look for the text key "solc" (0x64 's' 'o' 'l' 'c') then a 3-byte string (0x43): major, minor, patch
  for (let i = 0; i + 8 < meta.length; i++)
    if (meta[i] === 0x64 && meta[i + 1] === 0x73 && meta[i + 2] === 0x6f && meta[i + 3] === 0x6c && meta[i + 4] === 0x63 && meta[i + 5] === 0x43)
      return `solc ${meta[i + 6]}.${meta[i + 7]}.${meta[i + 8]}`;
  for (let i = 0; i + 5 < meta.length; i++)
    if (meta[i] === 0x66 && String.fromCharCode(...meta.subarray(i + 1, i + 7)) === "vyper") return "Vyper";
  return null;
}

export function readEvm(input: Uint8Array): EvmFacts {
  let code = input;
  const notes: string[] = [];
  // EIP-1167: the whole contract is a clone pointing at another
  const hex = [...code].map((b) => b.toString(16).padStart(2, "0")).join("");
  const clone = /^363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/.exec(hex);
  if (clone) {
    return { size: code.length, creation: false, functions: [], proxy: `a minimal clone (EIP-1167) of 0x${clone[1]}`, opcodes: { DELEGATECALL: 1 }, push0: false, compiler: null, notes: ["every call is passed on to that address: read its code instead"] };
  }
  // creation code: the constructor ends CODECOPY, a push or two, RETURN, INVALID, and the runtime it deploys follows
  let creation = false;
  const first = [...ops(code)];
  for (let i = 0; i < first.length; i++) {
    if (first[i]!.op !== 0x39) continue;
    const ret = first.slice(i + 1, i + 4).find((o) => o.op === 0xf3);
    if (!ret) continue;
    const start = ret.at + 2;
    if (code[ret.at + 1] === 0xfe && start < code.length && hex.startsWith("60", 2 * start)) {
      creation = true;
      code = code.subarray(start);
      notes.push(`creation code: its runtime starts at byte ${start}, and is what is read below`);
    }
    break;
  }
  const opcodes: Record<string, number> = { CALL: 0, DELEGATECALL: 0, STATICCALL: 0, CALLCODE: 0, SELFDESTRUCT: 0, CREATE: 0, CREATE2: 0, ORIGIN: 0, SSTORE: 0, LOG: 0 };
  const NAMED: Record<number, string> = { 0xf1: "CALL", 0xf4: "DELEGATECALL", 0xfa: "STATICCALL", 0xf2: "CALLCODE", 0xff: "SELFDESTRUCT", 0xf0: "CREATE", 0xf5: "CREATE2", 0x32: "ORIGIN", 0x55: "SSTORE" };
  // the metadata is data, not instructions: its bytes would read as random opcodes
  const meta = metadataOf(code);
  const list = [...ops(meta ? code.subarray(0, code.length - meta.length - 2) : code)];
  const selectors: string[] = [];
  let push0 = false;
  let slots = "";
  for (let i = 0; i < list.length; i++) {
    const o = list[i]!;
    if (NAMED[o.op]) opcodes[NAMED[o.op]!]!++;
    if (o.op >= 0xa0 && o.op <= 0xa4) opcodes.LOG!++;
    if (o.op === 0x5f) push0 = true;
    if (o.op === 0x7f) slots += `${o.arg} `;
    // the dispatcher: PUSH4 selector, (DUP2,) EQ, PUSH dest, JUMPI
    if (o.op === 0x63) {
      const a = list[i + 1];
      const b = list[i + 2];
      const eq = a?.op === 0x14 || (a?.op === 0x81 && b?.op === 0x14);
      if (eq && !selectors.includes(o.arg)) selectors.push(o.arg);
    }
  }
  let proxy: string | null = null;
  const named = new Set(selectors.map((s) => NAMES.get(s)));
  if (slots.includes(SLOT_IMPLEMENTATION)) proxy = "an upgradeable proxy (EIP-1967): its logic lives at the address in its implementation slot";
  else if (slots.includes(SLOT_BEACON)) proxy = "a beacon proxy (EIP-1967): its logic comes from a beacon";
  else if (slots.includes(SLOT_ZOS)) proxy = "an upgradeable proxy (ZeppelinOS, before EIP-1967): its logic lives at the address in its implementation slot";
  else if (opcodes.DELEGATECALL && (named.has("upgradeTo(address)") || named.has("implementation()"))) proxy = "an upgradeable proxy: it hands every call to an implementation its admin can replace";
  else if (opcodes.DELEGATECALL && selectors.length <= 2) proxy = "it hands calls to another contract (DELEGATECALL with almost no functions of its own): a proxy of some kind";
  if (slots.includes(SLOT_ADMIN)) notes.push("it keeps an EIP-1967 admin: someone can upgrade it");
  if (opcodes.SELFDESTRUCT) notes.push("it can SELFDESTRUCT");
  if (opcodes.ORIGIN) notes.push("it reads tx.origin, a classic mistake when used to check who is calling");
  if (opcodes.CALLCODE) notes.push("it uses CALLCODE, long deprecated");
  const functions = selectors.map((s) => {
    const name = NAMES.get(s) ?? null;
    return { selector: `0x${s}`, name, watch: name ? WATCH.has(name) : false };
  });
  if (functions.some((f) => f.watch)) notes.push(`functions that can change what holders may do or what a token is worth: ${functions.filter((f) => f.watch).map((f) => f.name).join(", ")}`);
  return { size: code.length, creation, functions, proxy, opcodes, push0, compiler: compilerOf(code), notes };
}
