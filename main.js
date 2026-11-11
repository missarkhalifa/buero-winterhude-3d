import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EYE = 1.65, RADIUS = 0.28, SPEED = 1.5, RUN = 2.7;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;   // lighting + AgX tonemapping are baked into the lightmaps
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfdbe4);
scene.fog = new THREE.Fog(0xcfdbe4, 40, 110);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 250);
camera.rotation.order = 'YXZ';
// live lights – only used by furniture added later (baked scene is unlit MeshBasicMaterial)
scene.add(new THREE.HemisphereLight(0xffffff, 0xb8ad9c, 1.6));
const sun = new THREE.DirectionalLight(0xfff1dd, 1.4); sun.position.set(-8, 10, 6); scene.add(sun);

// Blender plan (x east, y north)  ->  three (x, z = -y)
const B = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
const yawTo = (dx, dy) => Math.atan2(-dx, dy);
const COLORS = { '80': '#f0a640', '81': '#4aa8ea', '82': '#5cc26a', '83': '#b48ee6' };
const SPAWNS = {
  '80': { p: [7.7, 9.6], yaw: yawTo(-1, 0.05) },
  '81': { p: [5.9, 3.9], yaw: yawTo(-1, -0.55) },
  '82': { p: [7.5, 5.6], yaw: yawTo(0.55, -1) },
};
let boxes = [], plan = null, furnitureGroup = new THREE.Group(); scene.add(furnitureGroup);
const pos = new THREE.Vector3(); let yaw = 0, pitch = 0.0;
function goto(id) { const s = SPAWNS[id]; pos.set(s.p[0], EYE, -s.p[1]); yaw = s.yaw; pitch = -0.04; }
goto('80');
const floorMeshes = [], ceilingMeshes = [], outdoorMeshes = [], labelSprites = [];

// ------------------------------------------------------------- loading
const prog = document.getElementById('prog'), ltext = document.getElementById('ltext');
const draco = new DRACOLoader().setDecoderPath('./vendor/draco/');
const loader = new GLTFLoader().setDRACOLoader(draco);
Promise.all([
  fetch('./assets/collision.json?v=2').then(r => r.json()),
  fetch('./assets/plan.json?v=2').then(r => r.json()),
  fetch('./assets/furniture.json?v=2').then(r => r.json()).catch(() => ({ items: [] })),
  new Promise((res, rej) => loader.load('./assets/office.glb?v=2', res, e => {
    if (e.total) { prog.style.width = (100 * e.loaded / e.total).toFixed(0) + '%'; ltext.textContent = `Lade Modell … ${(e.loaded / 1048576).toFixed(1)} / ${(e.total / 1048576).toFixed(1)} MB`; }
  }, rej))
]).then(([col, pl, furn, gltf]) => {
  plan = pl;
  boxes = col.boxes.map(b => ({ x0: b[0], x1: b[2], z0: -b[3], z1: -b[1] }));
  const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material, name = (m && m.name) || '';
    if (name.startsWith('baked_')) {
      const map = m.map; if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = maxAniso; }
      o.material = new THREE.MeshBasicMaterial({ map, name });
      if (name === 'baked_context') o.material.color.set(0x9c9c9c);      // rest of the floor: greyed out
      if (name === 'baked_ceiling') ceilingMeshes.push(o);
      if (name === 'baked_floor') { floorMeshes.push(o); addPlankDetail(o.material); }
      if (name === 'baked_outdoor') outdoorMeshes.push(o);
    } else if (/glass/i.test(name)) {
      o.material = new THREE.MeshBasicMaterial({ color: 0xe6f0f4, transparent: true, opacity: 0.10, depthWrite: false });
    }
    o.matrixAutoUpdate = false; o.updateMatrix();
  });
  scene.add(gltf.scene);
  buildOverlays(pl);
  addFurniture(furn.items || []);
  scene.updateMatrixWorld(true);
  document.getElementById('loader').style.opacity = 0;
  setTimeout(() => document.getElementById('loader').remove(), 600);
  window.__ready = true;
}).catch(err => { ltext.textContent = 'Fehler beim Laden: ' + err; console.error(err); });

