/**
 * SKETCHY SNAKE VR - THREE.JS WEBXR ENGINE
 * 3D Spatial Sketchbook Arcade for Meta Quest & Web
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { VRButton } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';

// --- Game Constants & Config ---
const ARENA_SIZE = 16;
const BOUNDS = ARENA_SIZE / 2;
const STEP_TIME = 0.16; // snake move step in seconds

// --- State Variables ---
let scene, camera, renderer, controls;
let vrScoreSprite, vrScoreCtx, vrScoreTex;
let snake = [];
let snakeDir = new THREE.Vector3(1, 0, 0);
let nextDir = new THREE.Vector3(1, 0, 0);
let food = null;
let score = 0;
let bestScore = parseInt(localStorage.getItem('sketchy_snake_vr_best') || '0', 10);
let isPlaying = true;
let moveTimer = 0;
let floatingDoodles = [];
let steamParticles = [];

// VR Controllers
let controller1, controller2;

// --- Sound Synthesizer & Music ---
let audioCtx = null;
let soundEnabled = true;
let isMusicPlaying = false;
let currentTrackIdx = 0;
let currentMusicSource = null;
let musicGain = null;
let trackBuffers = {};

const TRACKS = [
  { name: 'Blue Lightning ⚡', bpm: 124, bass: [110, 87.3, 130.8, 98], chords: [[220, 261.6, 329.6], [174.6, 220, 261.6], [130.8, 164.8, 196], [196, 246.9, 293.6]] },
  { name: 'Afterglow 🌅', bpm: 88, bass: [87.3, 98, 82.4, 110], chords: [[174.6, 220, 261.6, 329.6], [196, 246.9, 293.6], [164.8, 196, 246.9, 329.6], [220, 261.6, 329.6]] },
  { name: 'Run Away 🏃‍♀️', bpm: 120, bass: [98, 110, 87.3, 98], chords: [[196, 246.9, 293.6], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.6]] }
];

function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
      musicGain = audioCtx.createGain();
      musicGain.gain.setValueAtTime(0.18, audioCtx.currentTime);
      musicGain.connect(audioCtx.destination);
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function getTrackBuffer(idx) {
  if (trackBuffers[idx]) return trackBuffers[idx];
  if (!audioCtx) return null;

  const track = TRACKS[idx];
  const sampleRate = audioCtx.sampleRate || 44100;
  const beatSec = 60 / track.bpm;
  const loopSec = beatSec * 16;
  const numSamples = Math.floor(sampleRate * loopSec);
  const buffer = audioCtx.createBuffer(1, numSamples, sampleRate);
  const data = buffer.getChannelData(0);
  const stepSamples = Math.floor(sampleRate * (beatSec / 2));

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const step = Math.floor(i / stepSamples);
    const chord = track.chords[Math.floor(step / 4) % track.chords.length];
    const bassFreq = track.bass[Math.floor(step / 4) % track.bass.length];

    const bass = Math.sin(2 * Math.PI * bassFreq * t) * 0.18;
    const noteFreq = chord[step % chord.length];
    const noteTime = (i % stepSamples) / sampleRate;
    const pluck = Math.sin(2 * Math.PI * noteFreq * t) * 0.14 * Math.exp(-noteTime * 14);

    data[i] = bass + pluck;
  }
  trackBuffers[idx] = buffer;
  return buffer;
}

function toggleMusic(forceState) {
  initAudio();
  isMusicPlaying = typeof forceState === 'boolean' ? forceState : !isMusicPlaying;

  const btn = document.getElementById('music-toggle-btn');
  if (btn) btn.textContent = isMusicPlaying ? `⏸ Music: ${TRACKS[currentTrackIdx].name}` : `▶ Music: ${TRACKS[currentTrackIdx].name}`;

  if (currentMusicSource) {
    try { currentMusicSource.stop(); currentMusicSource.disconnect(); } catch (e) {}
    currentMusicSource = null;
  }

  if (isMusicPlaying && audioCtx) {
    const buf = getTrackBuffer(currentTrackIdx);
    if (buf) {
      currentMusicSource = audioCtx.createBufferSource();
      currentMusicSource.buffer = buf;
      currentMusicSource.loop = true;
      currentMusicSource.connect(musicGain);
      currentMusicSource.start();
    }
  }
}

function playBiteSound() {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
    g.gain.setValueAtTime(0.25, now);
    g.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    osc.start(now);
    osc.stop(now + 0.08);
  } catch (e) {}
}

// --- Materials & Shaders (Sketchy 3D Look) ---
const sketchLineMat = new THREE.LineBasicMaterial({ color: 0x2A2B32, linewidth: 2 });
const paperMat = new THREE.MeshBasicMaterial({ color: 0xFCFAF6 });
const snakeHeadMat = new THREE.MeshStandardMaterial({ color: 0x1D4ED8, roughness: 0.4 });
const snakeBodyMat = new THREE.MeshStandardMaterial({ color: 0x2563EB, roughness: 0.5 });
const crownMat = new THREE.MeshStandardMaterial({ color: 0xF59E0B, metalness: 0.3, roughness: 0.3 });
const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
const eyePupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

// --- Scene Initialization ---
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xFCFAF6);
  scene.fog = new THREE.FogExp2(0xFCFAF6, 0.025);

  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 8, 14);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Mount WebXR Button
  const vrBtn = VRButton.createButton(renderer);
  vrBtn.id = 'VRButton';
  document.getElementById('vr-button-mount').appendChild(vrBtn);

  // Orbit Controls (Desktop fallback)
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xFFFFFF, 0.85);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xFFFFFF, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  buildSketchbookArena();
  buildFloatingDoodles();
  initVRHUD();
  setupVRControllers();
  setupInputListeners();

  resetGame();
}

// --- Sketchbook 3D Arena ---
function buildSketchbookArena() {
  // Graph paper floor
  const gridHelper = new THREE.GridHelper(ARENA_SIZE, ARENA_SIZE, 0x1D4ED8, 0xE2E8F0);
  gridHelper.position.y = 0;
  scene.add(gridHelper);

  // Sketchy bounding wireframe box
  const boxGeo = new THREE.BoxGeometry(ARENA_SIZE, ARENA_SIZE * 0.7, ARENA_SIZE);
  const edges = new THREE.EdgesGeometry(boxGeo);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A2B32, linewidth: 2 }));
  line.position.y = (ARENA_SIZE * 0.7) / 2;
  scene.add(line);
}

// --- Floating 3D Marginalia Doodles ---
function buildFloatingDoodles() {
  const doodleGroup = new THREE.Group();

  // Floating Coffee Mug
  const mugGeo = new THREE.CylinderGeometry(0.4, 0.35, 0.7, 16);
  const mugMat = new THREE.MeshStandardMaterial({ color: 0x854D0E });
  const mug = new THREE.Mesh(mugGeo, mugMat);
  mug.position.set(-6, 3, -6);
  doodleGroup.add(mug);
  floatingDoodles.push({ mesh: mug, rotSpeed: 0.012, floatOffset: 0 });

  // Floating Golden Star
  const starGeo = new THREE.OctahedronGeometry(0.45);
  const starMat = new THREE.MeshStandardMaterial({ color: 0xF59E0B });
  const star = new THREE.Mesh(starGeo, starMat);
  star.position.set(6, 4, -5);
  doodleGroup.add(star);
  floatingDoodles.push({ mesh: star, rotSpeed: 0.02, floatOffset: 1.5 });

  // Floating Orange Heart (🧡)
  const heartShape = new THREE.Shape();
  heartShape.moveTo(0, 0);
  heartShape.bezierCurveTo(0, 0.4, -0.6, 0.6, -0.6, 0);
  heartShape.bezierCurveTo(-0.6, -0.4, 0, -0.6, 0, -1);
  heartShape.bezierCurveTo(0, -0.6, 0.6, -0.4, 0.6, 0);
  heartShape.bezierCurveTo(0.6, 0.6, 0, 0.4, 0, 0);

  const extrudeSettings = { depth: 0.2, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.05, bevelThickness: 0.05 };
  const heartGeo = new THREE.ExtrudeGeometry(heartShape, extrudeSettings);
  const heartMat = new THREE.MeshStandardMaterial({ color: 0xF97316 });
  const heart = new THREE.Mesh(heartGeo, heartMat);
  heart.rotation.z = Math.PI;
  heart.position.set(-5, 5, 5);
  heart.scale.set(0.6, 0.6, 0.6);
  doodleGroup.add(heart);
  floatingDoodles.push({ mesh: heart, rotSpeed: 0.015, floatOffset: 3.0 });

  scene.add(doodleGroup);
}

// --- Floating VR HUD Screen ---
function initVRHUD() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  vrScoreCtx = canvas.getContext('2d');
  vrScoreTex = new THREE.CanvasTexture(canvas);

  const hudMat = new THREE.SpriteMaterial({ map: vrScoreTex });
  vrScoreSprite = new THREE.Sprite(hudMat);
  vrScoreSprite.position.set(0, 7.5, -BOUNDS);
  vrScoreSprite.scale.set(5, 2.5, 1);
  scene.add(vrScoreSprite);

  updateVRHUD();
}

function updateVRHUD() {
  if (!vrScoreCtx) return;
  vrScoreCtx.fillStyle = '#FCFAF6';
  vrScoreCtx.fillRect(0, 0, 512, 256);

  vrScoreCtx.strokeStyle = '#2A2B32';
  vrScoreCtx.lineWidth = 6;
  vrScoreCtx.strokeRect(6, 6, 500, 244);

  vrScoreCtx.font = 'bold 44px sans-serif';
  vrScoreCtx.fillStyle = '#1D4ED8';
  vrScoreCtx.textAlign = 'center';
  vrScoreCtx.fillText('SKETCHY SNAKE VR ✏️', 256, 65);

  vrScoreCtx.font = 'bold 36px sans-serif';
  vrScoreCtx.fillStyle = '#2A2B32';
  vrScoreCtx.fillText(`SCORE: ${score}   BEST: ${bestScore}`, 256, 130);

  vrScoreCtx.font = '28px sans-serif';
  vrScoreCtx.fillStyle = '#DB2777';
  vrScoreCtx.fillText('progress not perfection 🧡', 256, 195);

  vrScoreTex.needsUpdate = true;
}

// --- Snake & Food Creation ---
function createSnakeSegment(isHead = false) {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.48, 16, 16);
  const mesh = new THREE.Mesh(geo, isHead ? snakeHeadMat : snakeBodyMat);
  group.add(mesh);

  if (isHead) {
    // Cartoon Eyes
    const eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), eyeWhiteMat);
    eye1.position.set(0.2, 0.2, 0.4);
    const pupil1 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyePupilMat);
    pupil1.position.set(0.2, 0.2, 0.48);

    const eye2 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), eyeWhiteMat);
    eye2.position.set(-0.2, 0.2, 0.4);
    const pupil2 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyePupilMat);
    pupil2.position.set(-0.2, 0.2, 0.48);

    group.add(eye1, pupil1, eye2, pupil2);

    // Crown
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.35, 5), crownMat);
    crown.position.set(0, 0.65, 0);
    crown.rotation.x = Math.PI;
    group.add(crown);
  }

  scene.add(group);
  return group;
}

function spawn3DFood() {
  if (food && food.mesh) {
    scene.remove(food.mesh);
  }

  const x = Math.floor(Math.random() * (ARENA_SIZE - 2)) - (BOUNDS - 1);
  const y = Math.floor(Math.random() * 5) + 1;
  const z = Math.floor(Math.random() * (ARENA_SIZE - 2)) - (BOUNDS - 1);

  // Random Munchkin Type (Avocado, Pumpkin, Coffee, Heart)
  const types = ['avocado', 'pumpkin', 'coffee', 'heart'];
  const type = types[Math.floor(Math.random() * types.length)];
  let mesh;

  if (type === 'avocado') {
    const geo = new THREE.SphereGeometry(0.4, 16, 16);
    geo.scale(1, 1.25, 0.85);
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x10B981, roughness: 0.4 }));
  } else if (type === 'pumpkin') {
    const geo = new THREE.SphereGeometry(0.45, 12, 12);
    geo.scale(1.1, 0.85, 1.1);
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xF97316, roughness: 0.5 }));
  } else if (type === 'coffee') {
    const geo = new THREE.CylinderGeometry(0.3, 0.25, 0.6, 12);
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x854D0E }));
  } else {
    const geo = new THREE.DodecahedronGeometry(0.4);
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xEA580C }));
  }

  mesh.position.set(x, y, z);
  scene.add(mesh);
  food = { pos: new THREE.Vector3(x, y, z), mesh, type };
}

// --- Game Logic ---
function resetGame() {
  snake.forEach(seg => scene.remove(seg.group));
  snake = [];

  const startPos = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 4; i++) {
    const group = createSnakeSegment(i === 0);
    const pos = startPos.clone().sub(new THREE.Vector3(i, 0, 0));
    group.position.copy(pos);
    snake.push({ pos, group });
  }

  snakeDir.set(1, 0, 0);
  nextDir.set(1, 0, 0);
  score = 0;
  isPlaying = true;
  document.getElementById('score-display').textContent = '0';
  document.getElementById('best-display').textContent = bestScore.toString();
  updateVRHUD();
  spawn3DFood();
}

function updateGame(delta) {
  if (!isPlaying) return;
  moveTimer += delta;

  if (moveTimer >= STEP_TIME) {
    moveTimer = 0;
    snakeDir.copy(nextDir);

    const headPos = snake[0].pos.clone().add(snakeDir);

    // Wall collision
    if (Math.abs(headPos.x) > BOUNDS || headPos.y < 0.5 || headPos.y > ARENA_SIZE * 0.7 || Math.abs(headPos.z) > BOUNDS) {
      resetGame();
      return;
    }

    // Move body
    for (let i = snake.length - 1; i > 0; i--) {
      snake[i].pos.copy(snake[i - 1].pos);
      snake[i].group.position.copy(snake[i].pos);
    }

    // Move head
    snake[0].pos.copy(headPos);
    snake[0].group.position.copy(headPos);

    // Rotate head toward direction
    snake[0].group.lookAt(headPos.clone().add(snakeDir));

    // Eat Food
    if (food && headPos.distanceTo(food.pos) < 1.0) {
      score += 10;
      if (score > bestScore) {
        bestScore = score;
        localStorage.setItem('sketchy_snake_vr_best', bestScore.toString());
        document.getElementById('best-display').textContent = bestScore.toString();
      }
      document.getElementById('score-display').textContent = score.toString();
      updateVRHUD();
      playBiteSound();
      triggerVRHaptics();

      // Grow snake
      const newSeg = createSnakeSegment(false);
      const tailPos = snake[snake.length - 1].pos.clone();
      newSeg.position.copy(tailPos);
      snake.push({ pos: tailPos, group: newSeg });

      spawn3DFood();
    }
  }

  // Spin food & floating doodles
  if (food && food.mesh) {
    food.mesh.rotation.y += 0.03;
    food.mesh.rotation.x += 0.01;
  }

  floatingDoodles.forEach((d, i) => {
    d.mesh.rotation.y += d.rotSpeed;
    d.mesh.position.y += Math.sin(Date.now() * 0.002 + d.floatOffset) * 0.003;
  });
}

// --- VR Controllers & Haptics ---
function setupVRControllers() {
  controller1 = renderer.xr.getController(0);
  controller1.addEventListener('selectstart', () => initAudio());
  scene.add(controller1);

  controller2 = renderer.xr.getController(1);
  controller2.addEventListener('selectstart', () => initAudio());
  scene.add(controller2);
}

function triggerVRHaptics() {
  [controller1, controller2].forEach(c => {
    if (c && c.gamepad && c.gamepad.hapticActuators && c.gamepad.hapticActuators[0]) {
      try { c.gamepad.hapticActuators[0].pulse(0.75, 45); } catch (e) {}
    }
  });
}

function handleVRThumbstick() {
  const session = renderer.xr.getSession();
  if (!session || !session.inputSources) return;

  for (const source of session.inputSources) {
    if (source.gamepad && source.gamepad.axes) {
      const [x, y] = [source.gamepad.axes[2] || source.gamepad.axes[0], source.gamepad.axes[3] || source.gamepad.axes[1]];
      if (Math.abs(x) > 0.5) {
        const newD = x > 0 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0);
        if (!newD.clone().add(snakeDir).equals(new THREE.Vector3(0, 0, 0))) nextDir.copy(newD);
      } else if (Math.abs(y) > 0.5) {
        const newD = y > 0 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 0, -1);
        if (!newD.clone().add(snakeDir).equals(new THREE.Vector3(0, 0, 0))) nextDir.copy(newD);
      }
    }
  }
}

// --- Input Event Listeners ---
function setupInputListeners() {
  window.addEventListener('keydown', (e) => {
    initAudio();
    if (e.key === 'ArrowRight' || e.key === 'd') {
      if (snakeDir.x !== -1) nextDir.set(1, 0, 0);
    } else if (e.key === 'ArrowLeft' || e.key === 'a') {
      if (snakeDir.x !== 1) nextDir.set(-1, 0, 0);
    } else if (e.key === 'ArrowDown' || e.key === 's') {
      if (snakeDir.z !== -1) nextDir.set(0, 0, 1);
    } else if (e.key === 'ArrowUp' || e.key === 'w') {
      if (snakeDir.z !== 1) nextDir.set(0, 0, -1);
    } else if (e.key === 'e') {
      if (snakeDir.y !== -1) nextDir.set(0, 1, 0);
    } else if (e.key === 'q') {
      if (snakeDir.y !== 1) nextDir.set(0, -1, 0);
    }
  });

  const musicBtn = document.getElementById('music-toggle-btn');
  if (musicBtn) musicBtn.addEventListener('click', () => toggleMusic());

  const nextTrackBtn = document.getElementById('next-track-btn');
  if (nextTrackBtn) {
    nextTrackBtn.addEventListener('click', () => {
      currentTrackIdx = (currentTrackIdx + 1) % TRACKS.length;
      toggleMusic(true);
    });
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// --- Animation Loop ---
let clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  handleVRThumbstick();
  updateGame(delta);
  if (!renderer.xr.isPresenting && controls) controls.update();
  renderer.render(scene, camera);
});

// Initialize safely regardless of DOM ready state
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initScene);
} else {
  initScene();
}
