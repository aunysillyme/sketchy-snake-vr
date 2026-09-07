/**
 * SKETCHY SNAKE VR - THREE.JS WEBXR ENGINE
 * Spatial Sketchbook Arcade for Meta Quest, Apple Vision Pro, and Browser
 */

(function () {
  'use strict';

  // --- Constants & Config ---
  const ARENA_SIZE = 14;
  const BOUNDS = ARENA_SIZE / 2;
  const STEP_TIME = 0.16; // snake speed in seconds

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

  // VR Controllers
  let controller1, controller2;

  // --- Audio Synthesizer ---
  let audioCtx = null;
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

  // --- Materials ---
  const snakeHeadMat = new THREE.MeshLambertMaterial({ color: 0x1D4ED8 });
  const snakeBodyMat = new THREE.MeshLambertMaterial({ color: 0x2563EB });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0xF59E0B });
  const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
  const eyePupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

  // --- Main Scene Setup ---
  function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF5F0E6);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 10, 15);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    // Mount VR Button if available
    if (THREE.VRButton) {
      const vrBtn = THREE.VRButton.createButton(renderer);
      document.getElementById('vr-button-mount').appendChild(vrBtn);
    }

    // Orbit Controls for mouse/touch
    if (THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 2, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
    }

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xFFFFFF, 0.9);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xFFFFFF, 0.6);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    buildArena();
    buildDoodles();
    setupInputListeners();
    resetGame();

    // Start animation loop
    renderer.setAnimationLoop(renderLoop);
  }

  // --- 3D Arena ---
  function buildArena() {
    // Graph paper floor
    const floorGeo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE);
    const floorMat = new THREE.MeshBasicMaterial({ color: 0xFCFAF6 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    scene.add(floor);

    // Blue graph grid
    const gridHelper = new THREE.GridHelper(ARENA_SIZE, ARENA_SIZE, 0x1D4ED8, 0x93C5FD);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Charcoal outline box
    const boxGeo = new THREE.BoxGeometry(ARENA_SIZE, ARENA_SIZE * 0.6, ARENA_SIZE);
    const edges = new THREE.EdgesGeometry(boxGeo);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2A2B32, linewidth: 3 }));
    line.position.y = (ARENA_SIZE * 0.6) / 2;
    scene.add(line);
  }

  // --- Floating 3D Doodles ---
  function buildDoodles() {
    const doodleGroup = new THREE.Group();

    // Floating Golden Star
    const starGeo = new THREE.OctahedronGeometry(0.5);
    const starMat = new THREE.MeshLambertMaterial({ color: 0xF59E0B });
    const star = new THREE.Mesh(starGeo, starMat);
    star.position.set(5.5, 4, -5);
    doodleGroup.add(star);
    floatingDoodles.push({ mesh: star, rotSpeed: 0.02, floatOffset: 0 });

    // Floating Coffee Cup
    const mugGeo = new THREE.CylinderGeometry(0.4, 0.35, 0.7, 16);
    const mugMat = new THREE.MeshLambertMaterial({ color: 0x854D0E });
    const mug = new THREE.Mesh(mugGeo, mugMat);
    mug.position.set(-5.5, 3.5, -5);
    doodleGroup.add(mug);
    floatingDoodles.push({ mesh: mug, rotSpeed: 0.015, floatOffset: 1.5 });

    // Floating Orange Heart (3D Dodecahedron)
    const heartGeo = new THREE.DodecahedronGeometry(0.5);
    const heartMat = new THREE.MeshLambertMaterial({ color: 0xF97316 });
    const heart = new THREE.Mesh(heartGeo, heartMat);
    heart.position.set(-5, 4.5, 4.5);
    doodleGroup.add(heart);
    floatingDoodles.push({ mesh: heart, rotSpeed: 0.02, floatOffset: 3.0 });

    scene.add(doodleGroup);
  }

  // --- Snake & Food Creation ---
  function createSnakeSegment(isHead = false) {
    const group = new THREE.Group();
    const geo = new THREE.SphereGeometry(0.48, 16, 16);
    const mesh = new THREE.Mesh(geo, isHead ? snakeHeadMat : snakeBodyMat);
    group.add(mesh);

    if (isHead) {
      // Big Eyes
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
    const y = Math.floor(Math.random() * 4) + 1;
    const z = Math.floor(Math.random() * (ARENA_SIZE - 2)) - (BOUNDS - 1);

    const types = ['avocado', 'pumpkin', 'coffee', 'heart'];
    const type = types[Math.floor(Math.random() * types.length)];
    let mesh;

    if (type === 'avocado') {
      const geo = new THREE.SphereGeometry(0.42, 16, 16);
      geo.scale(1, 1.25, 0.85);
      mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x10B981 }));
    } else if (type === 'pumpkin') {
      const geo = new THREE.SphereGeometry(0.45, 12, 12);
      geo.scale(1.1, 0.85, 1.1);
      mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xF97316 }));
    } else if (type === 'coffee') {
      const geo = new THREE.CylinderGeometry(0.32, 0.26, 0.6, 12);
      mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x854D0E }));
    } else {
      const geo = new THREE.DodecahedronGeometry(0.42);
      mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xEA580C }));
    }

    mesh.position.set(x, y, z);
    scene.add(mesh);
    food = { pos: new THREE.Vector3(x, y, z), mesh, type };
  }

  // --- Game Loop ---
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
    spawn3DFood();
  }

  let clock = new THREE.Clock();

  function renderLoop() {
    const delta = clock.getDelta();

    if (isPlaying) {
      moveTimer += delta;
      if (moveTimer >= STEP_TIME) {
        moveTimer = 0;
        snakeDir.copy(nextDir);

        const headPos = snake[0].pos.clone().add(snakeDir);

        // Bounds check
        if (Math.abs(headPos.x) > BOUNDS || headPos.y < 0.5 || headPos.y > ARENA_SIZE * 0.6 || Math.abs(headPos.z) > BOUNDS) {
          resetGame();
          return;
        }

        // Body follow
        for (let i = snake.length - 1; i > 0; i--) {
          snake[i].pos.copy(snake[i - 1].pos);
          snake[i].group.position.copy(snake[i].pos);
        }

        // Head move
        snake[0].pos.copy(headPos);
        snake[0].group.position.copy(headPos);

        // Eat Food
        if (food && headPos.distanceTo(food.pos) < 1.0) {
          score += 10;
          if (score > bestScore) {
            bestScore = score;
            localStorage.setItem('sketchy_snake_vr_best', bestScore.toString());
            document.getElementById('best-display').textContent = bestScore.toString();
          }
          document.getElementById('score-display').textContent = score.toString();
          playBiteSound();

          const newSeg = createSnakeSegment(false);
          const tailPos = snake[snake.length - 1].pos.clone();
          newSeg.position.copy(tailPos);
          snake.push({ pos: tailPos, group: newSeg });

          spawn3DFood();
        }
      }
    }

    // Spin food
    if (food && food.mesh) {
      food.mesh.rotation.y += 0.03;
    }

    floatingDoodles.forEach(d => {
      d.mesh.rotation.y += d.rotSpeed;
      d.mesh.position.y += Math.sin(Date.now() * 0.002 + d.floatOffset) * 0.003;
    });

    if (controls && !renderer.xr.isPresenting) controls.update();
    renderer.render(scene, camera);
  }

  // --- Input Listeners ---
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

  // Launch on ready
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initScene);
  } else {
    initScene();
  }
})();
