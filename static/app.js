const $ = (id) => document.getElementById(id);
const UNITS = { mm: 0.1, cm: 1, m: 100, in: 2.54, ft: 30.48 };

const video = $("video");
const stage = $("stage");
const ctx = stage.getContext("2d");
const capCanvas = document.createElement("canvas");

const state = {
  pxPerCm: parseFloat(localStorage.getItem("pxPerCm")) || null,
  source: null,        // "camera" | "upload"
  img: null,           // uploaded image (canvas)
  camOn: false,
  live: false,
  busy: false,
  objects: [],
  history: [],
};

/* ---------- helpers ---------- */
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
const setStatus = (t) => ($("status").textContent = t);
const unit = () => $("unit").value;
const conv = (cm) => (cm / UNITS[unit()]).toFixed(2);

/* ---------- drawing ---------- */
function sourceSize() {
  if (state.source === "camera") return [video.videoWidth, video.videoHeight];
  if (state.source === "upload") return [state.img.width, state.img.height];
  return [0, 0];
}

function drawSource(c) {
  const [w, h] = sourceSize();
  if (!w) return false;
  if (c.canvas.width !== w) c.canvas.width = w;
  if (c.canvas.height !== h) c.canvas.height = h;
  c.drawImage(state.source === "camera" ? video : state.img, 0, 0, w, h);
  return true;
}

function getFrame() {
  const c = capCanvas.getContext("2d");
  return drawSource(c) ? capCanvas.toDataURL("image/jpeg", 0.85) : null;
}

function labelFor(o) {
  return o.width_cm != null
    ? `${conv(o.width_cm)} x ${conv(o.height_cm)} ${unit()}`
    : `${Math.round(o.width_px)} x ${Math.round(o.height_px)} px`;
}

function drawOverlay() {
  ctx.lineWidth = Math.max(2, stage.width / 320);
  const fontSize = Math.max(14, Math.round(stage.width / 38));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textBaseline = "top";
  state.objects.forEach((o) => {
    ctx.strokeStyle = "#00e676";
    ctx.beginPath();
    o.box.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.stroke();

    const text = `#${o.id}  ${o.name ? o.name + "  " : ""}${labelFor(o)}`;
    const x = Math.min(...o.box.map((p) => p[0]));
    const y = Math.max(0, Math.min(...o.box.map((p) => p[1])) - fontSize - 6);
    ctx.fillStyle = "rgba(0,0,0,.75)";
    ctx.fillRect(x, y, ctx.measureText(text).width + 10, fontSize + 6);
    ctx.fillStyle = "#00e676";
    ctx.fillText(text, x + 5, y + 3);
  });
}

function render() {
  if (drawSource(ctx)) drawOverlay();
  if (state.camOn) requestAnimationFrame(render);
}

/* ---------- camera / upload ---------- */
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = stream;
    await video.play();
    state.source = "camera";
    state.camOn = true;
    state.objects = [];
    $("btnCam").disabled = true;
    $("btnStop").disabled = false;
    setStatus("Camera running.");
    render();
  } catch (e) {
    alert("Cannot open the camera: " + e.message);
  }
}

function stopCamera() {
  if (video.srcObject) video.srcObject.getTracks().forEach((t) => t.stop());
  state.camOn = false;
  state.live = false;
  state.source = null;
  $("liveToggle").checked = false;
  $("btnCam").disabled = false;
  $("btnStop").disabled = true;
  ctx.clearRect(0, 0, stage.width, stage.height);
  setStatus("Camera stopped.");
}

function loadUpload(file) {
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    stopCamera();
    const scale = Math.min(1, 1000 / img.width);        // keep uploads a sensible size
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    state.img = c;
    state.source = "upload";
    state.objects = [];
    render();
    setStatus("Photo loaded.");
    measureNow();
  };
  img.src = URL.createObjectURL(file);
}

/* ---------- measuring ---------- */
async function measureNow() {
  const image = getFrame();
  if (!image || state.busy) return;
  state.busy = true;
  try {
    const r = await postJSON("/api/measure", { image, px_per_cm: state.pxPerCm, mode: $("mode").value });
    state.objects = r.objects;
    updateResults();
    if (!state.camOn) render();
    setStatus(`${r.objects.length} object(s) detected.`);
  } catch (e) {
    setStatus(e.message);
  } finally {
    state.busy = false;
  }
}