// ------------------------------------------------------------- vinyl plank detail (multiplied onto the baked floor, world-space, tileable 2.4 m)
function plankTexture() {
  const N = 1024, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pw = N / 12, pl = N / 2;                 // 0.20 m x 1.20 m planks
  for (let i = 0; i < 12; i++) {
    const off = rnd() * pl;
    for (let k = -1; k < 3; k++) {
      const y0 = off + k * pl, v = 158 + rnd() * 62, w = rnd() * 0.08;
      g.fillStyle = `rgb(${Math.min(255, v * (1.04 + w))},${v},${v * (0.90 - w)})`; g.fillRect(i * pw, y0, pw, pl);
      for (let s = 0; s < 22; s++) { const x = i * pw + rnd() * pw, a = 0.05 + rnd() * 0.08; g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; g.fillRect(x, y0, 1 + rnd() * 2.5, pl); }
      g.fillStyle = 'rgba(40,40,40,0.75)'; g.fillRect(i * pw, y0, pw, 2);           // end joint
    }
    g.fillStyle = 'rgba(40,40,40,0.75)'; g.fillRect(i * pw, 0, 2, N);                 // long joint
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true;
  return t;
}
function addPlankDetail(m) {
  const tex = plankTexture();
  m.onBeforeCompile = sh => {
    sh.uniforms.plankTex = { value: tex };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWp;').replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWp; uniform sampler2D plankTex;').replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= 0.45 + 0.75 * texture2D(plankTex, vWp / 2.4).rgb;');
  };
}

// ------------------------------------------------------------- labels + outlines (Matterport-style tags)
function makeLabel(title, sub, color, scale = 1) {
  const c = document.createElement('canvas'), W = 512, Hh = 168; c.width = W; c.height = Hh; const g = c.getContext('2d');
  g.fillStyle = 'rgba(22,22,24,0.82)'; const r = 30; g.beginPath(); g.roundRect(6, 6, W - 12, Hh - 12, r); g.fill();
  if (color) { g.fillStyle = color; g.beginPath(); g.arc(52, Hh / 2, 18, 0, 7); g.fill(); }
  g.fillStyle = '#fff'; g.font = '600 52px -apple-system,Helvetica,Arial'; g.textBaseline = 'middle';
  g.fillText(title, color ? 88 : 36, sub ? 62 : Hh / 2);
  if (sub) { g.font = '400 38px -apple-system,Helvetica,Arial'; g.fillStyle = 'rgba(255,255,255,.78)'; g.fillText(sub, color ? 88 : 36, 118); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, transparent: true }));
  s.scale.set(2.2 * scale, 2.2 * scale * Hh / W, 1); s.userData.base = s.scale.clone(); s.renderOrder = 10; return s;
}
const outlines = new THREE.Group(); scene.add(outlines);
function buildOverlays(pl) {
  for (const r of pl.rooms) {
    const col = COLORS[r.id];
    const s = makeLabel(r.small ? 'Lager 83' : `Raum ${r.id}`, `≈ ${r.m2.toFixed(1).replace('.', ',')} m²`, col, r.small ? 0.6 : 1);
    s.position.copy(B(r.label[0], r.label[1], r.small ? 2.0 : 2.25)); Object.assign(s.userData, { ours: true, h: r.small ? 2.0 : 2.25 }); scene.add(s); labelSprites.push(s);
    // coloured floor outline + soft tint (dollhouse highlight)
    const pts = r.poly.map(p => B(p[0] + 0.0, p[1], 0.02)); pts.push(pts[0].clone());
    const shape = new THREE.Shape(r.poly.map(p => new THREE.Vector2(p[0], p[1])));
    const tint = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, depthWrite: false }));
    tint.rotation.x = -Math.PI / 2; tint.position.y = 0.015; tint.renderOrder = 2; outlines.add(tint);
    const inset = r.poly.map(p => B(p[0], p[1], 0.03)); inset.push(inset[0].clone());
    outlines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(inset), new THREE.LineBasicMaterial({ color: col })));
  }
  for (const c of pl.context) {
    if (c.box[2] - c.box[0] < 1.5) continue;
    const s = makeLabel(c.name, null, null, 0.62); s.material.opacity = 0.85;
    s.position.copy(B((c.box[0] + c.box[2]) / 2, (c.box[1] + c.box[3]) / 2, 1.5)); Object.assign(s.userData, { ours: false }); scene.add(s); labelSprites.push(s);
  }
  const rb = document.getElementById('rooms');
  for (const id of ['80', '81', '82']) {
    const r = pl.rooms.find(x => x.id === id), b = document.createElement('button');
    b.innerHTML = `<i style="background:${COLORS[id]}"></i>${id} · ${Math.round(r.m2)} m²`;
    b.onclick = () => { if (mode !== 'fp') toggleMode(); goto(id); updateGround(); };
    rb.appendChild(b);
  }
  setMode('fp');
}

