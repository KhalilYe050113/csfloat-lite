// ==UserScript==
// @name         CSFloat Lite — 市场页浮点 / 种子
// @namespace    csfloat-lite
// @version      1.7.6
// @description  在 Steam 社区市场直接显示 CS2 物品的浮点值、涂装种子、磨损等级（纯本地解析 inspect 数据，零网络请求、零授权）
// @author       KhalilYee050113
// @homepageURL  https://github.com/KhalilYee050113/csfloat-lite
// @supportURL   https://github.com/KhalilYee050113/csfloat-lite/issues
// @updateURL    https://raw.githubusercontent.com/KhalilYee050113/csfloat-lite/main/csfloat-lite.user.js
// @downloadURL  https://raw.githubusercontent.com/KhalilYee050113/csfloat-lite/main/csfloat-lite.user.js
// @match        https://steamcommunity.com/market/listings/730/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
 * ============================================================================
 * CSFloat Lite v1.7.6 —— CSFloat Market Checker 的纯本地子集
 * ============================================================================
 * 范围：只处理市场挂单页。库存页与报价页另作一版。
 *
 * 与官方扩展的差别：
 *   · 官方：content script → 后台 service worker → executeScript(world:'MAIN')
 *     本脚本：直接跑在页面上下文（@grant none），少三层胶水
 *   · 官方：浮点来自本地 protobuf 解码（这点一致），排名/价格/schema 才走网络
 *     本脚本：只保留本地部分，因此无任何请求、无需任何权限
 *   · 官方：3.2MB（Lit + 8MB 蓝宝石数据）／本脚本：约 30KB
 *
 * 明确不做：排名、在售价、蓝宝石比例、Fade 百分比、贴纸名字、交易相关。
 * ============================================================================
 */

