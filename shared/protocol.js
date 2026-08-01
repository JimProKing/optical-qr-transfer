/**
 * 아주 단순한 프레임 프로토콜 (학습용)
 *
 * META|session|fileName|fileSize|chunkCount|sha256
 * DATA|session|index|chunkCount|base64payload
 *
 * 원본 decimen 은 fountain code 를 씀.
 * 여기선 이해하기 쉽게 "순서대로 조각 + 반복 재생" 만 함.
 */

export const PREFIX_META = "META";
export const PREFIX_DATA = "DATA";

/** QR에 넣기 무난한 대략적 페이로드 크기 (base64 문자열 기준) */
export const DEFAULT_CHUNK_CHARS = 600;

export function makeSessionId() {
  return Math.random().toString(36).slice(2, 10);
}

export function encodeMeta({ session, fileName, fileSize, chunkCount, sha256 }) {
  // | 가 파일명에 있으면 깨지니까 간단히 치환
  const safeName = String(fileName).replace(/\|/g, "_");
  return [PREFIX_META, session, safeName, fileSize, chunkCount, sha256].join("|");
}

export function encodeData({ session, index, chunkCount, payloadB64 }) {
  return [PREFIX_DATA, session, index, chunkCount, payloadB64].join("|");
}

export function parseFrame(text) {
  if (!text || typeof text !== "string") return null;
  const parts = text.split("|");
  const kind = parts[0];

  if (kind === PREFIX_META && parts.length >= 6) {
    return {
      kind: "meta",
      session: parts[1],
      fileName: parts[2],
      fileSize: Number(parts[3]),
      chunkCount: Number(parts[4]),
      sha256: parts[5],
    };
  }

  if (kind === PREFIX_DATA && parts.length >= 5) {
    // payload 안에 | 가 없을 가정 (base64)
    return {
      kind: "data",
      session: parts[1],
      index: Number(parts[2]),
      chunkCount: Number(parts[3]),
      payloadB64: parts.slice(4).join("|"),
    };
  }

  return null;
}

export async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function uint8ToBase64(u8) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function base64ToUint8(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

export function splitFile(u8, chunkChars = DEFAULT_CHUNK_CHARS) {
  // base64 는 원본의 ~4/3 배. 원본 바이트를 잘라 base64 했을 때 chunkChars 근처가 되게
  const rawChunk = Math.max(32, Math.floor((chunkChars * 3) / 4) - 4);
  const chunks = [];
  for (let i = 0; i < u8.length; i += rawChunk) {
    chunks.push(uint8ToBase64(u8.subarray(i, i + rawChunk)));
  }
  if (chunks.length === 0) chunks.push("");
  return chunks;
}