// ------------------------------------------------------------- furniture (added later from assets/furniture.json)
function addFurniture(items) {
  for (const it of items) {
    const rot = THREE.MathUtils.degToRad(it.rot || 0);
    if (it.type === 'glb') {
      loader.load(it.url, g => { const o = g.scene; o.position.copy(B(it.x, it.y, it.z || 0)); o.rotation.y = rot; o.scale.setScalar(it.scale || 1); furnitureGroup.add(o); });
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(it.w, it.h, it.d), new THREE.MeshStandardMaterial({ color: it.color || '#bbbbbb', roughness: 0.7 }));
      m.position.copy(B(it.x, it.y, (it.z || 0) + it.h / 2)); m.rotation.y = rot; m.name = it.name || 'item'; furnitureGroup.add(m);
    }
    if (it.collide !== false && it.w && it.d) {   // axis-aligned footprint (rotations of 0/90/180/270 deg)
      const sw = Math.abs(Math.cos(rot)) > 0.5; const hw = (sw ? it.w : it.d) / 2, hd = (sw ? it.d : it.w) / 2;
      boxes.push({ x0: it.x - hw, x1: it.x + hw, z0: -(it.y + hd), z1: -(it.y - hd) });
    }
  }
}

// ------------------------------------------------------------- collision (circle vs AABB in plan)
function collide(p) {
  for (let it = 0; it < 3; it++) for (const b of boxes) {
    const cx = Math.max(b.x0, Math.min(p.x, b.x1)), cz = Math.max(b.z0, Math.min(p.z, b.z1));
    const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < RADIUS * RADIUS) {
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (RADIUS - d) / d; p.x += dx * k; p.z += dz * k; }
      else { const l = p.x - b.x0, r = b.x1 - p.x, f = p.z - b.z0, k = b.z1 - p.z, m = Math.min(l, r, f, k);
        if (m === l) p.x = b.x0 - RADIUS; else if (m === r) p.x = b.x1 + RADIUS; else if (m === f) p.z = b.z0 - RADIUS; else p.z = b.z1 + RADIUS; }
    }
  }
}
let groundY = 0;
function updateGround() { groundY = 0; }
function inPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; }
const roomEl = document.getElementById('room'); let curRoom = null;
function updateRoomHud() {
  if (!plan) return; const x = pos.x, y = -pos.z; let r = plan.rooms.find(r => inPoly(x, y, r.poly));
  const id = r ? r.id : null; if (id === curRoom) return; curRoom = id;
  roomEl.innerHTML = r ? `<span style="color:${COLORS[r.id]}">●</span> ${r.name} · ≈ ${r.m2.toFixed(1).replace('.', ',')} m²` : 'Durchgang'; 
}

// ------------------------------------------------------------- input
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });
const joy = document.getElementById('joy'), knob = document.getElementById('joyKnob');
let joyId = null, joyVec = new THREE.Vector2(), lookId = null, lastLook = null;
function joySet(t) {
  const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
  let dx = t.clientX - cx, dy = t.clientY - cy; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
  joyVec.set(dx / R, dy / R); knob.style.transform = `translate(${dx}px,${dy}px)`;
}
joy.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; joyId = t.identifier; joySet(t); }, { passive: false });
const LOOK = isTouch ? 0.0045 : 0.0035;
canvas.addEventListener('touchstart', e => {
  if (mode !== 'fp') return; e.preventDefault();
  for (const t of e.changedTouches) if (lookId === null) { lookId = t.identifier; lastLook = [t.clientX, t.clientY]; }
}, { passive: false });
addEventListener('touchmove', e => {
  if (mode !== 'fp') return; e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joyId) joySet(t);
    else if (t.identifier === lookId) { look(t.clientX - lastLook[0], t.clientY - lastLook[1]); lastLook = [t.clientX, t.clientY]; }
  }
}, { passive: false });
const endTouch = e => { for (const t of e.changedTouches) { if (t.identifier === joyId) { joyId = null; joyVec.set(0, 0); knob.style.transform = ''; } if (t.identifier === lookId) lookId = null; } };
addEventListener('touchend', endTouch); addEventListener('touchcancel', endTouch);
function look(dx, dy) { yaw -= dx * LOOK; pitch = Math.max(-1.35, Math.min(1.35, pitch - dy * LOOK)); }
let dragging = false;
canvas.addEventListener('mousedown', e => { if (mode === 'fp') { dragging = true; if (e.shiftKey) canvas.requestPointerLock?.(); } });
addEventListener('mouseup', () => dragging = false);
addEventListener('mousemove', e => { if (mode === 'fp' && (dragging || document.pointerLockElement === canvas)) look(e.movementX, e.movementY); });

