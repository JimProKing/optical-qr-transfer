import jsQR from "jsqr";
import {
  base64ToUint8,
  parseFrame,
  sha256Hex,
} from "../shared/protocol.js";

const video = document.getElementById("video");
const work = document.getElementById("work");
const ctx = work.getContext("2d", { willReadFrequently: true });
const startBtn = document.getElementById("startCam");
const stopBtn = document.getElementById("stopCam");
const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");
const metaEl = document.getElementById("meta");
const bar = document.getElementById("bar");
const download = document.getElementById("download");
const dlName = document.getElementById("dlName");

let stream = null;
let running = false;
let raf = 0;

/** @type {null | { session, fileName, fileSize, chunkCount, sha256, chunks: (string|null)[], seen: number }} */
let state = null;
let lastRaw = "";
let done = false;

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);

async function startCamera() {
  stopCamera();
  done = false;
  state = null;
  download.style.display = "none";
  updateProgress();

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    video.srcObject = stream;
    await video.play();
    running = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusEl.className = "status ok";
    statusEl.textContent = "카메라 ON. QR에 맞추세요.";
    loop();
  } catch (e) {
    console.error(e);
    statusEl.className = "status warn";
    statusEl.textContent =
      "카메라 실패: " +
      (e.message || e) +
      " (HTTPS/권한 확인. 폰이면 개발 서버 Network 주소로 접속)";
  }
}

function stopCamera() {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.srcObject = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

function loop() {
  if (!running) return;
  raf = requestAnimationFrame(loop);
  scanFrame();
}

function scanFrame() {
  if (done) return;
  if (video.readyState < 2) return;

  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;

  // 너무 크면 느려서 축소
  const maxW = 640;
  const scale = w > maxW ? maxW / w : 1;
  const cw = Math.floor(w * scale);
  const ch = Math.floor(h * scale);
  work.width = cw;
  work.height = ch;
  ctx.drawImage(video, 0, 0, cw, ch);
  const img = ctx.getImageData(0, 0, cw, ch);
  const code = jsQR(img.data, cw, ch, { inversionAttempts: "dontInvert" });
  if (!code || !code.data) return;
  if (code.data === lastRaw) return; // 같은 프레임 반복 스킵
  lastRaw = code.data;
  handlePayload(code.data);
}

function handlePayload(text) {
  const frame = parseFrame(text);
  if (!frame) return;

  if (frame.kind === "meta") {
    if (!state || state.session !== frame.session) {
      state = {
        session: frame.session,
        fileName: frame.fileName,
        fileSize: frame.fileSize,
        chunkCount: frame.chunkCount,
        sha256: frame.sha256,
        chunks: Array(frame.chunkCount).fill(null),
        seen: 0,
      };
      metaEl.textContent = `받는 중: ${frame.fileName} (${frame.fileSize} bytes, ${frame.chunkCount} chunks)`;
      statusEl.className = "status ok";
      statusEl.textContent = "메타 수신. 조각 모으는 중…";
      updateProgress();
    }
    return;
  }

  if (frame.kind === "data") {
    if (!state) {
      statusEl.className = "status warn";
      statusEl.textContent = "데이터는 왔는데 메타가 없음. 잠시 기다리거나 송신 쪽을 다시 시작.";
      return;
    }
    if (frame.session !== state.session) return;
    if (frame.index < 0 || frame.index >= state.chunkCount) return;
    if (state.chunks[frame.index] == null) {
      state.chunks[frame.index] = frame.payloadB64;
      state.seen++;
      updateProgress();
      statusEl.textContent = `조각 ${frame.index + 1}/${state.chunkCount} 확보`;
    }
    if (state.seen >= state.chunkCount) {
      finish();
    }
  }
}

function updateProgress() {
  if (!state) {
    progressEl.textContent = "0 / ? 조각";
    bar.style.width = "0%";
    return;
  }
  const pct = Math.round((state.seen / state.chunkCount) * 100);
  progressEl.textContent = `${state.seen} / ${state.chunkCount} 조각 (${pct}%)`;
  bar.style.width = pct + "%";
}

async function finish() {
  if (done || !state) return;
  done = true;
  statusEl.textContent = "조립 중…";

  try {
    const parts = state.chunks.map((b64) => base64ToUint8(b64));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    // 파일 크기 맞추기 (마지막 패딩 가능성)
    const sliced =
      state.fileSize && out.length >= state.fileSize
        ? out.subarray(0, state.fileSize)
        : out;

    const hash = await sha256Hex(sliced);
    if (state.sha256 && hash !== state.sha256) {
      statusEl.className = "status warn";
      statusEl.textContent = `해시 불일치. 다시 시도하세요. expect ${state.sha256.slice(0, 8)}… got ${hash.slice(0, 8)}…`;
      done = false; // 재시도 여지
      return;
    }

    const blob = new Blob([sliced]);
    const url = URL.createObjectURL(blob);
    download.href = url;
    download.download = state.fileName || "received.bin";
    download.style.display = "block";
    dlName.textContent = `${state.fileName} (${sliced.length} bytes) · sha OK`;
    statusEl.className = "status ok";
    statusEl.textContent = "완료! 아래에서 다운로드.";
    // 카메라는 끄지 않음 (사용자가 끄면 됨)
  } catch (e) {
    console.error(e);
    statusEl.className = "status warn";
    statusEl.textContent = "조립 실패: " + (e.message || e);
    done = false;
  }
}
