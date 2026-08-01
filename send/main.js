import QRCode from "qrcode";
import {
  DEFAULT_CHUNK_CHARS,
  encodeData,
  encodeMeta,
  makeSessionId,
  sha256Hex,
  splitFile,
} from "../shared/protocol.js";

const fileInput = document.getElementById("file");
const fpsInput = document.getElementById("fps");
const fpsVal = document.getElementById("fpsVal");
const chunkSelect = document.getElementById("chunk");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const canvas = document.getElementById("qr");

let frames = [];
let timer = null;
let frameIndex = 0;
let prepared = null;

fpsInput.addEventListener("input", () => {
  fpsVal.textContent = fpsInput.value;
});

fileInput.addEventListener("change", async () => {
  stopSending();
  prepared = null;
  startBtn.disabled = true;
  const f = fileInput.files?.[0];
  if (!f) {
    statusEl.textContent = "파일을 선택하세요.";
    metaEl.textContent = "";
    return;
  }

  // 너무 크면 경고 (학습용)
  if (f.size > 500 * 1024) {
    statusEl.className = "status warn";
    statusEl.textContent =
      "500KB 넘는 파일은 오래 걸립니다. 가능하면 더 작은 파일로 테스트하세요.";
  } else {
    statusEl.className = "status";
    statusEl.textContent = "파일 준비 중…";
  }

  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    const sha256 = await sha256Hex(buf);
    const chunkChars = Number(chunkSelect.value) || DEFAULT_CHUNK_CHARS;
    const session = makeSessionId();
    const dataChunks = splitFile(buf, chunkChars);
    const chunkCount = dataChunks.length;

    const list = [];
    // 메타를 여러 번 섞어 넣어서 받기가 놓쳐도 다시 잡기 쉽게
    const meta = encodeMeta({
      session,
      fileName: f.name,
      fileSize: f.size,
      chunkCount,
      sha256,
    });
    list.push(meta);
    list.push(meta);

    for (let i = 0; i < chunkCount; i++) {
      list.push(
        encodeData({
          session,
          index: i,
          chunkCount,
          payloadB64: dataChunks[i],
        })
      );
      // 중간중간 메타 재전송
      if (i > 0 && i % 8 === 0) list.push(meta);
    }
    list.push(meta);

    prepared = {
      frames: list,
      fileName: f.name,
      fileSize: f.size,
      chunkCount,
      sha256,
      session,
    };

    metaEl.textContent = `session=${session} · ${f.name} · ${f.size} bytes · ${chunkCount} chunks · sha256=${sha256.slice(0, 12)}…`;
    statusEl.className = "status ok";
    statusEl.textContent = "준비됨. 전송 시작을 누르고 폰 카메라를 화면으로.";
    startBtn.disabled = false;

    // 미리보기: 첫 프레임
    await drawQr(list[0]);
  } catch (e) {
    console.error(e);
    statusEl.className = "status warn";
    statusEl.textContent = "준비 실패: " + (e.message || e);
  }
});

startBtn.addEventListener("click", () => {
  if (!prepared) return;
  startSending();
});

stopBtn.addEventListener("click", () => stopSending());

async function drawQr(text) {
  await QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: "L",
    margin: 2,
    width: 480,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

function startSending() {
  stopSending();
  frames = prepared.frames;
  frameIndex = 0;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  statusEl.className = "status ok";
  statusEl.textContent = "전송 중… 폰으로 QR을 비추세요. (끝날 때까지 루프)";

  const fps = Number(fpsInput.value) || 8;
  const interval = Math.round(1000 / fps);

  const tick = async () => {
    const text = frames[frameIndex % frames.length];
    frameIndex++;
    try {
      await drawQr(text);
      statusEl.textContent = `전송 중… frame ${frameIndex} (루프 ${Math.floor((frameIndex - 1) / frames.length) + 1})`;
    } catch (e) {
      console.error(e);
    }
  };

  tick();
  timer = setInterval(tick, interval);
}

function stopSending() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  stopBtn.disabled = true;
  startBtn.disabled = !prepared;
  if (prepared) {
    statusEl.className = "status";
    statusEl.textContent = "중지됨. 다시 시작 가능.";
  }
}