function updateResults() {
  const body = $("results").querySelector("tbody");
  body.innerHTML = "";
  state.objects.forEach((o) => {
    const tr = document.createElement("tr");
    const w = o.width_cm != null ? `${conv(o.width_cm)} ${unit()}` : `${Math.round(o.width_px)} px`;
    const h = o.height_cm != null ? `${conv(o.height_cm)} ${unit()}` : `${Math.round(o.height_px)} px`;
    tr.innerHTML = `<td>${o.id}</td><td></td><td>${w}</td><td>${h}</td>`;
    tr.children[1].textContent = o.name || "-";
    body.appendChild(tr);
  });
}

async function calibrate() {
  const image = getFrame();
  if (!image) return alert("Start the camera or upload a photo first.");
  const size = parseFloat($("refSize").value);
  if (!(size > 0)) return alert("Enter the reference object's real size.");
  try {
    const r = await postJSON("/api/calibrate", { image, ref_size: size, unit: unit() });
    state.pxPerCm = r.px_per_cm;
    localStorage.setItem("pxPerCm", r.px_per_cm);
    updateCalStatus();
    await measureNow();
  } catch (e) {
    alert(e.message);
  }
}

function updateCalStatus() {
  $("calStatus").textContent = state.pxPerCm
    ? `Calibrated: ${state.pxPerCm.toFixed(2)} px per cm`
    : "Not calibrated - showing pixels.";
}

/* ---------- history ---------- */
async function loadHistory() {
  try {
    const res = await fetch("/api/history");
    state.history = await res.json();
    renderHistory();
  } catch (e) {
    console.error(e);
  }
}

function renderHistory() {
  const body = $("history").querySelector("tbody");
  body.innerHTML = "";
  state.history.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.image_path ? `<img src="/static/${r.image_path}">` : ""}</td>
      <td></td>
      <td>${conv(r.width_cm)} ${unit()}</td>
      <td>${conv(r.height_cm)} ${unit()}</td>
      <td>${r.source}</td>
      <td>${r.created_at}</td>
      <td><button class="danger" data-id="${r.id}">Delete</button></td>`;
    tr.children[1].textContent = r.label || "";   // textContent avoids HTML injection
    body.appendChild(tr);
  });
}

async function saveResults() {
  if (!state.pxPerCm) return alert("Calibrate first so the values are real units.");
  if (!state.objects.length) return alert("No measured objects to save.");
  const image = getFrame();
  try {
    await postJSON("/api/save", {
      image,
      label: $("label").value,
      source: state.source,
      objects: state.objects.map((o) => ({ width_cm: o.width_cm, height_cm: o.height_cm, name: o.name || "" })),
    });
    $("label").value = "";
    loadHistory();
  } catch (e) {
    alert(e.message);
  }
}

/* ---------- events ---------- */
$("btnCam").onclick = startCamera;
$("btnStop").onclick = stopCamera;
$("fileInput").onchange = (e) => loadUpload(e.target.files[0]);
$("btnMeasure").onclick = measureNow;
$("btnCal").onclick = calibrate;
$("btnSave").onclick = saveResults;
$("btnExport").onclick = () => (window.location = "/api/export?unit=" + unit());
$("liveToggle").onchange = (e) => (state.live = e.target.checked);
$("mode").onchange = () => {
  state.objects = [];
  updateResults();
  if (!state.camOn) render();
  if ($("mode").value === "yolo") setStatus("YOLO selected. The first detection loads the model and may take a while.");
  else setStatus("Edge detection selected.");
};
$("unit").onchange = () => {
  $("refUnitLabel").textContent = unit();
  updateResults();
  renderHistory();
  if (!state.camOn) render();
};
$("history").addEventListener("click", async (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  await fetch(`/api/history/${id}`, { method: "DELETE" });
  loadHistory();
});

setInterval(() => {
  if (state.live && state.camOn) measureNow();
}, 600);

updateCalStatus();
loadHistory();