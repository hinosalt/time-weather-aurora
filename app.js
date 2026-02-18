// このアプリはブラウザ内でフレーム変換を行うのみで、外部AI APIやネットワーク通信は一切行いません。

const startButton = document.getElementById("startBtn");
const stopButton = document.getElementById("stopBtn");
const modeSelect = document.getElementById("modeSelect");
const intensityRange = document.getElementById("intensityRange");
const statusText = document.getElementById("statusText");

const camera = document.getElementById("camera");
const visionCanvas = document.getElementById("visionCanvas");
const processingCanvas = document.getElementById("processingCanvas");

const visionCtx = visionCanvas.getContext("2d", { alpha: false });
const sourceCtx = processingCanvas.getContext("2d", { alpha: false });

const artCanvas = document.createElement("canvas");
const artCtx = artCanvas.getContext("2d", { alpha: false });

let stream = null;
let animationId = 0;
let procWidth = 0;
let procHeight = 0;
let transformedImageData = null;
let state = "idle";
let startupTimer = 0;

const modeSettings = {
  prism: {
    displacement: 11,
    contrast: 1.35,
    saturation: 1.45,
    hueGlow: "157,255,214",
  },
  fracture: {
    displacement: 18,
    contrast: 1.65,
    saturation: 1.8,
    hueGlow: "255,100,212",
  },
  aurora: {
    displacement: 8,
    contrast: 1.25,
    saturation: 1.2,
    hueGlow: "127,222,255",
  },
};

function setStatus(message) {
  statusText.textContent = message;
}

function getIntensity() {
  return Number(intensityRange.value);
}