(function () {
    'use strict';

    const VERSION = '1.7.6';
    const APPID_CS2 = 730;
    const STORE_KEY = 'cfl:settings:v1';
    const SCAN_DEBOUNCE_MS = 150;
    const FALLBACK_INTERVAL_MS = 1000;

    /* ========================================================================
     * 1. 常量
     * ===================================================================== */

    /** 官方 FLOAT_CONDITION_BANDS，单位为百分比浮点值 */
    const WEAR_BANDS = [
        {min: 0, max: 7, color: '#4caf50'},
        {min: 7, max: 15, color: '#18a518'},
        {min: 15, max: 38, color: '#9acd32'},
        {min: 38, max: 45, color: '#cd5c5c'},
        {min: 45, max: 100, color: '#f92424'},
    ];

    /** 官方 src/lib/utils/dopplers.ts */
    const DOPPLER_PHASES = {
        415: 'Ruby', 416: 'Sapphire', 417: 'Black Pearl',
        418: 'Phase 1', 419: 'Phase 2', 420: 'Phase 3', 421: 'Phase 4',
        568: 'Emerald', 569: 'Phase 1', 570: 'Phase 2', 571: 'Phase 3', 572: 'Phase 4',
        617: 'Black Pearl', 618: 'Phase 2', 619: 'Sapphire',
        852: 'Phase 1', 853: 'Phase 2', 854: 'Phase 3', 855: 'Phase 4',
        1119: 'Emerald', 1120: 'Phase 1', 1121: 'Phase 2', 1122: 'Phase 3', 1123: 'Phase 4',
    };

    const CSS = `
.cfl-block{
  /* ========== 可调参数：只改这一段，其余样式不用动 ========== */
  --cfl-fs:14px;        /* 两行文字的字号 */
  --cfl-lh:1.45;        /* 行高（倍数，不带单位） */
  --cfl-bar-w:170px;    /* 磨损条宽度 */
  --cfl-bar-h:6px;      /* 磨损条高度 */
  --cfl-bar-mt:5px;     /* 磨损条与上方物品名的距离：想再下移就加大 */
  --cfl-bar-mb:5px;     /* 磨损条与 Float 行的距离 */
  /* ========================================================= */
  display:flex;flex-direction:column;align-items:flex-start;
  margin-top:1px;max-width:235px;
  font:var(--cfl-fs)/var(--cfl-lh) Arial,Helvetica,sans-serif;
  color:#8f9faf;
}
.cfl-bar{position:relative;display:flex;width:var(--cfl-bar-w);height:var(--cfl-bar-h);border-radius:3px;overflow:hidden;background:#0b141c;margin:var(--cfl-bar-mt) 0 var(--cfl-bar-mb)}
.cfl-seg{height:100%;opacity:.9}
.cfl-marker{position:absolute;top:-2px;width:2px;height:10px;background:#fff;box-shadow:0 0 2px #000}
.cfl-line{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cfl-num{font:inherit;color:inherit}
.cfl-dim{color:#8f9faf}
.cfl-tag{display:inline-block;margin-left:4px;padding:0 3px;border-radius:2px;background:#2a3f54;color:#cfd8e3;font-size:10px;line-height:13px}
/* 官方 :host 是 float:right + flex，没有 max-width。之前加 max-width:60% 会把第 6 个（挂件）挤到第二行 */
.cfl-stickers{float:right;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;margin:0 0 4px;max-width:100%}
.cfl-sticker{position:relative;display:inline-block;text-align:center}
.cfl-sticker a{display:flex;align-items:center;justify-content:center}
.cfl-sticker img{width:64px;height:48px;transition:transform .15s ease,filter .15s ease;filter:drop-shadow(0 0 1px rgba(0,0,0,.5))}
.cfl-sticker:hover img{transform:scale(1.25);position:relative;z-index:2;filter:drop-shadow(0 0 2px rgba(0,0,0,.8))}
.cfl-sticker-val{display:block;font-size:10px;color:#8f9faf;margin-top:2px;text-align:center;white-space:nowrap}
.cfl-sticker-fail{display:flex;align-items:center;justify-content:center;width:64px;height:48px;box-sizing:border-box;padding:2px;background:#1b2a38;border:1px solid #2a3f54;border-radius:2px;color:#93a4b5;font:9px/1.25 Arial,Helvetica,sans-serif;text-align:center;overflow:hidden;word-break:break-all}
.cfl-sticker:hover::after{content:attr(data-tip);position:absolute;left:50%;bottom:100%;transform:translateX(-50%);background:#c2c2c2;color:#3d3d3f;font:11px Arial,Helvetica,sans-serif;padding:5px;border-radius:3px;white-space:nowrap;z-index:1001;pointer-events:none}
.cfl-easy-inspect{position:absolute;left:0;top:0;width:74px;height:74px;line-height:74px;text-align:center;font-size:20px;display:none;text-decoration:none;background:rgba(0,0,0,.38);border-radius:2px;z-index:4}
.cfl-easy-inspect:hover{background:rgba(0,0,0,.6);text-decoration:none}
.market_listing_row:hover .cfl-easy-inspect{display:block}
.cfl-toolbar-wrap{margin:0 0 6px}
.cfl-toolbar{display:flex;align-items:center;gap:8px;padding:6px 9px;background:#16202c;border:1px solid #2a3f54;border-radius:2px;font:12px Arial,Helvetica,sans-serif;color:#8f98a0}
.cfl-brand{color:#66c0f4;font-weight:bold;letter-spacing:.2px}
.cfl-ver{color:#5c6b7a;margin-left:-4px}
.cfl-toolbar button{background:#2a3f54;border:1px solid #3d5a75;color:#c6d4df;border-radius:2px;padding:3px 9px;font-size:12px;cursor:pointer}
.cfl-toolbar button:hover{background:#3d5a75;color:#fff}
.cfl-toolbar button.cfl-active{background:#4c6b8a;color:#fff;border-color:#66c0f4}
.cfl-toolbar select{background:#2a3f54;border:1px solid #3d5a75;color:#c6d4df;border-radius:2px;font-size:12px;padding:2px 4px;cursor:pointer}
.cfl-stat{margin-left:auto;color:#7f8f9f}
.cfl-filterbar{display:flex;align-items:center;gap:6px;padding:6px 9px;background:#16202c;border:1px solid #2a3f54;border-top:none;font:12px Arial,Helvetica,sans-serif;color:#8f98a0}
.cfl-colour{width:20px;height:20px;padding:0;border:1px solid #3d5a75;background:#16202c;cursor:pointer}
.cfl-expr{flex:0 1 360px;background:#0f1922;border:1px solid #2a3f54;color:#c6d4df;font:12px Consolas,Menlo,monospace;padding:3px 6px;border-radius:2px;outline:none}
.cfl-expr:focus{border-color:#66c0f4}
.cfl-expr::placeholder{color:#5c6b7a}
.cfl-status{width:13px;text-align:center;font-weight:bold}
.cfl-status.ok{color:#7ec87e}
.cfl-status.bad{color:#e06c6c}
.cfl-filterbar button{background:#2a3f54;border:1px solid #3d5a75;color:#c6d4df;border-radius:2px;padding:3px 9px;font-size:12px;cursor:pointer}
.cfl-filterbar button:hover{background:#3d5a75;color:#fff}
.cfl-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 9px 7px;background:#16202c;border:1px solid #2a3f54;border-top:none;border-radius:0 0 2px 2px}
.cfl-chip{display:flex;align-items:center;gap:5px;background:#1b2a38;border:1px solid #2a3f54;border-radius:2px;padding:2px 6px;font:12px Consolas,Menlo,monospace;color:#c6d4df}
.cfl-chip i{width:9px;height:9px;border-radius:1px;display:inline-block}
.cfl-chip b{cursor:pointer;color:#7f8f9f;font-weight:normal;padding:0 1px}
.cfl-chip b:hover{color:#e06c6c}
.cfl-errline{padding:0 9px 5px;background:#16202c;border:1px solid #2a3f54;border-top:none;color:#e06c6c;font:11px Consolas,Menlo,monospace}
`;

    /* ========================================================================
     * 2. 通用小工具
     * ===================================================================== */

    function pageGlobal(name) {
        try {
            return window[name];
        } catch (e) {
            return undefined;
        }
    }

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }

    function clamp(n, lo, hi) {
        return n < lo ? lo : n > hi ? hi : n;
    }

    /* ========================================================================
     * 3. CRC32 —— 校验 inspect 数据尾部
     * ===================================================================== */

    const CRC_TABLE = (function () {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[i] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        let c = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    }

    /**
     * Valve 的校验算法（对齐官方 getChecksum）：
     *   crc   = CRC32(0x00 前缀 + 载荷)
     *   x_crc = (crc & 0xFFFF) ^ (载荷长度 * crc)
     * 注意 CRC 的输入含首字节 0x00，但长度乘数不含它。
     */
    function inspectChecksum(payload) {
        const buf = new Uint8Array(payload.length + 1);
        buf.set(payload, 1);
        const crc = crc32(buf);
        return ((crc & 0xffff) ^ Math.imul(payload.length, crc)) >>> 0;
    }

    /* ========================================================================
     * 4. protobuf 解码器
     * ===================================================================== */

    function hexToBytes(hex) {
        const clean = String(hex).replace(/[^0-9a-fA-F]/g, '');
        if (clean.length === 0 || clean.length % 2 !== 0) throw new Error('inspect 数据长度非法');
        const out = new Uint8Array(clean.length / 2);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
        return out;
    }

    function readVarint(bytes, start) {
        let value = 0;
        let mul = 1;
        let i = start;
        for (;;) {
            if (i >= bytes.length) throw new Error('varint 越界');
            const b = bytes[i++];
            value += (b & 0x7f) * mul;
            if ((b & 0x80) === 0) break;
            mul *= 128;
            if (mul > 2 ** 63) throw new Error('varint 过长');
        }
        return [value, i];
    }

    const scratchBuffer = new ArrayBuffer(4);
    const scratchF32 = new Float32Array(scratchBuffer);
    const scratchU32 = new Uint32Array(scratchBuffer);

    /** 把 uint32 当作 float32 的位模式解释 —— paintwear 就是这么存的 */
    function bitsToFloat(bits) {
        scratchU32[0] = bits >>> 0;
        return scratchF32[0];
    }

    function readFloatLE(bytes, offset) {
        return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getFloat32(0, true);
    }

    function decodeUtf8(bytes) {
        try {
            return new TextDecoder('utf-8').decode(bytes);
        } catch (e) {
            return '';
        }
    }

    /** 贴纸 / 挂件子消息 */
    function parseSticker(bytes) {
        const out = {slot: 0, stickerId: 0, wear: 0, pattern: 0};
        let i = 0;
        while (i < bytes.length) {
            let tag;
            [tag, i] = readVarint(bytes, i);
            const field = tag >>> 3;
            const wire = tag & 7;
            if (field === 0) break;

            if (wire === 0) {
                let v;
                [v, i] = readVarint(bytes, i);
                if (field === 1) out.slot = v;
                else if (field === 2) out.stickerId = v;
                else if (field === 3) out.wear = bitsToFloat(v);
                else if (field === 10) out.pattern = v;
            } else if (wire === 5) {
                const v = readFloatLE(bytes, i);
                i += 4;
                if (field === 3) out.wear = v;
            } else if (wire === 1) {
                i += 8;
            } else if (wire === 2) {
                let len;
                [len, i] = readVarint(bytes, i);
                i += len;
            } else {
                break;
            }
            if (i > bytes.length) break;
        }
        return out;
    }

    /** CEconItemPreviewDataBlock 主消息 */
    function parsePayload(bytes) {
        const item = {
            itemid: '',
            defindex: 0,
            paintindex: 0,
            rarity: 0,
            quality: 0,
            floatvalue: 0,
            paintseed: 0,
            inventory: 0,
            origin: 0,
            customname: '',
            stickers: [],
            keychains: [],
            variations: [],
            isStatTrak: false,
            isSouvenir: false,
        };

        let i = 0;
        while (i < bytes.length) {
            let tag;
            [tag, i] = readVarint(bytes, i);
            const field = tag >>> 3;
            const wire = tag & 7;
            if (field === 0) break; // 非法 tag，其后是填充区

            if (wire === 0) {
                let v;
                [v, i] = readVarint(bytes, i);
                switch (field) {
                    case 2: item.itemid = String(v); break;
                    case 3: item.defindex = v; break;
                    case 4: item.paintindex = v; break;
                    case 5: item.rarity = v; break;
                    case 6: item.quality = v; break;
                    case 7: item.floatvalue = bitsToFloat(v); break; // ← 浮点真正的来源
                    case 8: item.paintseed = v; break;
                    case 9: item.isStatTrak = true; break;
                    case 13: item.inventory = v; break;
                    case 14: item.origin = v; break;
                }
            } else if (wire === 5) {
                const f = readFloatLE(bytes, i);
                i += 4;
                if (field === 7) item.floatvalue = f; // 少数数据用 fixed32 存浮点
            } else if (wire === 1) {
                i += 8;
            } else if (wire === 2) {
                let len;
                [len, i] = readVarint(bytes, i);
                const sub = bytes.subarray(i, i + len);
                i += len;
                if (field === 11) item.customname = decodeUtf8(sub);
                else if (field === 12) item.stickers.push(parseSticker(sub));
                else if (field === 20) item.keychains.push(parseSticker(sub));
                else if (field === 22) item.variations.push(parseSticker(sub));
            } else {
                break;
            }
        }

        item.isSouvenir = item.quality === 12;
        return item;
    }

    /**
     * 解码一条完整的 inspect 十六进制数据。
     * 结构：[0x00 前缀][protobuf 载荷][4 字节 CRC32]
     * 首字节非 0 时说明整段被单字节 XOR 掩码，首字节即 key。
     *
     * 校验不通过直接抛错：交易场景里，错误的浮点比没有浮点更危险。
     */
    function decodeInspectHex(hex) {
        let bytes = hexToBytes(hex);
        if (bytes.length < 8) throw new Error('inspect 数据过短');

        let masked = false;
        if (bytes[0] !== 0) {
            const key = bytes[0];
            const unmasked = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) unmasked[i] = bytes[i] ^ key;
            bytes = unmasked;
            masked = true;
            if (bytes[0] !== 0) throw new Error('掩码解码失败');
        }

        const payload = bytes.subarray(1, bytes.length - 4);
        const expected =
            ((bytes[bytes.length - 4] << 24) |
                (bytes[bytes.length - 3] << 16) |
                (bytes[bytes.length - 2] << 8) |
                bytes[bytes.length - 1]) >>>
            0;

        // 只有「0x00 前缀 + payload + CRC」这种标准封装才校验 CRC。
        // 掩码格式（整段 XOR）的尾部 4 字节不是这个校验值，官方也不校验，
        // 强行校验会把 Steam 真实挂单的数据判成损坏 —— 这里对齐官方行为。
        if (!masked && inspectChecksum(payload) !== expected) throw new Error('校验未通过');

        const item = parsePayload(payload);
        if (!(item.floatvalue >= 0 && item.floatvalue <= 1)) throw new Error('浮点值越界');
        if (masked && !item.defindex) throw new Error('掩码数据解析失败');
        item.masked = masked;
        item.hex = hex;
        return item;
    }

    /** 从各种形态的 inspect 链接里抽出十六进制 */
    function extractInspectHex(link) {
        if (!link || typeof link !== 'string') return null;

        let s = link.trim();
        try {
            s = decodeURIComponent(s);
        } catch (e) {
            /* 含非法百分号编码时忽略 */
        }

        // 从标记之后取数据。onclick 里可能还带着引号、括号、分号之类的尾巴
        const marker = /csgo_econ_action_preview/i.exec(s);
        let hex = marker ? s.slice(marker.index + marker[0].length) : s;
        hex = hex.trim().split(/['"`)\];,]/)[0].trim();

        // 老格式 S<steamid>A<assetid>D<hex>：必须整段匹配，
        // 否则十六进制里的 D 会被当成分隔符
        const legacy = hex.match(/^S\d+A\d+D([0-9a-fA-F]+)/i);
        if (legacy) hex = legacy[1];

        hex = hex.replace(/[^0-9a-fA-F]/g, '');
        if (hex.length < 10 || hex.length % 2 !== 0) return null;
        return hex;
    }

    function inspectLinkToItem(link) {
        const hex = extractInspectHex(link);
        if (!hex) throw new Error('无法从链接提取 inspect 数据');
        return decodeInspectHex(hex);
    }

    /* ========================================================================
     * 5. 物品类型判定（决定显示浮点还是图案，或直接跳过）
     * ===================================================================== */

    function isSkin(asset) {
        if (!asset) return false;
        if (Array.isArray(asset.tags) && asset.tags.length) {
            return asset.tags.some(
                (t) => t.category === 'Weapon' || (t.category === 'Type' && t.internal_name === 'Type_Hands')
            );
        }
        const name = asset.market_hash_name || '';
        return ['★', 'Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'].some((k) =>
            name.includes(k)
        );
    }

    function isCharm(asset) {
        if (!asset) return false;
        if (typeof asset.type === 'string' && asset.type.endsWith('Charm')) return true;
        return (
            Array.isArray(asset.tags) &&
            asset.tags.some((t) => t.category === 'Type' && t.internal_name === 'CSGO_Tool_Keychain')
        );
    }

    function isHighlightCharm(asset) {
        return (
            isCharm(asset) &&
            Array.isArray(asset.tags) &&
            asset.tags.some((t) => t.internal_name === 'highlight')
        );
    }

    /* ========================================================================
     * 6. 展示用工具
     * ===================================================================== */

    function wearName(f) {
        if (f <= 0.07) return 'Factory New';
        if (f <= 0.15) return 'Minimal Wear';
        if (f <= 0.38) return 'Field-Tested';
        if (f <= 0.45) return 'Well-Worn';
        return 'Battle-Scarred';
    }

    function wearShort(f) {
        if (f <= 0.07) return 'FN';
        if (f <= 0.15) return 'MW';
        if (f <= 0.38) return 'FT';
        if (f <= 0.45) return 'WW';
        return 'BS';
    }

    function wearColor(f) {
        for (const band of WEAR_BANDS) {
            if (f * 100 <= band.max) return band.color;
        }
        return '#f92424';
    }

    function fmtFloat(f) {
        return f.toFixed(14);
    }

    /* ========================================================================
     * 7. 市场页采集器
     * ===================================================================== */

    function rowsContainer() {
        const container = document.getElementById('searchResultsRows');
        if (container) return container;
        // 新版页面可能没有这个 id，退化为第一行所在的父容器
        const first = findRows()[0];
        return first ? first.parentElement : null;
    }

    function isRow(node) {
        return node instanceof HTMLElement && node.classList.contains('market_listing_row');
    }

    /** 一行里有没有真正的内容（价格、购买按钮、物品链接） */
    function isMeaningfulRow(row) {
        if (!row) return false;
        if (row.querySelector('a[href*="/market/listings/"]')) return true;
        const text = String(row.textContent || '');
        return text.length > 4 && /[¥$€£]|购买|Buy|Float/.test(text);
    }

    /**
     * 行发现器。
     * 旧版：`#searchResultsRows .market_listing_row`。
     * 新版：class 可能变了，退化为「从物品链接往上找到含价格的容器」。
     */
    let cachedRows = null;
    let cachedRowsAt = 0;

    function findRows() {
        const now = Date.now();
        if (cachedRows && now - cachedRowsAt < 300) return cachedRows;

        const primary = Array.from(document.querySelectorAll('#searchResultsRows .market_listing_row'));
        const meaningful = primary.filter(isMeaningfulRow);
        if (meaningful.length) {
            cachedRows = meaningful;
            cachedRowsAt = now;
            return cachedRows;
        }

        // 兜底：以「指向物品页的链接」为锚点往上找行容器
        const anchors = document.querySelectorAll('a[href*="/market/listings/730/"]');
        const rows = [];
        const seen = new Set();
        for (const anchor of anchors) {
            const row = rowContainerOf(anchor);
            if (row && !seen.has(row)) {
                seen.add(row);
                rows.push(row);
            }
        }

        cachedRows = rows.length ? rows : primary;
        cachedRowsAt = now;
        return cachedRows;
    }

    /** 从物品链接往上走，找到「像一行」的容器：文本里带价格或购买按钮 */
    function rowContainerOf(anchor) {
        let node = anchor;
        for (let depth = 0; depth < 6 && node && node.parentElement; depth++) {
            const parent = node.parentElement;
            const text = String(parent.textContent || '');
            if (text.length > 8 && text.length < 900 && /[¥$€£]|购买|Buy/.test(text)) return parent;
            node = parent;
        }
        return anchor.parentElement;
    }

    /**
     * 挂单号。旧版市场页在物品名上带 id="listing_<id>_name"；
     * 新版页面结构变了，这里退化为多路探测，拿不到也不影响后续（链接可以直接从 DOM 取）。
     */
    function listingIdOf(row) {
        const nameEl = row.querySelector('.market_listing_item_name[id^="listing_"]');
        if (nameEl) {
            const m = /^listing_(\d+)_name$/.exec(nameEl.id);
            if (m) return m[1];
        }

        const idFromRow = /^listing_(\d+)$/.exec(row.id || '');
        if (idFromRow) return idFromRow[1];

        const ds = row.dataset || {};
        if (ds.listingId && /^\d+$/.test(ds.listingId)) return ds.listingId;
        if (ds.listingid && /^\d+$/.test(ds.listingid)) return ds.listingid;

        // 购买按钮的 onclick 里通常带着 "listing_1234567890"
        for (const node of row.querySelectorAll('[onclick]')) {
            const m = /listing_(\d+)/.exec(node.getAttribute('onclick') || '');
            if (m) return m[1];
        }

        // 最后兜底：整行 HTML 里搜一次
        const m = /listing_(\d{6,})/.exec(row.outerHTML || '');
        return m ? m[1] : null;
    }

    /**
     * 从行 DOM 里直接找检视链接。
     * 新版市场页把「在游戏中检视」内联渲染，链接就在 DOM 里，
     * 这条路不依赖任何 Steam 全局变量。
     *
     * 先按常见属性扫，再对行内每个元素的所有属性名做一次全量扫描——
     * 新版页面可能把它挂在 data-* 或 onclick 之类意想不到的地方。
     */
    function findInspectLinkInDom(row) {
        if (!row) return null;

        const quick = row.querySelectorAll('a[href], [data-inspect-link], [data-inspect], [onclick]');
        for (const node of quick) {
            for (const name of ['href', 'data-inspect-link', 'data-inspect', 'onclick']) {
                const raw = node.getAttribute(name);
                if (raw && raw.indexOf('csgo_econ_action_preview') !== -1) return raw;
            }
        }

        // 全量属性扫描（限制节点数，避免大行拖慢）
        const nodes = row.querySelectorAll('*');
        const limit = Math.min(nodes.length, 30);
        for (let i = 0; i < limit; i++) {
            const node = nodes[i];
            if (!node.getAttributeNames) continue;
            for (const name of node.getAttributeNames()) {
                const value = node.getAttribute(name);
                if (value && value.indexOf('csgo_econ_action_preview') !== -1) return value;
            }
        }

        // 最后再看一眼整行 HTML（有些链接只出现在注释或文本节点里）
        const html = String(row.outerHTML || '');
        if (html.indexOf('csgo_econ_action_preview') !== -1) {
            const m = /["']([^"']*csgo_econ_action_preview[^"']*)["']/.exec(html);
            if (m) return m[1];
        }

        return null;
    }

    /** 行内是否有资产 id（新版页面可能挂在行元素上） */
    function assetIdFromRow(row) {
        const ds = row.dataset || {};
        for (const key of ['assetId', 'assetid', 'asset_id']) {
            if (ds[key] && /^\d+$/.test(ds[key])) return ds[key];
        }
        const holderId = /^730_\d+_(\d+)$/.exec(row.id || '');
        if (holderId) return holderId[1];
        return null;
    }

    /** 没有 asset 时，用物品名判断是不是挂件（挂件显示图案，不显示浮点） */
    function looksLikeCharm(row) {
        const nameEl =
            row.querySelector('.market_listing_item_name') || row.querySelector('a[href*="/market/listings/"]');
        const text = ((nameEl && nameEl.textContent) || '').trim();
        return /^(挂件|Charm)\s*[|｜]/i.test(text);
    }

    /** 先找 context 2，找不到再扫其它 context（2026-03 后挂单物品会进 16） */
    function findAsset(assetId) {
        if (!assetId) return null;
        const assets = pageGlobal('g_rgAssets');
        const contexts = assets && assets[APPID_CS2];
        if (!contexts) return null;
        if (contexts[2] && contexts[2][assetId]) return contexts[2][assetId];
        for (const key of Object.keys(contexts)) {
            const hit = contexts[key] && contexts[key][assetId];
            if (hit) return hit;
        }
        return null;
    }

    function assetProperty(asset, propertyId) {
        const props = (asset && asset.asset_properties) || [];
        const hit = props.find((p) => p.propertyid === propertyId);
        return hit ? hit.string_value : undefined;
    }

    /** 市场页用 market_actions，其它上下文用 actions；都要处理 %propid:6% 占位符 */
    function inspectLinkOf(asset) {
        if (!asset) return null;
        const action = (asset.market_actions && asset.market_actions[0]) || (asset.actions && asset.actions[0]);
        if (!action || !action.link) return null;
        if (action.link.indexOf('%propid:6%') === -1) return action.link;
        const data = assetProperty(asset, 6);
        return data ? action.link.replace('%propid:6%', data) : null;
    }

    /**
     * 判断一行的最终状态。
     * 返回 {state: 'ok'|'skip'|'err'|'retry', info?, asset?, assetId?, kind?}
     *
     * 取数优先级：行 DOM 里的检视链接 → Steam 全局变量 → 放弃。
     * 新版市场页把检视链接内联进每一行，这条路最稳，也最不依赖 Steam 的内部结构。
     */
    function evaluateRow(row) {
        const listingId = listingIdOf(row);
        const domLink = findInspectLinkInDom(row);
        const listingInfo = pageGlobal('g_rgListingInfo');

        let assetId = assetIdFromRow(row);
        if (!assetId && listingId && listingInfo && listingInfo[listingId] && listingInfo[listingId].asset) {
            assetId = listingInfo[listingId].asset.id || null;
        }

        const asset = findAsset(assetId);

        // 高亮挂件没有浮点，官方也不显示
        if (asset && isHighlightCharm(asset)) return {state: 'skip'};

        // 类型判定。拿到可解码的链接就按皮肤渲染——宁可多显示一行，
        // 也不要因为 tags 缺失把整页判成"非皮肤"。
        let kind;
        if (asset && isCharm(asset)) kind = 'charm';
        else if (asset && isSkin(asset)) kind = 'skin';
        else if (looksLikeCharm(row)) kind = 'charm';
        else kind = 'skin';

        // ── 1) 行内已经有检视链接：直接解码，不依赖任何全局数据 ──
        // 关键：2026-03 之后挂单进 trade-protected(context 16)，此时 asset_properties 常常是空的，
        // 但 Steam 仍会在行内渲染完整链接。这种情况下必须先用 DOM 链接，
        // 否则会被下面的 trade-protected 守卫误杀（v1.3.0 之前的 bug）。
        let domError = null;
        if (domLink) {
            try {
                return {state: 'ok', info: inspectLinkToItem(domLink), asset, assetId, kind, link: domLink};
            } catch (e) {
                domError = e;
            }
        }

        // ── 2) 全局变量路径 ──
        if (asset && asset.unowned_contextid === '16' && !assetProperty(asset, 2)) {
            return {state: 'skip'};
        }

        const globalLink = asset ? inspectLinkOf(asset) : null;

        if (!globalLink) {
            if (domError) return {state: 'err', error: (domError && domError.message) || String(domError), assetId};
            // 两条路都拿不到：可能是 Steam 全局还没就绪，给几次重试机会再放弃
            const tries = Number(row.dataset.cflTries || 0);
            if (!listingInfo && tries < 10) {
                row.dataset.cflTries = String(tries + 1);
                return {state: 'retry'};
            }
            // 'empty' 而不是 'skip'：新版页面可能在悬停后才生成检视链接，
            // 这类行会在后续扫描里被复查，一旦出现链接就能补上
            return {state: 'empty'};
        }

        try {
            return {state: 'ok', info: inspectLinkToItem(globalLink), asset, assetId, kind, link: globalLink};
        } catch (e) {
            return {state: 'err', error: (e && e.message) || String(e), assetId};
        }
    }

    /* ========================================================================
     * 7.5 新版市场（React）适配
     * ---------------------------------------------------------------------
     * 新版 Steam 市场是 React 应用，不暴露 g_rgListingInfo / g_rgAssets。
     * 官方扩展的做法：从 React Fiber 的 memoizedProps 里读 listing 对象
     * （src/lib/utils/fiber.ts + components/market/react/listing.ts）。
     * 这里复刻同一套：锚点 → __reactFiber$xxx → 向上找带 listing 的 props
     * → listing.asset.asset_properties[propertyid=6] 即 inspect 数据。
     * ===================================================================== */

    function isReactMarket() {
        try {
            return !!(window.SSR && window.SSR.reactRoot);
        } catch (e) {
            return false;
        }
    }

    function reactFiberOf(element) {
        let keys;
        try {
            keys = Object.keys(element);
        } catch (e) {
            return null;
        }
        const key = keys.find((k) => k.indexOf('__reactFiber$') === 0);
        return key ? element[key] : null;
    }

    /** 沿 fiber.return 向上找带 listing 的那一层 */
    function reactFiberPropsOf(element) {
        let fiber = reactFiberOf(element);
        for (let depth = 0; depth < 30 && fiber; depth++) {
            const props = fiber.memoizedProps;
            if (props && typeof props === 'object' && props.listing && props.listing.asset) return props;
            fiber = fiber.return;
        }
        return null;
    }

    /** 从物品链接往上，找到承载 listing 的卡片元素 */
    function findReactCard(anchor) {
        let node = anchor;
        for (let depth = 0; depth < 10 && node; depth++) {
            const props = reactFiberPropsOf(node);
            if (props) return {card: node, listing: props.listing};
            node = node.parentElement;
        }
        return null;
    }

    /**
     * 复刻官方 getInspectLink：
     *   listing.description.actions[0].link 里的 %propid:6% 用资产属性替换；
     *   没有占位符就直接用；连 action 都没有就退化为「hex 直接拼链接」。
     */
    function reactInspectSource(listing) {
        if (!listing) return null;
        const props = (listing.asset && listing.asset.asset_properties) || [];
        const prop6 = props.find((p) => p.propertyid === 6);
        const hex = prop6 && prop6.string_value;

        const actions = (listing.description && listing.description.actions) || [];
        const action = actions[0];
        if (action && action.link) {
            if (action.link.indexOf('%propid:6%') === -1) return action.link;
            if (hex) return action.link.replace('%propid:6%', hex);
        }
        if (hex) return 'steam://run/730//+csgo_econ_action_preview ' + hex;
        return null;
    }

    function listingLooksLikeCharm(listing, nameText) {
        const tags = (listing.description && listing.description.tags) || [];
        if (tags.some((t) => t.internal_name === 'CSGO_Tool_Keychain')) return true;
        const type = listing.description && listing.description.type;
        if (typeof type === 'string' && type.endsWith('Charm')) return true;
        return /^(挂件|Charm)\s*[|｜]/i.test(nameText || '');
    }

    const reactState = {cards: []};

    function scanReact() {
        const anchors = document.querySelectorAll('a[href*="/market/listings/730/"]');
        const cards = [];
        const seen = new Set();
        let changed = false;

        for (const anchor of anchors) {
            const hit = findReactCard(anchor);
            if (!hit || seen.has(hit.card)) continue;
            seen.add(hit.card);
            cards.push(hit.card);

            const card = hit.card;
            if (card.dataset.cflState === 'ok' || card.dataset.cflState === 'err') continue;

            const source = reactInspectSource(hit.listing);
            if (!source) {
                card.dataset.cflState = 'empty';
                changed = true;
                continue;
            }

            const nameText = String(anchor.textContent || '');
            const kind = listingLooksLikeCharm(hit.listing, nameText) ? 'charm' : 'skin';

            try {
                const info = inspectLinkToItem(source);
                card.dataset.cflState = 'ok';
                changed = true;
                if (kind === 'skin') state.infos.set(card, info);
                state.meta.set(card, {info, kind, price: readPrice(card), asset: null});
                if (!card.querySelector('.cfl-block')) {
                    const block = kind === 'charm' ? buildCharmBlock(info) : buildFloatBlock(info);
                    if (!insertBlockAfter(anchor, block) && anchor.parentElement) {
                        anchor.parentElement.appendChild(block);
                    }
                }
            } catch (e) {
                card.dataset.cflState = 'err';
                changed = true;
                state.failed++;
                console.debug(
                    '[CSFloat Lite] React 卡片解析失败',
                    hit.listing && hit.listing.listingid,
                    (e && e.message) || e
                );
            }
        }

        reactState.cards = cards;
        if (!changed) return;
        updateStats();
        applyFilters();
    }

    /* ========================================================================
     * 8. 渲染
     * ===================================================================== */

    function injectCss() {
        if (document.getElementById('cfl-style')) return;
        const style = document.createElement('style');
        style.id = 'cfl-style';
        style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    function buildFloatBar(floatvalue) {
        const bar = el('div', 'cfl-bar');
        for (const band of WEAR_BANDS) {
            const seg = el('div', 'cfl-seg');
            seg.style.width = band.max - band.min + '%';
            seg.style.backgroundColor = band.color;
            bar.appendChild(seg);
        }
        const marker = el('div', 'cfl-marker');
        marker.style.left = 'calc(' + clamp(floatvalue * 100, 0, 100).toFixed(3) + '% - 1px)';
        bar.appendChild(marker);
        bar.title = 'Float ' + fmtFloat(floatvalue) + ' / ' + wearName(floatvalue) + '（条带为 0–1 全区间）';
        return bar;
    }

    function buildTag(text) {
        return el('span', 'cfl-tag', text);
    }

    function buildFloatBlock(info) {
        const block = el('div', 'cfl-block');

        // 与原版一致：浮点条独占一行（宽度由块决定），下面两行文字
        block.appendChild(buildFloatBar(info.floatvalue));

        const line1 = el('div', 'cfl-line');
        // 与 Paint Seed 用同一字体、同一灰色（官方在 floatbar 里也是纯文本，不按磨损上色）
        line1.appendChild(document.createTextNode('Float: ' + fmtFloat(info.floatvalue)));
        if (info.isStatTrak) line1.appendChild(buildTag('ST'));
        if (info.isSouvenir) line1.appendChild(buildTag('SV'));
        block.appendChild(line1);

        const parts = ['Paint Seed: ' + info.paintseed];
        const phase = DOPPLER_PHASES[info.paintindex];
        if (phase) parts.push(phase);
        block.appendChild(el('div', 'cfl-line cfl-dim', parts.join(' · ')));

        return block;
    }

    /** 把块插到锚点元素后面（失败返回 false） */
    function insertBlockAfter(anchorEl, block) {
        if (anchorEl && typeof anchorEl.insertAdjacentElement === 'function') {
            anchorEl.insertAdjacentElement('afterend', block);
            return true;
        }
        return false;
    }

    function buildCharmBlock(info) {
        const pattern = info.keychains.length ? info.keychains[0].pattern : '未知';
        const block = el('div', 'cfl-block');
        block.appendChild(el('div', 'cfl-line cfl-dim', 'Pattern: #' + pattern));
        return block;
    }

    /* ------------------------------------------------------------------
     * 印花：照官方思路重建
     * 官方 sticker_display.ts 的做法：
     *   1. 删掉 Steam 的 .market_listing_row_details
     *   2. 从 asset.descriptions 的 HTML 里解析出印花类型/名字/图片
     *   3. 自己渲染一个 float:right 的容器，图片 64×48，下方标磨损/图案
     * 这里 1:1 移植，唯一放宽的是冒号与分隔符兼容全角（官方只认 ": "）。
     * ------------------------------------------------------------------ */

    const APPLIED_NAME_RE = /<br>([^<]*?)[:：]\s*(.*)<\/center>/;
    const APPLIED_IMG_RE = /(<img .*?>)/g;

    /** 官方 parseImageTag 的移植 + 容错（属性顺序、单双引号都认） */
    function extractImgSrc(imgHtml) {
        const m = String(imgHtml).match(/\ssrc\s*=\s*["']([^"']+)["']/i);
        return m ? m[1] : '';
    }

    /**
     * 图片地址归一化。描述里的 src 可能是：
     *   //community.cloudflare.steamstatic.com/...  （协议相对）
     *   /economy/sticker/123                        （站内相对，steamcommunity.com 上没这个路径）
     *   ...?a=1&amp;b=2                               （HTML 转义）
     */
    function normalizeImageUrl(raw) {
        if (!raw || typeof raw !== 'string') return '';
        let u = raw.trim().replace(/&amp;/g, '&');
        if (!u) return '';
        if (/^data:image\//i.test(u)) return u; // 内联图（演示页/占位图）原样保留
        if (u.indexOf('data:') === 0) return '';
        if (u.indexOf('//') === 0) return 'https:' + u;
        if (u.charAt(0) === '/') return 'https://community.cloudflare.steamstatic.com' + u;
        if (!/^https?:/i.test(u)) return '';
        return u;
    }

    /** 用解码出来的 stickerId 直接拼 CDN 地址（描述里的图挂了时兜底） */
    function builtImageUrls(kind, id) {
        if (!id) return [];
        const segs = kind === 'charm' ? ['charm', 'keychain', 'sticker'] : ['sticker'];
        const out = [];
        for (const seg of segs) {
            out.push('https://community.cloudflare.steamstatic.com/economy/' + seg + '/' + id);
            out.push('https://steamcommunity-a.akamaihd.net/economy/' + seg + '/' + id);
        }
        return out;
    }

    /** 官方 parseAppliedItems 的移植；kind 决定兜底图地址与跳转链接形态 */
    function parseAppliedItems(html, kind, valueFormatter) {
        if (!html) return [];
        const text = String(html);
        const nameMatch = text.match(APPLIED_NAME_RE);
        const imagesHtml = text.match(APPLIED_IMG_RE) || [];
        if (!nameMatch) return [];

        const type = nameMatch[1].trim();
        const names = nameMatch[2]
            .split(/,\s*|[、，]/)
            .map((n) => n.trim())
            .filter(Boolean);

        // 图片数与名字数不一致时取大者：少的一方由后面的 ID 兜底补上，不丢内容
        const count = Math.max(imagesHtml.length, names.length);
        // 官方 sticker_display.ts:165 的判定是 parsedType === 'Sticker' | 'Charm'——
        // 即"描述里的类别文字是否恰好是英文"。英文站点上 hash 名就是 "Sticker | xxx"，
        // 可以深链到物品页；本地化站点（中文「印花」/「挂件」）上一律走搜索，
        // 因为物品页要求 market_hash_name 逐字相同，而描述里给的是展示名：
        // 括号全半角、赛事后缀、"(全息)" 这类写法只要差一个字，就会落到「此物品不在货架上」。
        const deepLink = type === 'Sticker' || type === 'Charm';
        const base = deepLink
            ? 'https://steamcommunity.com/market/listings/730/'
            : 'https://steamcommunity.com/market/search?appid=730&q=';

        const out = [];
        for (let i = 0; i < count; i++) {
            const name = names[i] || '';
            out.push({
                kind,
                type,
                name,
                decodedIndex: i,
                imageUrl: imagesHtml[i] ? extractImgSrc(imagesHtml[i]) : '',
                url: base + encodeURIComponent(type + ' | ' + name),
                value: valueFormatter(i),
            });
        }
        return out;
    }

    /**
     * 官方 loadStickers / loadKeychains 的移植。
     * 有挂件时：印花在倒数第二块、挂件在最后一块；否则印花就是最后一块。
     * 判定比官方多一条：含「挂件 / charm」但没有任何印花字样的块，不当作印花块——
     * 否则挂件名字会被塞进印花行（表现为「0% + 挂件 | xxx」这种错位）。
     */
    function appliedItemsOf(asset, info) {
        const descriptions = (asset && asset.descriptions) || [];
        const hasCharm = !!(info.keychains && info.keychains.length);
        if (!descriptions.length) return {stickers: [], keychains: []};

        const isHtml = (d) => !!d && d.type === 'html' && typeof d.value === 'string';
        const mentionsSticker = (d) => isHtml(d) && /sticker|印花|贴纸/i.test(d.value);

        const stickerDesc = descriptions[descriptions.length - (hasCharm ? 2 : 1)];
        const charmDesc = hasCharm ? descriptions[descriptions.length - 1] : null;

        const stickerOk = mentionsSticker(stickerDesc);
        // 官方：最后一块若提到 sticker 且不是 Sticker Slab，就不是挂件块
        const charmOk =
            isHtml(charmDesc) &&
            (!/sticker|印花|贴纸/i.test(charmDesc.value) || /sticker\s*slab|印花罐/i.test(charmDesc.value));

        const stickers = stickerOk
            ? parseAppliedItems(stickerDesc.value, 'sticker', (i) => {
                  const st = info.stickers[i];
                  return st && typeof st.wear === 'number' ? Math.round(st.wear * 100) + '%' : '';
              })
            : [];

        const keychains = charmOk
            ? parseAppliedItems(charmDesc.value, 'charm', (i) => {
                  const kc = info.keychains[i];
                  return kc && kc.pattern ? '#' + kc.pattern : '';
              })
            : [];

        return {stickers, keychains};
    }

    /**
     * 官方 helpers.ts 的 inlineEasyInspect 移植：
     * 往物品图容器里追加 <a class="csfloat-easy-inspect" href="…">🔍</a>，
     * 平时 display:none，行悬停时才显示（官方 global.css 的 .market_recent_listing_row:hover）。
     * 官方只在拿到检视链接时才插入，且装了 Steam Inventory Helper 时跳过（它自带放大镜）。
     */
    function installEasyInspect(row, link) {
        if (!link || row.dataset.cflInspect === '1') return;

        const container = row.querySelector('.market_listing_item_img_container');
        if (!container) return;
        row.dataset.cflInspect = '1';

        // 绝对定位需要一个定位祖先；Steam 的容器多数已是 relative，只在没有时补
        try {
            const gcs = window.getComputedStyle ? window.getComputedStyle.bind(window) : null;
            if (gcs && gcs(container).position === 'static') container.style.position = 'relative';
        } catch (e) {
            container.style.position = 'relative';
        }

        if (row.querySelector('.sih-inspect-magnifier')) return;

        const a = document.createElement('a');
        a.className = 'cfl-easy-inspect';
        a.href = link;
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        a.title = '在游戏中检视';
        a.textContent = '🔍';
        container.appendChild(a);
    }

    /**
     * 官方 item_row_wrapper.ts:171 的移植：
     *   itemNameBlock.parent().find('.market_listing_row_action')?.parent().remove()
     * 删掉 Steam 自带的「在游戏中检视…」那一整列——检视入口已经由上面的 🔍 接管。
     */
    function removeSteamInspectAction(row) {
        const action = row.querySelector('.market_listing_row_action');
        if (!action) return;
        const cell = action.parentElement;
        if (cell && cell.classList && cell.classList.contains('market_listing_right_cell')) cell.remove();
        else action.remove();
    }

    /** Steam 原生那排印花图里，取一张图的实际地址 */
    function nativeImgSrc(img) {
        return img.currentSrc || img.getAttribute('src') || '';
    }

    /**
     * 一张印花图按优先级排队：原生 DOM 里已经在显示的 → 描述里解析出来的 → 按 stickerId 拼的。
     * 前一个加载失败就换下一个，全失败才退化成文字块。
     */
    function imageCandidates(item, info, nativeSrc) {
        const list = [];
        const push = (u) => {
            const n = normalizeImageUrl(u);
            if (n && list.indexOf(n) === -1) list.push(n);
        };
        push(nativeSrc);
        push(item.imageUrl);
        const decoded =
            item.kind === 'charm' ? info.keychains[item.decodedIndex] : info.stickers[item.decodedIndex];
        for (const u of builtImageUrls(item.kind, decoded && decoded.stickerId)) push(u);
        return list;
    }

    /** 挂图，并挂一条「失败就换下一个候选」的链 */
    function attachStickerImage(link, item, label, candidates) {
        const fallback = () => {
            const chip = el('span', 'cfl-sticker-fail', item.name || label);
            chip.setAttribute('title', label + '（印花图片无法加载）');
            if (link.parentNode) link.replaceChild(chip, link.firstChild);
        };

        if (!candidates.length) {
            fallback();
            return;
        }

        const img = document.createElement('img');
        img.alt = label;
        img.loading = 'lazy';
        img.src = candidates[0];

        let tier = 0;
        img.addEventListener('error', () => {
            tier++;
            if (tier < candidates.length) {
                img.src = candidates[tier];
                return;
            }
            fallback();
        });

        link.appendChild(img);
    }

    /**
     * 渲染自己的印花条。
     * 顺序严格照官方：**先删掉 Steam 的原生块，再画**。
     * 官方 item_row_wrapper 里是先 `.market_listing_row_details").remove()`，
     * 然后才创建 csfloat-sticker-display；解析不出来就是空白，没有降级。
     *
     * 与官方唯一的差别：删之前把原生那排图的 src 记下来。
     * 那些图是 Steam 自己渲染、页面上本来就能显示的，用它们当第一候选最可靠。
     */
    function renderStickers(row, info, asset) {
        if (row.dataset.cflStickers === '1') return;

        const nameBlock = row.querySelector('.market_listing_item_name_block');
        if (!nameBlock) return;
        row.dataset.cflStickers = '1';

        // 第一步：删原生块（与官方一致，先删后画）
        const details = row.querySelector('.market_listing_row_details');
        const nativeSrcs = details
            ? Array.from(details.querySelectorAll('img')).map(nativeImgSrc)
            : [];
        if (details) details.remove();

        // 第二步：解析 + 重建
        const parsed = appliedItemsOf(asset, info);
        const items = parsed.stickers.concat(parsed.keychains);
        if (!items.length) return;

        // 原生图数量与解析结果一致时，按下标当作第一候选
        const aligned = nativeSrcs.length === items.length ? nativeSrcs : null;

        const host = el('div', 'cfl-stickers');
        items.forEach((item, i) => {
            const cell = el('div', 'cfl-sticker');
            const label = item.type + ' | ' + item.name;
            cell.setAttribute('data-tip', label);

            const a = document.createElement('a');
            a.href = item.url;
            a.target = '_blank';
            a.rel = 'noreferrer noopener';
            attachStickerImage(a, item, label, imageCandidates(item, info, aligned ? aligned[i] : ''));
            cell.appendChild(a);

            if (item.value) cell.appendChild(el('span', 'cfl-sticker-val', item.value));
            host.appendChild(cell);
        });

        nameBlock.insertBefore(host, nameBlock.firstChild);
    }

    function renderRow(row, info, kind, asset, link) {
        if (row.querySelector('.cfl-block')) return;

        // 官方 connectedCallback 的顺序：先补 🔍，再删 Steam 的「在游戏中检视…」
        installEasyInspect(row, link);
        removeSteamInspectAction(row);

        const block = kind === 'charm' ? buildCharmBlock(info) : buildFloatBlock(info);

        // 紧贴物品名之后插入：这样不会被 Steam 的贴纸行顶下去，各行高度才一致
        const nameEl = row.querySelector('.market_listing_item_name');
        if (insertBlockAfter(nameEl, block)) {
            renderStickers(row, info, asset);
            return;
        }

        const nameBlock = row.querySelector('.market_listing_item_name_block');
        if (nameBlock) {
            nameBlock.appendChild(block);
            renderStickers(row, info, asset);
            return;
        }

        row.appendChild(block);
    }

    /* ========================================================================
     * 9. 设置持久化
     * ===================================================================== */

    const defaultSettings = {pageSize: 10, sortDir: 0};

    function loadSettings() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (!raw) return {...defaultSettings};
            const parsed = JSON.parse(raw);
            return {
                pageSize: [10, 25, 50, 100].includes(parsed.pageSize) ? parsed.pageSize : 10,
                sortDir: [-1, 0, 1].includes(parsed.sortDir) ? parsed.sortDir : 0,
            };
        } catch (e) {
            return {...defaultSettings};
        }
    }

    function saveSettings(patch) {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify({...settings, ...patch}));
        } catch (e) {
            /* 隐私模式下不可写，忽略 */
        }
        Object.assign(settings, patch);
    }

    const settings = loadSettings();

    /* ========================================================================
     * 10. 排序与每页数量
     * ===================================================================== */

    const state = {
        infos: new WeakMap(), // row -> 解码结果（仅皮肤，供排序用）
        meta: new WeakMap(), // row -> {info, kind, price}，供筛选器取变量
        orderSeq: 0, // 行首次出现序号，用于「原序」
        parsed: 0,
        failed: 0,
    };

    const ui = {
        toolbar: null,
        stat: null,
        select: null,
        buttons: {},
        colour: null,
        expr: null,
        status: null,
        chips: null,
        errline: null,
    };

    function applySort(dir, persist) {
        // 新版市场由 React 管理 DOM，重排会被下一次渲染覆盖甚至报错，直接不做
        if (isReactMarket()) {
            setActiveSort(0);
            return;
        }
        const rows = findRows();
        if (!rows.length) return;

        const parent = rows[0].parentElement;
        if (!parent || rows.some((r) => r.parentElement !== parent)) {
            setActiveSort(dir);
            if (persist) saveSettings({sortDir: dir});
            return; // 结构不支持重排时静默跳过，不破坏页面
        }

        if (dir === 0) {
            const seq = (node) =>
                node.dataset.cflOrder === undefined ? Number.MAX_SAFE_INTEGER : Number(node.dataset.cflOrder);
            rows.sort((a, b) => seq(a) - seq(b));
        } else {
            rows.sort((a, b) => {
                const fa = state.infos.get(a);
                const fb = state.infos.get(b);
                if (!fa && !fb) return 0;
                if (!fa) return 1; // 没有浮点的永远排最后
                if (!fb) return -1;
                return (fa.floatvalue - fb.floatvalue) * dir;
            });
        }

        for (const row of rows) parent.appendChild(row);
        setActiveSort(dir);
        if (persist) saveSettings({sortDir: dir});
    }

    function setActiveSort(dir) {
        for (const [key, btn] of Object.entries(ui.buttons)) {
            if (!btn) continue;
            btn.classList.toggle('cfl-active', Number(key) === dir);
        }
    }

    function applyPageSize(size, persist) {
        const searchResults = pageGlobal('g_oSearchResults');
        if (!searchResults || typeof searchResults.GoToPage !== 'function') return false;

        if (searchResults.m_cPageSize !== size) {
            searchResults.m_cPageSize = size;
            searchResults.GoToPage(0, true);
        }
        if (ui.select) ui.select.value = String(size);
        if (persist) saveSettings({pageSize: size});
        return true;
    }

    /* ========================================================================
     * 10.5 筛选器（简化比较式）
     * ---------------------------------------------------------------------
     * 语法：变量 + 比较符 + and / or / not + 括号
     *   float <= 0.25
     *   0.20 <= float and float <= 0.23
     *   float >= 0.54 or price < 100
     *   phase == "Ruby"
     * 命中即把整行染成该条件的颜色；多条件命中取 RGB 平均色（与官方一致）。
     * ===================================================================== */

    const FILTER_STORE_KEY = 'cfl:filters:v1';
    const FILTER_PALETTE = ['#354908', '#1a4f8a', '#7a4a12', '#5c2a63'];
    const FILTER_VARS = ['float', 'seed', 'price', 'pattern', 'phase', 'minwearfloat', 'maxwearfloat'];

    let filters = loadFilters();

    function loadFilters() {
        try {
            const raw = localStorage.getItem(FILTER_STORE_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(arr)) return [];
            return arr
                .filter((f) => f && typeof f.expression === 'string' && typeof f.colour === 'string')
                .map((f) => ({expression: f.expression, colour: f.colour}));
        } catch (e) {
            return [];
        }
    }

    function saveFilters() {
        try {
            localStorage.setItem(FILTER_STORE_KEY, JSON.stringify(filters));
        } catch (e) {
            /* 隐私模式下忽略 */
        }
    }

    function tokenize(src) {
        const tokens = [];
        let i = 0;
        while (i < src.length) {
            const c = src[i];
            if (/\s/.test(c)) {
                i++;
                continue;
            }
            if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
                let j = i;
                while (j < src.length && /[0-9.]/.test(src[j])) j++;
                const num = Number(src.slice(i, j));
                if (!isFinite(num)) throw new Error('数字格式错误: ' + src.slice(i, j));
                tokens.push({t: 'num', v: num});
                i = j;
                continue;
            }
            if (c === '"' || c === "'") {
                let j = i + 1;
                let out = '';
                while (j < src.length && src[j] !== c) out += src[j++];
                if (j >= src.length) throw new Error('字符串没有闭合');
                tokens.push({t: 'str', v: out});
                i = j + 1;
                continue;
            }
            if (/[a-zA-Z_]/.test(c)) {
                let j = i;
                while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
                const word = src.slice(i, j).toLowerCase();
                if (word === 'and' || word === 'or' || word === 'not') tokens.push({t: 'op', v: word});
                else tokens.push({t: 'id', v: word});
                i = j;
                continue;
            }
            const two = src.slice(i, i + 2);
            if (two === '<=' || two === '>=' || two === '==' || two === '!=') {
                tokens.push({t: 'op', v: two});
                i += 2;
                continue;
            }
            if (two === '&&' || two === '||') {
                tokens.push({t: 'op', v: two === '&&' ? 'and' : 'or'});
                i += 2;
                continue;
            }
            if ('<>()'.indexOf(c) !== -1) {
                tokens.push({t: 'op', v: c});
                i++;
                continue;
            }
            if (c === '-') {
                tokens.push({t: 'op', v: 'neg'});
                i++;
                continue;
            }
            if (c === '!') {
                tokens.push({t: 'op', v: 'not'});
                i++;
                continue;
            }
            throw new Error('无法识别的字符: ' + c);
        }
        return tokens;
    }

    /** 递归下降解析，产出 AST */
    function parseExpression(src) {
        const tokens = tokenize(src);
        let pos = 0;
        const peek = () => tokens[pos];
        const next = () => tokens[pos++];
        const expect = (v) => {
            const t = next();
            if (!t || t.v !== v) throw new Error('缺少 ' + v);
        };

        function parseOr() {
            let left = parseAnd();
            while (peek() && peek().t === 'op' && peek().v === 'or') {
                next();
                left = {op: 'or', l: left, r: parseAnd()};
            }
            return left;
        }

        function parseAnd() {
            let left = parseCmp();
            while (peek() && peek().t === 'op' && peek().v === 'and') {
                next();
                left = {op: 'and', l: left, r: parseCmp()};
            }
            return left;
        }

        function parseCmp() {
            const left = parseUnary();
            const t = peek();
            if (t && t.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].indexOf(t.v) !== -1) {
                next();
                return {op: t.v, l: left, r: parseUnary()};
            }
            return left;
        }

        function parseUnary() {
            const t = peek();
            if (t && t.t === 'op' && t.v === 'not') {
                next();
                return {op: 'not', l: parseUnary()};
            }
            if (t && t.t === 'op' && t.v === 'neg') {
                next();
                return {op: 'neg', l: parseUnary()};
            }
            return parsePrimary();
        }

        function parsePrimary() {
            const t = next();
            if (!t) throw new Error('表达式不完整');
            if (t.t === 'num' || t.t === 'str') return {lit: t.v};
            if (t.t === 'id') {
                if (FILTER_VARS.indexOf(t.v) === -1) throw new Error('未知变量: ' + t.v);
                return {var: t.v};
            }
            if (t.t === 'op' && t.v === '(') {
                const node = parseOr();
                expect(')');
                return node;
            }
            throw new Error('无法解析: ' + t.v);
        }

        const ast = parseOr();
        if (pos !== tokens.length) throw new Error('表达式有多余内容');
        return ast;
    }

    function evalNode(node, vars) {
        if ('lit' in node) return node.lit;
        if ('var' in node) {
            const v = vars[node.var];
            if (v === undefined || v === null) throw new Error('missing');
            return v;
        }
        switch (node.op) {
            case 'and':
                return !!evalNode(node.l, vars) && !!evalNode(node.r, vars);
            case 'or':
                return !!evalNode(node.l, vars) || !!evalNode(node.r, vars);
            case 'not':
                return !evalNode(node.l, vars);
            case 'neg':
                return -evalNode(node.l, vars);
            case '==':
                return evalNode(node.l, vars) === evalNode(node.r, vars);
            case '!=':
                return evalNode(node.l, vars) !== evalNode(node.r, vars);
            default: {
                const l = evalNode(node.l, vars);
                const r = evalNode(node.r, vars);
                if (typeof l !== 'number' || typeof r !== 'number') throw new Error('只能比较数字');
                if (node.op === '<') return l < r;
                if (node.op === '<=') return l <= r;
                if (node.op === '>') return l > r;
                return l >= r;
            }
        }
    }

    /** 编译并试跑一次，尽早暴露语法/类型错误 */
    function compileFilter(expression) {
        const ast = parseExpression(expression);
        evalNode(ast, {
            float: 0.15,
            seed: 100,
            price: 10,
            pattern: 1000,
            phase: '1',
            minwearfloat: 0.15,
            maxwearfloat: 0.38,
        });
        return ast;
    }

    function wearRangeOf(f) {
        if (f <= 0.07) return [0, 0.07];
        if (f <= 0.15) return [0.07, 0.15];
        if (f <= 0.38) return [0.15, 0.38];
        if (f <= 0.45) return [0.38, 0.45];
        return [0.45, 1];
    }

    function phaseLabel(paintindex) {
        const p = DOPPLER_PHASES[paintindex];
        return p ? p.replace('Phase', '').trim() : '';
    }

    /** 从行内价格文本解析数字（页面显示价口径） */
    function parsePrice(text) {
        if (!text) return null;
        const s = String(text).replace(/[^\d.,]/g, '');
        if (!s) return null;

        const lastDot = s.lastIndexOf('.');
        const lastComma = s.lastIndexOf(',');
        let decPos = -1;

        if (lastDot >= 0 && lastComma >= 0) {
            decPos = Math.max(lastDot, lastComma);
        } else if (lastDot >= 0) {
            decPos = s.length - lastDot - 1 === 3 ? -1 : lastDot;
        } else if (lastComma >= 0) {
            decPos = s.length - lastComma - 1 === 3 ? -1 : lastComma;
        }

        const intPart = (decPos >= 0 ? s.slice(0, decPos) : s).replace(/[.,]/g, '');
        const frac = decPos >= 0 ? s.slice(decPos + 1) : '';
        const n = Number(intPart + (frac ? '.' + frac : ''));
        return isFinite(n) ? n : null;
    }

    function readPrice(row) {
        const el =
            row.querySelector('.market_listing_price_with_fee') ||
            row.querySelector('.market_listing_price') ||
            row.querySelector('.market_listing_their_price');
        const value = parsePrice(el ? el.textContent : '');
        return value === null ? undefined : value;
    }

    function varsForRow(row) {
        const meta = state.meta.get(row);
        const vars = {minwearfloat: 0, maxwearfloat: 1};
        if (meta && meta.info) {
            const info = meta.info;
            vars.float = info.floatvalue;
            vars.seed = info.paintseed;
            vars.pattern = info.keychains && info.keychains.length ? info.keychains[0].pattern : 0;
            vars.phase = phaseLabel(info.paintindex);
            const band = wearRangeOf(info.floatvalue);
            vars.minwearfloat = band[0];
            vars.maxwearfloat = band[1];
        }
        if (meta && typeof meta.price === 'number') vars.price = meta.price;
        return vars;
    }

    function averageColour(colours) {
        const sum = [0, 0, 0];
        let n = 0;
        for (const c of colours) {
            const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(c);
            if (!m) continue;
            sum[0] += parseInt(m[1], 16);
            sum[1] += parseInt(m[2], 16);
            sum[2] += parseInt(m[3], 16);
            n++;
        }
        if (!n) return null;
        const rgb = sum.map((v) => Math.round(v / n));
        return '#' + ((1 << 24) + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]).toString(16).slice(1);
    }

    /** 对当前页所有行重新求值并着色 */
    function applyFilters() {
        const rows = isReactMarket() ? reactState.cards : findRows();
        if (!rows.length) return;

        const active = [];
        for (const f of filters) {
            try {
                if (!f.__ast) f.__ast = parseExpression(f.expression);
                active.push(f);
            } catch (e) {
                /* 语法坏掉的条件跳过，不影响其它条件 */
            }
        }

        const hits = new Array(filters.length).fill(0);

        for (const row of rows) {
            if (!active.length) {
                row.style.backgroundColor = '';
                continue;
            }
            const vars = varsForRow(row);
            const colours = [];
            for (const f of active) {
                let matched = false;
                try {
                    matched = !!evalNode(f.__ast, vars);
                } catch (e) {
                    matched = false; // 变量缺失（如未解析出价格）视为不匹配
                }
                if (matched) {
                    colours.push(f.colour);
                    hits[filters.indexOf(f)]++;
                }
            }
            const colour = colours.length ? averageColour(colours) : null;
            row.style.backgroundColor = colour || '';
        }

        updateChipHits(hits);
    }

    /* ========================================================================
     * 11. 工具条
     * ===================================================================== */

    function buildToolbar() {
        const wrap = el('div', 'cfl-toolbar-wrap');
        wrap.id = 'cfl-toolbar';

        const bar = el('div', 'cfl-toolbar');
        bar.appendChild(el('span', 'cfl-brand', 'CSFloat Lite'));
        bar.appendChild(el('span', 'cfl-ver', 'v' + VERSION));

        const mkBtn = (label, dir) => {
            const btn = el('button', null, label);
            btn.type = 'button';
            btn.classList.add('cfl-sort');
            btn.addEventListener('click', () => applySort(dir, true));
            ui.buttons[dir] = btn;
            return btn;
        };

        // 新版市场是 React 渲染的，重排 DOM 会被覆盖，所以只在旧版页面提供排序与分页
        const legacy = !isReactMarket();
        if (legacy) {
            bar.appendChild(mkBtn('浮点 ↑', 1));
            bar.appendChild(mkBtn('浮点 ↓', -1));
            bar.appendChild(mkBtn('原序', 0));

            const select = document.createElement('select');
            select.title = '每页显示数量';
            for (const size of [10, 25, 50, 100]) {
                const opt = document.createElement('option');
                opt.value = String(size);
                opt.textContent = size + ' / 页';
                select.appendChild(opt);
            }
            select.value = String(settings.pageSize);
            select.addEventListener('change', () => applyPageSize(Number(select.value), true));
            ui.select = select;
            bar.appendChild(select);
        }

        const stat = el('span', 'cfl-stat', '');
        stat.id = 'cfl-stat';
        ui.stat = stat;

        const diagBtn = el('button', null, '诊断');
        diagBtn.type = 'button';
        diagBtn.title = '解析不出来时点这里：把页面结构信息复制到剪贴板';
        diagBtn.addEventListener('click', () => {
            const text = JSON.stringify(diag(), null, 2);
            copyText(text).then((ok) => {
                alert(ok ? '诊断信息已复制到剪贴板，直接粘贴发给我即可' : '复制失败，请按 F12 打开控制台手动复制');
            });
        });

        bar.appendChild(stat);
        bar.appendChild(diagBtn);

        // 第二行：筛选条件输入；第三行：已添加的条件
        wrap.appendChild(bar);
        wrap.appendChild(buildFilterBar());
        wrap.appendChild(buildChips());
        ui.errline = el('div', 'cfl-errline', '');
        ui.errline.style.display = 'none';
        wrap.appendChild(ui.errline);

        return wrap;
    }

    function buildFilterBar() {
        const bar = el('div', 'cfl-filterbar');

        const colour = document.createElement('input');
        colour.type = 'color';
        colour.className = 'cfl-colour';
        colour.value = FILTER_PALETTE[filters.length % FILTER_PALETTE.length];
        colour.title = '命中颜色';
        ui.colour = colour;
        bar.appendChild(colour);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cfl-expr';
        input.placeholder = '如 float <= 0.25 或 price < 120（回车添加）';
        ui.expr = input;
        bar.appendChild(input);

        const status = el('span', 'cfl-status', '');
        ui.status = status;
        bar.appendChild(status);

        const add = el('button', null, '添加');
        add.type = 'button';
        add.addEventListener('click', addFilter);
        bar.appendChild(add);

        let timer = null;
        input.addEventListener('input', () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(validateInput, 350);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addFilter();
            }
        });

        return bar;
    }

    function showFilterError(message) {
        if (!ui.errline) return;
        if (!message) {
            ui.errline.style.display = 'none';
            ui.errline.textContent = '';
            return;
        }
        ui.errline.style.display = 'block';
        ui.errline.textContent = message;
    }

    function validateInput() {
        const expr = ui.expr ? ui.expr.value.trim() : '';
        if (!ui.status) return false;
        if (!expr) {
            ui.status.textContent = '';
            ui.status.className = 'cfl-status';
            showFilterError('');
            return false;
        }
        try {
            compileFilter(expr);
            ui.status.textContent = '✓';
            ui.status.className = 'cfl-status ok';
            showFilterError('');
            return true;
        } catch (e) {
            ui.status.textContent = '✗';
            ui.status.className = 'cfl-status bad';
            showFilterError((e && e.message) || String(e));
            return false;
        }
    }

    function addFilter() {
        if (!ui.expr) return;
        const expr = ui.expr.value.trim();
        if (!expr) return;
        if (!validateInput()) return;

        filters.push({expression: expr, colour: ui.colour ? ui.colour.value : FILTER_PALETTE[0]});
        saveFilters();

        ui.expr.value = '';
        ui.status.textContent = '';
        ui.status.className = 'cfl-status';
        showFilterError('');
        if (ui.colour) ui.colour.value = FILTER_PALETTE[filters.length % FILTER_PALETTE.length];

        rebuildChips();
        applyFilters();
    }

    function buildChips() {
        const wrap = el('div', 'cfl-chips');
        wrap.id = 'cfl-chips';
        ui.chips = wrap;
        renderChips();
        return wrap;
    }

    function rebuildChips() {
        if (!ui.chips) return;
        renderChips();
    }

    function renderChips() {
        const wrap = ui.chips;
        if (!wrap) return;
        wrap.textContent = '';
        wrap.style.display = filters.length ? 'flex' : 'none';

        filters.forEach((f, index) => {
            const chip = el('span', 'cfl-chip');
            chip.dataset.index = String(index);

            const swatch = el('i');
            swatch.style.backgroundColor = f.colour;
            swatch.title = '点击改颜色';
            swatch.style.cursor = 'pointer';
            chip.appendChild(swatch);

            chip.appendChild(document.createTextNode(f.expression));

            const del = el('b', null, '×');
            del.title = '删除该条件';
            del.addEventListener('click', () => {
                filters.splice(index, 1);
                saveFilters();
                rebuildChips();
                applyFilters();
            });
            chip.appendChild(del);

            const picker = document.createElement('input');
            picker.type = 'color';
            picker.value = f.colour;
            picker.style.display = 'none';
            picker.addEventListener('input', () => {
                f.colour = picker.value;
                swatch.style.backgroundColor = f.colour;
                saveFilters();
                applyFilters();
            });
            swatch.addEventListener('click', () => picker.click());
            chip.appendChild(picker);

            wrap.appendChild(chip);
        });
    }

    function updateChipHits(hits) {
        if (!ui.chips) return;
        const chips = ui.chips.querySelectorAll('.cfl-chip');
        chips.forEach((chip) => {
            const index = Number(chip.dataset.index);
            if (hits && hits[index] !== undefined) chip.title = '命中 ' + hits[index] + ' 行';
        });
    }

    function mountToolbar() {
        const container = rowsContainer();
        if (!container || !container.parentNode) return;
        if (!ui.toolbar || !ui.toolbar.isConnected) {
            if (document.getElementById('cfl-toolbar')) {
                ui.toolbar = document.getElementById('cfl-toolbar');
                return;
            }
            ui.toolbar = buildToolbar();
            container.parentNode.insertBefore(ui.toolbar, container);
            setActiveSort(settings.sortDir);
        }
    }

    function updateStats() {
        if (!ui.stat) return;
        const rows = isReactMarket() ? reactState.cards : findRows();
        const counts = {ok: 0, err: 0, empty: 0, skip: 0};
        for (const row of rows) {
            const st = row.dataset.cflState;
            if (st && counts[st] !== undefined) counts[st]++;
        }

        let text = '已解析 ' + counts.ok + '/' + rows.length;
        if (counts.err) {
            text += '（失败 ' + counts.err + '）';
        } else if (rows.length && counts.ok === 0) {
            // 0 行成功时把原因写出来，免得只能看到一个干巴巴的 0
            if (counts.empty) text += '（未找到检视链接）';
            else if (counts.skip) text += '（全部跳过）';
        }
        ui.stat.textContent = text;
    }

    /* ========================================================================
     * 12. 扫描调度
     * ===================================================================== */

    let scanTick = 0;

    function scan() {
        // 两套市场实现分开走：新版是 React，数据在 fiber 里，DOM 上没有
        if (isReactMarket()) {
            scanReact();
            return;
        }

        const rows = findRows();
        // 每 10 轮（约 10 秒）复查一次「拿不到检视链接」的行，等 Steam 把链接补进 DOM
        const recheck = ++scanTick % 10 === 0;
        let changed = false;
        let newlyParsed = 0;

        for (const row of rows) {
            const prev = row.dataset.cflState;
            if (prev) {
                if (!(recheck && prev === 'empty')) continue;
                delete row.dataset.cflState;
            }
            if (row.dataset.cflOrder === undefined) row.dataset.cflOrder = String(state.orderSeq++);

            const result = evaluateRow(row);
            if (result.state === 'retry') continue; // Steam 全局未就绪，下一轮再来

            row.dataset.cflState = result.state;
            changed = true;

            if (result.state === 'ok') {
                state.parsed++;
                newlyParsed++;
                // 只有皮肤参与浮点排序；挂件显示的是图案编号，它的 float 字段没有意义
                if (result.kind === 'skin') state.infos.set(row, result.info);
                state.meta.set(row, {info: result.info, kind: result.kind, price: readPrice(row), asset: result.asset});
                renderRow(row, result.info, result.kind, result.asset, result.link);
            } else if (result.state === 'err') {
                state.failed++;
                console.debug('[CSFloat Lite] 解析失败', result.assetId, result.error);
            }
        }

        if (!changed) return;
        updateStats();
        applyFilters();
        // 只有真的解析出新行才重排，避免复查时把用户的滚动位置搅乱
        if (newlyParsed && settings.sortDir !== 0) applySort(settings.sortDir, false);
    }

    let scheduled = null;
    function scheduleScan() {
        if (scheduled) return;
        scheduled = setTimeout(() => {
            scheduled = null;
            try {
                mountToolbar();
                scan();
            } catch (e) {
                console.warn('[CSFloat Lite] 扫描异常', e);
            }
        }, SCAN_DEBOUNCE_MS);
    }

    function hasQueryParameter(name) {
        return new URLSearchParams(location.search).has(name);
    }

    function start() {
        injectCss();
        mountToolbar();
        scan();

        // 记住的每页数量：显式指定 start 参数时不覆盖（Steam 分页会出 bug）
        const wantsPageSize = settings.pageSize !== 10 && !hasQueryParameter('start');
        let pageSizeApplied = wantsPageSize ? applyPageSize(settings.pageSize, false) : true;
        if (settings.sortDir !== 0) applySort(settings.sortDir, false);

        if (typeof MutationObserver === 'function') {
            try {
                const observer = new MutationObserver(scheduleScan);
                observer.observe(document.documentElement, {childList: true, subtree: true});
            } catch (e) {
                /* 观察器不可用时靠下面的兜底轮询 */
            }
        }

        // 兜底：观察器失效（Steam 局部重建 DOM）时仍能补齐
        setInterval(() => {
            try {
                mountToolbar();
                scan();
                // g_oSearchResults 可能比 document-idle 更晚就绪，补一次
                if (!pageSizeApplied) pageSizeApplied = applyPageSize(settings.pageSize, false);
            } catch (e) {
                /* 忽略 */
            }
        }, FALLBACK_INTERVAL_MS);

        console.log(
            '%c CSFloat Lite v' + VERSION + ' %c 纯本地解析，零请求 ',
            'background:#004594;color:#fff;padding:1px 5px;border-radius:2px',
            'color:#7f8f9f'
        );
    }

    /* ========================================================================
     * 13. 对外接口（测试与调试用）
     * ===================================================================== */

    /**
     * 诊断：页面结构变了导致解析不出来时，点工具条上的「诊断」按钮，
     * 或在控制台执行 __csfloatLite.diag()。
     */
    /* ------------------------------------------------------------------
     * 样式调参：不用改脚本、不用重装，控制台一行就能试
     *   __csfloatLite.tune({fontSize: 13})
     *   __csfloatLite.tune({barTop: 8, barGap: 6})
     *   __csfloatLite.tune({fontSize: 12, barTop: 4})   // 想回默认就再跑一次
     * 只影响本次页面，刷新即恢复脚本里的默认值。
     * ------------------------------------------------------------------ */

    const TUNE_MAP = {
        fontSize: {css: '--cfl-fs', unit: 'px'},
        lineHeight: {css: '--cfl-lh', unit: ''},
        barWidth: {css: '--cfl-bar-w', unit: 'px'},
        barHeight: {css: '--cfl-bar-h', unit: 'px'},
        barTop: {css: '--cfl-bar-mt', unit: 'px'},
        barGap: {css: '--cfl-bar-mb', unit: 'px'},
    };

    function tune(opts) {
        const decl = [];
        for (const key of Object.keys(opts || {})) {
            const spec = TUNE_MAP[key];
            if (!spec) continue;
            const raw = opts[key];
            const value = typeof raw === 'number' ? raw + spec.unit : String(raw);
            decl.push(spec.css + ':' + value);
        }
        if (!decl.length) return null;

        let node = document.getElementById('cfl-tune');
        if (!node) {
            node = document.createElement('style');
            node.id = 'cfl-tune';
            (document.head || document.documentElement).appendChild(node);
        }
        node.textContent = '.cfl-block{' + decl.join(';') + '}';
        return {applied: decl.join(';'), available: Object.keys(TUNE_MAP)};
    }

    function diag() {
        const react = isReactMarket();
        const rows = react ? reactState.cards : findRows();
        const first = rows[0];
        const primary = document.querySelectorAll('#searchResultsRows .market_listing_row').length;
        const html = String(document.documentElement.innerHTML || '');
        const markerCount = (html.match(/csgo_econ_action_preview/g) || []).length;

        const attrNames = new Set();
        if (first && first.querySelectorAll) {
            for (const node of first.querySelectorAll('*')) {
                if (!node.getAttributeNames) continue;
                for (const n of node.getAttributeNames()) attrNames.add(n);
            }
        }

        const states = {ok: 0, err: 0, empty: 0, skip: 0, none: 0};
        for (const r of rows) {
            const s = r.dataset.cflState;
            if (s && states[s] !== undefined) states[s]++;
            else states.none++;
        }

        // React 模式下额外探一个真实 listing，看看字段齐不齐
        let firstListing = null;
        if (react) {
            const anchor = document.querySelector('a[href*="/market/listings/730/"]');
            const hit = anchor && findReactCard(anchor);
            if (hit && hit.listing) {
                const asset = hit.listing.asset || {};
                const desc = hit.listing.description || {};
                firstListing = {
                    assetid: asset.assetid || null,
                    propertyIds: (asset.asset_properties || []).map((p) => p.propertyid),
                    hasActions: !!(desc.actions && desc.actions.length),
                    actionLinkHead: desc.actions && desc.actions[0] ? String(desc.actions[0].link).slice(0, 90) : null,
                    decoded: (() => {
                        const src = reactInspectSource(hit.listing);
                        if (!src) return 'no-source';
                        try {
                            const info = inspectLinkToItem(src);
                            return {float: info.floatvalue, seed: info.paintseed};
                        } catch (e) {
                            return 'decode-error: ' + ((e && e.message) || e);
                        }
                    })(),
                };
            }
        }

        const out = {
            version: VERSION,
            url: location.href,
            mode: react ? 'react' : typeof window.g_rgListingInfo === 'object' ? 'legacy' : 'unknown',
            rows: {found: rows.length, primary},
            states,
            globals: {
                g_rgListingInfo: typeof window.g_rgListingInfo,
                g_rgAssets: typeof window.g_rgAssets,
                g_oSearchResults: typeof window.g_oSearchResults,
                SSR: typeof window.SSR,
            },
            stickers: (() => {
                const list = isReactMarket() ? reactState.cards : findRows();
                for (const row of list) {
                    const meta = state.meta.get(row);
                    if (!meta || !meta.asset) continue;
                    const descs = meta.asset.descriptions || [];
                    if (!descs.length) continue;
                    const last = descs[descs.length - 1];
                    const parsed = appliedItemsOf(meta.asset, meta.info);
                    const rendered = row.querySelector('.cfl-stickers');
                    const imgs = rendered ? Array.from(rendered.querySelectorAll('img')) : [];
                    return {
                        descCount: descs.length,
                        lastType: last && last.type,
                        lastValueHead: last ? String(last.value || '').slice(0, 240) : null,
                        parsedStickers: parsed.stickers.length,
                        parsedKeychains: parsed.keychains.length,
                        names: parsed.stickers.concat(parsed.keychains).map((it) => it.name),
                        rendered: !!rendered,
                        // 实际用到的图片地址 + 已经退化成文字块的格子数
                        imgSrcs: imgs.map((i) =>
                            String(i.currentSrc || i.getAttribute('src') || '').slice(0, 100)
                        ),
                        failedCells: rendered ? rendered.querySelectorAll('.cfl-sticker-fail').length : 0,
                    };
                }
                return null;
            })(),
            dom: {
                hasSearchResultsRows: !!document.getElementById('searchResultsRows'),
                inspectMarkerInPage: markerCount,
                firstRowHasLink: first ? !!findInspectLinkInDom(first) : false,
                itemAnchors: document.querySelectorAll('a[href*="/market/listings/730/"]').length,
                firstListing,
                firstRow: first
                    ? {
                          tag: first.tagName,
                          className: String(first.className || '').slice(0, 120),
                          id: first.id || null,
                          attrNames: Array.from(attrNames).slice(0, 25),
                          text: String(first.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
                      }
                    : null,
                firstRowHtml: first ? String(first.outerHTML || '').slice(0, 3000) : null,
            },
        };
        console.log('[CSFloat Lite] 诊断信息\n' + JSON.stringify(out, null, 2));
        return out;
    }

    /** 复制文本：优先 Clipboard API，失败退回 execCommand */
    function copyText(text) {
        return new Promise((resolve) => {
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard
                        .writeText(text)
                        .then(() => resolve(true))
                        .catch(() => resolve(fallbackCopy(text)));
                    return;
                }
            } catch (e) {
                /* 落到 fallback */
            }
            resolve(fallbackCopy(text));
        });
    }

    function fallbackCopy(text) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand && document.execCommand('copy');
            document.body.removeChild(ta);
            return !!ok;
        } catch (e) {
            return false;
        }
    }

    window.__csfloatLite = {
        version: VERSION,
        // 解码
        extractInspectHex,
        decodeInspectHex,
        inspectLinkToItem,
        // 判定与格式化
        isSkin,
        isCharm,
        isHighlightCharm,
        wearName,
        wearShort,
        wearColor,
        // 市场页
        listingIdOf,
        findInspectLinkInDom,
        evaluateRow,
        scan,
        renderRow,
        mountToolbar,
        applySort,
        applyPageSize,
        tune,
        // 筛选器
        parsePrice,
        applyFilters,
        addFilter,
        getFilters: () => filters.map((f) => ({expression: f.expression, colour: f.colour})),
        setFilters: (list) => {
            filters = (list || []).map((f) => ({expression: String(f.expression), colour: String(f.colour)}));
            saveFilters();
            rebuildChips();
            applyFilters();
        },
        validateExpression: (expr) => {
            try {
                compileFilter(expr);
                return null;
            } catch (e) {
                return (e && e.message) || String(e);
            }
        },
        diag,
        // 内部状态
        _state: state,
        _settings: settings,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, {once: true});
    } else {
        start();
    }
})();