// ------------------------------------------------------------- modes: first person  <->  dollhouse overview (ceiling removed)
let mode = 'fp';
const orbit = new OrbitControls(camera, canvas); orbit.enabled = false; orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI * 0.47; orbit.minDistance = 4; orbit.maxDistance = 45;
const OV_TARGET = B(7.5, 5.2, 0);
const btn = document.getElementById('modeBtn'), hint = document.getElementById('hint');
function setMode(m) {
  mode = m; const ov = m === 'orbit';
  document.body.classList.toggle('orbit', ov); btn.textContent = ov ? 'Rundgang' : 'Übersicht';
  ceilingMeshes.forEach(o => o.visible = !ov);
  outlines.visible = ov;
  outdoorMeshes.forEach(o => o.visible = !ov);
  labelSprites.forEach(s => { s.visible = ov || s.userData.ours; if (s.userData.ours) s.position.y = ov ? 3.6 : s.userData.h; s.scale.copy(s.userData.base).multiplyScalar(ov ? 1.7 : 0.7); });
  if (ov) {
    camera.position.copy(B(-4.5, -9.5, 17)); orbit.target.copy(OV_TARGET); orbit.enabled = true; orbit.update();
    hint.textContent = isTouch ? 'Ziehen: drehen · Pinch: zoomen · zwei Finger: schieben' : 'Maus: drehen / zoomen / Rechtsklick schieben';
  } else {
    orbit.enabled = false;
    hint.textContent = isTouch ? 'Joystick: gehen · Wischen: umsehen' : 'WASD: gehen · Maus ziehen: umsehen';
  }
  hint.style.opacity = 1; clearTimeout(window.__ht); window.__ht = setTimeout(() => hint.style.opacity = 0, 7000);
}
function toggleMode() { setMode(mode === 'fp' ? 'orbit' : 'fp'); }
btn.addEventListener('click', toggleMode);
if (!isTouch) joy.style.display = 'none';

// ------------------------------------------------------------- loop
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h;
  camera.fov = w < h ? 75 : 65; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
const clock = new THREE.Clock(); const mv = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mode === 'fp') {
    let f = -joyVec.y, s = joyVec.x;
    if (keys.KeyW || keys.ArrowUp) f += 1; if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) s += 1; if (keys.KeyA || keys.ArrowLeft) s -= 1;
    if (keys.KeyQ) yaw += 1.8 * dt; if (keys.KeyE) yaw -= 1.8 * dt;
    const l = Math.hypot(f, s);
    if (l > 0.05) {
      if (l > 1) { f /= l; s /= l; }
      const sp = (keys.ShiftLeft || keys.ShiftRight ? RUN : SPEED) * dt;
      mv.set(-Math.sin(yaw) * f + Math.cos(yaw) * s, 0, -Math.cos(yaw) * f - Math.sin(yaw) * s);
      pos.addScaledVector(mv, sp); collide(pos);
    }
    pos.y = groundY + EYE;
    camera.position.copy(pos); camera.rotation.set(pitch, yaw, 0);
    updateRoomHud();
  } else orbit.update();
  renderer.render(scene, camera);
});
window.__state = () => ({ pos: pos.toArray(), plan: [pos.x, -pos.z], yaw, pitch, mode, room: curRoom, boxes: boxes.length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles });
window.__walk = (f, s, secs) => { const t0 = performance.now(); return new Promise(r => { const id = setInterval(() => { joyVec.set(s, -f); if (performance.now() - t0 > secs * 1000) { clearInterval(id); joyVec.set(0, 0); r(window.__state()); } }, 16); }); };
window.__look = (dyaw, dp = 0) => { yaw += dyaw; pitch += dp; };
window.__goto = id => { if (mode !== 'fp') setMode('fp'); goto(id); };
window.__mode = m => setMode(m);
window.__place = (x, y, dx, dy) => { if (mode !== 'fp') setMode('fp'); pos.set(x, EYE, -y); yaw = yawTo(dx, dy); pitch = -0.04; };