function ensureSecureContext() {
  if (window.isSecureContext) {
    return true;
  }

  if (window.location.protocol === "http:" && ["localhost", "127.0.0.1"].includes(location.hostname)) {
    return true;
  }

  setStatus("カメラは安全な接続を必要とします。HTTPSまたはlocalhostで開いてください。");
  return false;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toSourceIndex(x, y, t, mode, intensity) {
  const cfg = modeSettings[mode];
  const intensityFactor = intensity / 100;

  const base = cfg.displacement * intensityFactor;
  const nx = Math.sin(y * 0.06 + t * 0.0014);
  const ny = Math.cos(x * 0.05 + t * 0.0012);

  let sx = x + Math.round(nx * base * 0.9);
  let sy = y + Math.round(ny * base * 0.9);

  if (mode === "fracture") {
    sx += Math.round(((x & 6) - 3) * intensityFactor * 1.4);
    sy += Math.round(((y & 4) - 2) * intensityFactor * 1.8);
  }

  if (mode === "aurora") {
    sx += Math.round(Math.sin((y + t * 0.12) * 0.09) * 3 * intensityFactor);
    sy += Math.round(Math.cos((x + t * 0.15) * 0.07) * 3 * intensityFactor);
  }

  sx = ((sx % procWidth) + procWidth) % procWidth;
  sy = ((sy % procHeight) + procHeight) % procHeight;

  return (sy * procWidth + sx) * 4;
}

function transformFrame(time, mode, intensity) {
  const sourceFrame = sourceCtx.getImageData(0, 0, procWidth, procHeight);
  const source = sourceFrame.data;
  const output = transformedImageData.data;
  const cfg = modeSettings[mode];
  const factor = intensity / 100;

  const contrast = cfg.contrast + (1 - factor) * 0.45;
  const saturation = cfg.saturation + factor * 0.45;
  const levels = Math.max(2, Math.floor(18 - factor * 10));

  for (let y = 0; y < procHeight; y += 1) {
    for (let x = 0; x < procWidth; x += 1) {
      const dstIndex = (y * procWidth + x) * 4;
      const srcIndex = toSourceIndex(x, y, time, mode, intensity);

      let r = source[srcIndex] || 0;
      let g = source[srcIndex + 1] || 0;
      let b = source[srcIndex + 2] || 0;
      const a = source[srcIndex + 3] || 255;

      if (mode === "prism") {
        const drift = (Math.sin(x * 0.09 + time * 0.001) + 1) * 0.5 * factor * 65;
        r = clamp(r + drift, 0, 255);
        g = clamp(g - drift * 0.8, 0, 255);
        b = clamp(b + drift * 0.75, 0, 255);
      }

      if (mode === "fracture") {
        const shard = (x + y + Math.floor(time * 0.2)) % 5;
        if (shard === 0) {
          [r, g] = [g, r];
        } else if (shard === 2) {
          [g, b] = [b, g];
        } else if (shard === 4) {
          r = clamp(r + 40, 0, 255);
        }
      }

      if (mode === "aurora") {
        const pulse = (Math.sin(time * 0.0008 + (x + y) * 0.015) * 70 * factor;
        b = clamp(b + pulse + 20, 0, 255);
        g = clamp(g + pulse * 0.35, 0, 255);
        r = clamp(r * (0.75 + factor * 0.55), 0, 255);
      }

      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const satR = (r - lum) * saturation + lum;
      const satG = (g - lum) * saturation + lum;
      const satB = (b - lum) * saturation + lum;

      r = clamp((satR - 128) * contrast + 128, 0, 255);
      g = clamp((satG - 128) * contrast + 128, 0, 255);
      b = clamp((satB - 128) * contrast + 128, 0, 255);

      r = Math.floor(r / levels) * levels;
      g = Math.floor(g / levels) * levels;
      b = Math.floor(b / levels) * levels;

      output[dstIndex] = r;
      output[dstIndex + 1] = g;
      output[dstIndex + 2] = b;
      output[dstIndex + 3] = a;
    }
  }

  return sourceFrame;
}

function draw(time) {
  if (!stream) {
    return;
  }

  if (!camera.videoWidth || !camera.videoHeight) {
    setStatus("カメラ映像の初期化を待機中...");
    animationId = requestAnimationFrame(draw);
    return;
  }

  try {
    const mode = modeSelect.value;
    const intensity = getIntensity();
    const cfg = modeSettings[mode];

    sourceCtx.drawImage(camera, 0, 0, procWidth, procHeight);
    transformFrame(time, mode, intensity);
    artCtx.putImageData(transformedImageData, 0, 0);

    visionCtx.clearRect(0, 0, visionCanvas.width, visionCanvas.height);
    visionCtx.imageSmoothingEnabled = true;
    visionCtx.filter = `saturate(${120 + intensity}%) contrast(${110 + intensity * 0.4}%)`;
    visionCtx.drawImage(artCanvas, 0, 0, visionCanvas.width, visionCanvas.height);

    const wobble = intensity / 100;
    const shiftX = Math.sin(time * 0.001) * 7 * wobble;
    const shiftY = Math.cos(time * 0.0014) * 6 * wobble;

    visionCtx.globalCompositeOperation = "screen";
    visionCtx.filter = `blur(${1 + intensity / 60}px)`;
    visionCtx.globalAlpha = 0.28;
    visionCtx.drawImage(
      artCanvas,
      shiftX,
      shiftY,
      visionCanvas.width,
      visionCanvas.height,
    );

    visionCtx.globalCompositeOperation = "color";
    visionCtx.filter = "none";
    visionCtx.globalAlpha = 0.18;
    visionCtx.fillStyle = `rgba(${cfg.hueGlow}, ${0.35 + intensity / 300})`;
    visionCtx.fillRect(0, 0, visionCanvas.width, visionCanvas.height);

    visionCtx.globalCompositeOperation = "source-over";
    visionCtx.globalAlpha = 1;
    visionCtx.filter = "none";

    const grad = visionCtx.createLinearGradient(0, 0, visionCanvas.width, visionCanvas.height);
    grad.addColorStop(0, "rgba(255,255,255,0.05)");
    grad.addColorStop(0.5, "rgba(255,255,255,0)");
    grad.addColorStop(1, "rgba(255,255,255,0.08)");
    visionCtx.fillStyle = grad;
    visionCtx.fillRect(0, 0, visionCanvas.width, visionCanvas.height);

    setStatus(`動作中: ${mode} / 強度 ${intensity}%`);
  } catch (error) {
    setStatus(`描画中にエラー: ${error.message}`);
    stopCamera();
    return;
  }

  animationId = requestAnimationFrame(draw);
}

function resizeCanvases() {
  const targetWidth = Math.min(1200, Math.max(300, window.innerWidth - 64));
  const targetHeight = Math.max(220, Math.round(targetWidth * 9 / 16));

  visionCanvas.width = targetWidth;
  visionCanvas.height = targetHeight;

  const targetProcWidth = 300;
  if (camera.videoWidth && camera.videoHeight) {
    const aspect = camera.videoWidth / camera.videoHeight;
    procWidth = Math.max(240, Math.min(420, Math.round(targetProcWidth * aspect)));
    procHeight = Math.max(150, Math.round(procWidth / aspect));
  } else {
    procWidth = 320;
    procHeight = 180;
  }

  processingCanvas.width = procWidth;
  processingCanvas.height = procHeight;
  artCanvas.width = procWidth;
  artCanvas.height = procHeight;

  transformedImageData = artCtx.createImageData(procWidth, procHeight);
}

function cameraErrorMessage(error) {
  const errorName = error && error.name;
  if (errorName === "NotAllowedError") {
    return "カメラの許可が拒否されました。ブラウザの権限設定を確認してください。";
  }

  if (errorName === "NotFoundError") {
    return "接続可能なカメラが見つかりませんでした。";
  }

  if (errorName === "OverconstrainedError") {
    return "この端末で要求した解像度を満たせませんでした。低い設定で再試行します。";
  }

  if (errorName === "NotReadableError") {
    return "カメラが他のアプリで使用中です。カメラ利用中のアプリを終了して再試行してください。";
  }

  return `カメラ起動に失敗しました: ${error && error.message ? error.message : "不明なエラー"}`;
}

async function acquireCameraWithFallback() {
  const constraintsList = [
    {
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    {
      video: {
        facingMode: "user",
        width: { ideal: 960 },
        height: { ideal: 540 },
      },
    },
    {
      video: true,
    },
  ];

  let lastError = null;

  for (const constraints of constraintsList) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      if (error && error.name === "NotAllowedError") {
        throw error;
      }
    }
  }

  throw lastError;
}

function waitForCameraFrame(cameraElement) {
  return new Promise((resolve, reject) => {
    if (!cameraElement) {
      reject(new Error("カメラ要素が見つかりません。"));
      return;
    }

    const onFrame = () => {
      clearTimeout(startupTimer);
      cameraElement.removeEventListener("loadeddata", onFrame);
      resolve();
    };

    startupTimer = window.setTimeout(() => {
      cameraElement.removeEventListener("loadeddata", onFrame);
      resolve();
    }, 2500);

    cameraElement.addEventListener("loadeddata", onFrame, { once: true });
  });
}

async function startCamera() {
  if (state === "running") {
    return;
  }

  if (!ensureSecureContext()) {
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("このブラウザは getUserMedia をサポートしていません。");
    return;
  }

  try {
    setStatus("カメラのアクセス許可を待機中...");

    stream = await acquireCameraWithFallback();
    const tracks = stream.getVideoTracks();

    if (!tracks.length) {
      throw new Error("カメラ映像トラックを取得できませんでした。");
    }

    camera.srcObject = stream;
    await camera.play().catch(() => {});
    setStatus("カメラストリームを取得しました。フレーム到着待機中...");
    await waitForCameraFrame(camera);

    resizeCanvases();
    state = "running";
    startButton.disabled = true;
    stopButton.disabled = false;

    setStatus("カメラ接続済み。アート変換を開始します。");
    animationId = requestAnimationFrame(draw);
  } catch (error) {
    if (startupTimer) {
      clearTimeout(startupTimer);
      startupTimer = 0;
    }

    state = "idle";
    stream = null;
    startButton.disabled = false;
    stopButton.disabled = true;

    setStatus(cameraErrorMessage(error));

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
      camera.srcObject = null;
    }
  }
}

function stopCamera() {
  if (!stream) {
    return;
  }

  stream.getTracks().forEach((track) => track.stop());
  camera.srcObject = null;
  stream = null;

  cancelAnimationFrame(animationId);
  animationId = 0;
  state = "idle";
  startButton.disabled = false;
  stopButton.disabled = true;
  visionCtx.clearRect(0, 0, visionCanvas.width, visionCanvas.height);
  setStatus("停止しました。再生ボタンから再開できます。");
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);

modeSelect.addEventListener("change", () => {
  if (state !== "running") {
    setStatus(`モードを変更しました: ${modeSelect.value}`);
  }
});

intensityRange.addEventListener("input", () => {
  if (state !== "running") {
    setStatus(`強度を変更しました: ${intensityRange.value}%`);
  }
});

window.addEventListener("resize", () => {
  if (state === "running") {
    resizeCanvases();
  }
});
