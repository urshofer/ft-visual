import * as THREE from "three";
import { RapierPhysics } from "./rapier.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { TextureLoader } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { VHSShader } from "./VHSShader.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import GUI from "lil-gui";
import {
  createPaintOverlay,
  resizePaintOverlay,
  uploadTexture,
  splat,
  clearSim,
  splashParams,
} from "./paintSplash.js";

let context;
let analyser;
let mediaSource;

function getUserMedia(dictionary, callback) {
  try {
    navigator.getUserMedia =
      navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia;
    navigator.getUserMedia(dictionary, callback, (e) => {
      console.dir(e);
    });
  } catch (e) {
    alert("getUserMedia threw exception :" + e);
  }
}

let currentStream = null;
const audioDevices = {};
const audioParams = { device: "", micEnabled: false };

function connectAudioAPI(deviceId) {
  try {
    if (!context) {
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 128;
    }

    disconnectAudio();

    const constraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false,
    };

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then(function (stream) {
        currentStream = stream;
        mediaSource = context.createMediaStreamSource(stream);
        mediaSource.connect(analyser);
        context.resume();
      })
      .catch(function (err) {
        alert(err);
      });
  } catch (e) {
    alert(e);
  }
}

function disconnectAudio() {
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
    currentStream = null;
  }
  if (mediaSource) {
    mediaSource.disconnect();
    mediaSource = null;
  }
}

// Request permission, enumerate devices, and start listening to the mic.
async function enableMic() {
  // Request permission first to get device labels
  const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  tempStream.getTracks().forEach((t) => t.stop());

  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices.filter((d) => d.kind === "audioinput");

  for (const key of Object.keys(audioDevices)) delete audioDevices[key];
  audioInputs.forEach((d) => {
    const label = d.label || `Input ${d.deviceId.slice(0, 8)}`;
    audioDevices[label] = d.deviceId;
  });

  const firstId =
    audioDevices[audioParams.device] || audioInputs[0]?.deviceId || "";
  audioParams.device = Object.keys(audioDevices)[0] || "";
  connectAudioAPI(firstId);
}

async function startAudio() {
  if (audioParams.micEnabled) {
    try {
      await enableMic();
    } catch (e) {
      console.warn("Mic could not be enabled:", e);
    }
  }
  init();
}

const longAvg = [];
const longAvgFrameCount = 300;
function updateFFT() {
  if (!analyser) {
    return { average: 0, longAverage: 0, max: 0 };
  }
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);

  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
  }
  const average = sum / data.length;

  longAvg.push(average > 128 ? average : 0);

  if (longAvg.length > longAvgFrameCount) {
    longAvg.shift();
  }
  let lsum = 0;
  for (let i = 0; i < longAvg.length; i++) {
    lsum += longAvg[i];
  }
  const longAverage = longAvg.length > 0 ? lsum / longAvg.length : 0;

  // Normalize (0–255 → 0–1)
  return {
    average: average / 255,
    longAverage: longAverage,
    max: Math.max(...data) / 255,
  };
}

let camera, scene, renderer, stats, dirLight, composer, vhsPass, camRot;
let paintOverlay;
let shadersEnabled = true;
let physics;
let boxes, floorCollider, camCollider;

// GUI params object
const params = {
  scale: 10,
  boxSizeX: 0.225,
  boxSizeY: 0.075,
  boxSizeZ: 0.225,
  gapX: 0.02,
  gapY: 0.0,
  wallY: 21,
  bricksCount: 2394,
  streetWidth: 15,
  camHeight: 0.15,
  lookUp: 0.7,
  fov: 86,
  hemiIntensity: 0.1,
  pointIntensity: 5.5,
  pointDecay: 0.25,
  vhsScanlines: 0.02,
  vhsNoise: 0.08,
  vhsColorBleed: 0.002,
  vhsDistortion: 0,
  vhsNoiseAudioAdd: 0.15,
  vhsDistortionAudioAdd: 0.0005,
  moveSpeedBase: 0.01,
  moveSpeedAudioDiv: 350,
  rotSpeed: 5,
};

// Derived values (recalculated from params)
const boxSize = {
  x: params.scale * params.boxSizeX,
  y: params.scale * params.boxSizeY,
  z: params.scale * params.boxSizeZ,
};
const gap = {
  x: params.scale * params.gapX,
  y: params.scale * params.gapY,
};

function recalcDerived() {
  boxSize.x = params.scale * params.boxSizeX;
  boxSize.y = params.scale * params.boxSizeY;
  boxSize.z = params.scale * params.boxSizeZ;
  gap.x = params.scale * params.gapX;
  gap.y = params.scale * params.gapY;
}

const brickPositions = [];
const wallX = Math.floor(params.bricksCount / 2 / params.wallY);

// Models to preload: { file, scale, material (optional overrides for MeshStandardMaterial) }
const models = [
  { file: "bass.obj", scale: 0.1 },
  { file: "guitar.obj", scale: 0.1 },
  { file: "snare.obj", scale: 0.1 },
  { file: "tenordrum.obj", scale: 0.1 },
  {
    file: "Jever_Beer.obj",
    scale: 0.03,
    material: {
      color: 0x0a5f0a,
      emissive: 0x0a5f0a,
      emissiveIntensity: 0.8,
      roughness: 0.1,
      metalness: 0.3,
      transparent: true,
      opacity: 0.85,
    },
  },
];
const loadedModels = [];
const thrownModels = [];
const maxThrownModels = 20;
let objLoader = new OBJLoader();

const directions = {
  straight: 0,
  left: 1,
  right: 2,
};

let currentDirection = directions.straight;

const pathPoints = [new THREE.Vector3(0, 0, 0)];
const minDistanceBetweenDirectionChange = 10;
let directionCount = 0;
let directionAngle = 0;
const curveSpeed = 0.02;

let camPos = 10;
let moveSpeed = 0.02;
const currentPosition = new THREE.Vector3(0, 0, 0);
const targetPosition = new THREE.Vector3(0, 0, 0);
const currentPositionT = new THREE.Vector3(1, 0, 0);
const targetPositionT = new THREE.Vector3(1, 0, 0);
let ready = false;

startAudio();

async function init() {
  physics = await RapierPhysics();

  await preloadModels();

  //

  camera = new THREE.PerspectiveCamera(
    params.fov,
    window.innerWidth / window.innerHeight,
    0.1,
    10000,
  );

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0, 20, 100);
  /*const loader = new TextureLoader();

  loader.load("./bg/bg.webp", (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;

    const geo = new THREE.SphereGeometry(10, 32, 32);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
    });

    const sky = new THREE.Mesh(geo, mat);
    scene.add(sky);
  });*/

  const hemiLight = new THREE.HemisphereLight(
    0xccccff,
    0xffffff,
    params.hemiIntensity,
  );
  scene.add(hemiLight);

  dirLight = new THREE.PointLight(
    0xffffff,
    params.pointIntensity,
    0,
    params.pointDecay,
  );

  dirLight.position.set(
    0,
    params.wallY * boxSize.y * 0.25,
    params.streetWidth * 0.5,
  );
  dirLight.lookAt(
    10,
    params.wallY * boxSize.y * 0.25,
    params.streetWidth * 0.5,
  );

  dirLight.castShadow = false;
  dirLight.shadow.camera.zoom = 2;
  scene.add(dirLight);

  //const helper = new THREE.PointLightHelper( dirLight, 5 );
  //scene.add( helper );

  floorCollider = new THREE.Mesh(
    new THREE.BoxGeometry(
      (boxSize.x + gap.x) * wallX * 2,
      5,
      (boxSize.x + gap.x) * wallX * 2,
    ),
    new THREE.MeshBasicMaterial({ color: 0x333333 }),
  );
  floorCollider.position.y = -2.5;
  floorCollider.userData.physics = {
    mass: 0,
    restitution: 0,
    friction: 1,
  };
  floorCollider.visible = false;
  scene.add(floorCollider);

  camCollider = new THREE.Mesh(
    new THREE.SphereGeometry(boxSize.x * 1.5),
    new THREE.MeshBasicMaterial({ color: 0x003333 }),
  );
  camCollider.position.copy(camera.position);
  camCollider.userData.physics = { mass: 100000000000000, restitution: 0 };
  camCollider.visible = false;
  scene.add(camCollider);

  //

  const material = new THREE.MeshStandardMaterial();
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();

  const geometryBox = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
  boxes = new THREE.InstancedMesh(geometryBox, material, params.bricksCount);
  boxes.userData.physics = {
    mass: 3,
    restitution: 0,
    friction: 0.5,
    rollingFriction: 0,
    linearDamping: 0,
    angularDamping: 0,
  };
  for (let i = 0; i < boxes.count; i++) {
    matrix.setPosition(Math.random() * 1000, -1000, 0);
    boxes.setMatrixAt(i, matrix);
    const c = Math.random() * 0.5 + 0.5;
    boxes.setColorAt(i, color.setRGB(c, c, c));
  }
  scene.add(boxes);

  // Paint splash overlay (attached to camera)
  paintOverlay = createPaintOverlay(camera);
  scene.add(camera);

  physics.addScene(scene);

  //

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // postprocessing

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  vhsPass = new ShaderPass(VHSShader);
  composer.addPass(vhsPass);

  composer.addPass(new OutputPass());

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("keydown", onmousedown);

  // Reset clock after tab switch so first frame doesn't get a huge delta
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      clock.getDelta(); // discard accumulated time
    }
  });

  /*const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.y = 0;
  controls.target.z = 0;
  controls.target.x = 0;
  controls.update();*/

  // --- GUI ---
  const gui = new GUI({ title: "Settings" });
  gui.domElement.style.display = "none";
  window.__gui = gui;

  const fScene = gui.addFolder("Scene");
  fScene.add(params, "scale", 1, 30, 0.1).name("Scale").onChange(recalcDerived);
  fScene.add(params, "wallY", 1, 60, 1).name("Wall Height");
  fScene.add(params, "streetWidth", 3, 50, 0.5).name("Street Width");

  const fBox = gui.addFolder("Brick Size");
  fBox
    .add(params, "boxSizeX", 0.01, 1, 0.005)
    .name("X")
    .onChange(recalcDerived);
  fBox
    .add(params, "boxSizeY", 0.01, 0.5, 0.005)
    .name("Y")
    .onChange(recalcDerived);
  fBox
    .add(params, "boxSizeZ", 0.01, 1, 0.005)
    .name("Z")
    .onChange(recalcDerived);
  fBox.add(params, "gapX", 0, 0.2, 0.005).name("Gap X").onChange(recalcDerived);
  fBox.add(params, "gapY", 0, 0.2, 0.005).name("Gap Y").onChange(recalcDerived);

  const fCam = gui.addFolder("Camera");
  fCam
    .add(params, "fov", 10, 150, 1)
    .name("FOV")
    .onChange(() => {
      camera.fov = params.fov;
      camera.updateProjectionMatrix();
      resizePaintOverlay(paintOverlay, camera);
    });
  fCam.add(params, "camHeight", 0.01, 1, 0.01).name("Cam Height");
  fCam.add(params, "lookUp", -10, 10, 0.1).name("Look Up");
  fCam.add(params, "rotSpeed", 0.1, 20, 0.1).name("Rot Speed");

  const fMove = gui.addFolder("Movement");
  fMove.add(params, "moveSpeedBase", 0, 0.05, 0.001).name("Base Speed");
  fMove.add(params, "moveSpeedAudioDiv", 50, 2000, 10).name("Audio Divisor");

  const fLight = gui.addFolder("Lighting");
  fLight
    .add(params, "hemiIntensity", 0, 5, 0.1)
    .name("Hemi Intensity")
    .onChange(() => {
      hemiLight.intensity = params.hemiIntensity;
    });
  fLight
    .add(params, "pointIntensity", 0, 20, 0.1)
    .name("Point Intensity")
    .onChange(() => {
      dirLight.intensity = params.pointIntensity;
    });
  fLight
    .add(params, "pointDecay", 0, 2, 0.01)
    .name("Point Decay")
    .onChange(() => {
      dirLight.decay = params.pointDecay;
    });

  const fShader = gui.addFolder("VHS Effect");
  fShader.add(params, "vhsScanlines", 0, 0.5, 0.01).name("Scanlines");
  fShader.add(params, "vhsNoise", 0, 0.3, 0.01).name("Noise");
  fShader.add(params, "vhsColorBleed", 0, 0.02, 0.001).name("Color Bleed");
  fShader.add(params, "vhsDistortion", 0, 0.01, 0.0005).name("Distortion");
  fShader.add(params, "vhsNoiseAudioAdd", 0, 0.5, 0.01).name("Noise Audio Add");
  fShader
    .add(params, "vhsDistortionAudioAdd", 0, 0.02, 0.001)
    .name("Distort Audio Add");

  const fPaint = gui.addFolder("Paint Splash");
  fPaint.add(splashParams, "size", 6, 38, 1).name("Size");
  fPaint.add(splashParams, "flow", 1, 10, 1).name("Flow");
  fPaint.add(splashParams, "wait", 0, 120, 1).name("Wait");
  fPaint.add(splashParams, "blur", 0, 8, 0.5).name("Blur");
  fPaint.add({ clear: clearSim }, "clear").name("Clear");

  const fAudio = gui.addFolder("Audio");
  let deviceController = fAudio
    .add(audioParams, "device", audioDevices)
    .name("Input")
    .onChange((deviceId) => {
      if (audioParams.micEnabled) connectAudioAPI(deviceId);
    });

  fAudio
    .add(audioParams, "micEnabled")
    .name("Enable Mic")
    .onChange(async (enabled) => {
      if (enabled) {
        try {
          await enableMic();
        } catch (e) {
          console.warn("Mic could not be enabled:", e);
          audioParams.micEnabled = false;
        }
      } else {
        disconnectAudio();
      }
      // Rebuild the device dropdown with the latest device list
      deviceController = deviceController
        .options(audioDevices)
        .name("Input")
        .onChange((deviceId) => {
          if (audioParams.micEnabled) connectAudioAPI(deviceId);
        });
      gui.controllers.forEach((c) => c.updateDisplay());
      fAudio.controllers.forEach((c) => c.updateDisplay());
    });

  let initBuildUp = 0;
  const b = () => {
    buildup();
    initBuildUp++;
    if (initBuildUp < wallX) {
      setTimeout(b, 0);
    }
    if (pathPoints.length > 12) {
      currentPosition.copy(pathPoints[camPos]);
      currentPositionT.copy(pathPoints[camPos + 1]);
      ready = true;
    }
  };
  setTimeout(() => b(), 3000);
  renderer.setAnimationLoop(animate);
}

const buildup = () => {
  // get last Point
  const lastPoint = pathPoints[pathPoints.length - 1];

  // change direction
  if (directionCount > minDistanceBetweenDirectionChange) {
    directionCount = 0;
    const keys = Object.keys(directions);
    currentDirection =
      directions[keys[Math.floor(Math.random() * keys.length)]];
  } else {
    directionCount++;
  }

  if (currentDirection === directions.left) {
    directionAngle -= curveSpeed;
  } else if (currentDirection === directions.right) {
    directionAngle += curveSpeed;
  }

  // Add a point
  const distance = boxSize.x + gap.x;
  const newPoint = new THREE.Vector3(
    lastPoint.x + Math.cos(directionAngle) * distance,
    0,
    lastPoint.z + Math.sin(directionAngle) * distance,
  );
  const oddRow = new THREE.Vector3(
    lastPoint.x + Math.cos(directionAngle) * (distance * 1.5),
    0,
    lastPoint.z + Math.sin(directionAngle) * (distance * 1.5),
  );
  pathPoints.push(newPoint);

  /*let m = new THREE.Mesh(
    new THREE.SphereGeometry(0.5),
    new THREE.MeshBasicMaterial({ color: 0xFF0000 }),
  )
  scene.add(m)
  m.position.set(newPoint.x,1,newPoint.z)*/

  // Wall Points
  const streetDistance = params.streetWidth * 0.5 + (Math.random() * 0.4 - 0.2);
  const wallPoints = [
    [
      new THREE.Vector3(
        newPoint.x + Math.cos(directionAngle - Math.PI * 0.5) * streetDistance,
        0,
        newPoint.z + Math.sin(directionAngle - Math.PI * 0.5) * streetDistance,
      ),
      new THREE.Vector3(
        oddRow.x + Math.cos(directionAngle - Math.PI * 0.5) * streetDistance,
        0,
        oddRow.z + Math.sin(directionAngle - Math.PI * 0.5) * streetDistance,
      ),
    ],
    [
      new THREE.Vector3(
        newPoint.x + Math.cos(directionAngle + Math.PI * 0.5) * streetDistance,
        0,
        newPoint.z + Math.sin(directionAngle + Math.PI * 0.5) * streetDistance,
      ),
      new THREE.Vector3(
        oddRow.x + Math.cos(directionAngle + Math.PI * 0.5) * streetDistance,
        0,
        oddRow.z + Math.sin(directionAngle + Math.PI * 0.5) * streetDistance,
      ),
    ],
  ];

  // Build two Brick Towers at WallPoints[0,1], make them look at newPoint
  let _brickOffset =
    ((pathPoints.length - 1) * (2 * params.wallY)) % params.bricksCount;
  const s = (stack = 0, wallCenter, brickOffset) => {
    if (stack < params.wallY) {
      const position = new THREE.Vector3(
        wallCenter[stack % 2].x,
        boxSize.y / 2 + stack * (boxSize.y + gap.y),
        wallCenter[stack % 2].z,
      );
      physics.setMeshPosition(boxes, position, brickOffset + stack);
      const direction = new THREE.Vector3()
        .subVectors(
          stack % 2 == 0
            ? new THREE.Vector3(newPoint.x, 0, newPoint.z)
            : new THREE.Vector3(oddRow.x, 0, oddRow.z),
          new THREE.Vector3(position.x, 0, position.z),
        )
        .normalize();
      const forward = new THREE.Vector3(0, 0, 1); // object's default forward axis
      const q = new THREE.Quaternion();
      q.setFromUnitVectors(forward, direction);
      physics.setMeshRotation(boxes, q, brickOffset + stack);
      brickPositions[brickOffset + stack] = {
        position: position,
        rotation: q,
      };
      stack++;
      setTimeout(() => {
        s(stack, wallCenter, brickOffset);
      }, 50);
    } else {
      cleanup();
    }
  };
  wallPoints.forEach((_wallCenter, wallKey) => {
    s(0, _wallCenter, _brickOffset + wallKey * params.wallY);
  });
};

const cleanup = (factor = 0.3) => {
  // Clamp factor between 0 and 1
  factor = Math.max(0, Math.min(1, factor));

  const camPos = camera.position;
  const total = boxes.count;

  // Build sortable array with index + distance
  const sortable = [];

  for (let i = 0; i < total; i++) {
    if (brickPositions[i] && brickPositions[i].position) {
      const pos = brickPositions[i].position;

      const dx = pos.x - camPos.x;
      const dy = pos.y - camPos.y;
      const dz = pos.z - camPos.z;

      const distSq = dx * dx + dy * dy + dz * dz; // squared distance (faster)

      sortable.push({ index: i, distSq });
    }
  }

  // Sort farthest → closest
  sortable.sort((a, b) => b.distSq - a.distSq);

  // Determine how many to clean up
  const countToCleanup = Math.floor(total * factor);

  for (let i = 0; i < countToCleanup; i++) {
    const idx = sortable[i].index;

    physics.setMeshRotation(boxes, brickPositions[idx].rotation, idx);
    physics.setMeshPosition(boxes, brickPositions[idx].position, idx);
  }
};

const onWindowResize = () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  resizePaintOverlay(paintOverlay, camera);
};

const baseQuat = new THREE.Quaternion();
const rotatedQuat = new THREE.Quaternion();
const finalQuat = new THREE.Quaternion();

let rotBlend = 0; // 0 → normal, 1 → rotated
let rotTarget = 0; // tween target
const clock = new THREE.Clock();

const MAX_DELTA = 0.1; // cap to prevent huge jumps after tab switch

const animate = () => {
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, MAX_DELTA);

  const { average: volume, longAverage, max } = updateFFT();
  moveSpeed = params.moveSpeedBase + longAverage / params.moveSpeedAudioDiv;

  vhsPass.uniforms["time"].value += delta;
  vhsPass.uniforms["scanlineIntensity"].value = params.vhsScanlines;
  vhsPass.uniforms["noiseIntensity"].value =
    params.vhsNoise + max * params.vhsNoiseAudioAdd;
  vhsPass.uniforms["colorBleed"].value = params.vhsColorBleed;
  vhsPass.uniforms["distortion"].value =
    params.vhsDistortion + max * params.vhsDistortionAudioAdd;

  if (pathPoints.length > 12 && ready) {
    // Ensure there are enough path points ahead before moving
    if (camPos >= pathPoints.length - 2) {
      buildup();
    } else {
      targetPosition.copy(pathPoints[camPos + 1]);
      targetPositionT.copy(pathPoints[camPos + 2]);
      const direction = new THREE.Vector3().subVectors(
        targetPosition,
        currentPosition,
      );
      const directionT = new THREE.Vector3().subVectors(
        targetPositionT,
        currentPositionT,
      );
      const distance = direction.length();
      if (distance < 0.001) {
        camPos++;
        buildup();
      } else {
        direction.normalize();
        directionT.normalize();
        const step = moveSpeed;
        if (step >= distance) {
          currentPosition.copy(targetPosition);
          currentPositionT.copy(targetPositionT);
          camPos++;
          buildup();
        } else {
          currentPosition.addScaledVector(direction, step);
          currentPositionT.addScaledVector(directionT, step);
        }
      }
    }
  }

  camera.position.set(
    currentPosition.x,
    params.wallY * boxSize.y * params.camHeight + volume,
    currentPosition.z,
  );

  // Smooth blend value
  rotBlend = THREE.MathUtils.damp(
    rotBlend,
    camRot ? 1 : 0,
    params.rotSpeed,
    delta,
  );

  // Base orientation
  camera.lookAt(
    currentPositionT.x,
    params.wallY * boxSize.y * params.camHeight + volume + params.lookUp,
    currentPositionT.z,
  );

  baseQuat.copy(camera.quaternion);

  // 2️⃣ 90° rotated version
  const q90 = new THREE.Quaternion();
  q90.setFromAxisAngle(camera.up, Math.PI / 2);

  rotatedQuat.copy(baseQuat).multiply(q90);

  // 3️⃣ Slerp (modern method)
  finalQuat.copy(baseQuat).slerp(rotatedQuat, rotBlend);

  // 4️⃣ Apply
  camera.quaternion.copy(finalQuat);

  camCollider.position.copy(camera.position);
  dirLight.position.copy(camera.position);
  floorCollider.position.set(camera.position.x, -2.5, camera.position.z);
  physics.setMeshPosition(floorCollider, floorCollider.position);
  physics.setMeshPosition(camCollider, camCollider.position);

  // Update paint splash sim
  uploadTexture(paintOverlay.dataTexture);
  paintOverlay.material.uniforms.uBlur.value = splashParams.blur;

  if (shadersEnabled) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
};

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    // Enter fullscreen
    document.body.requestFullscreen().catch((err) => {
      console.warn(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    // Exit fullscreen
    document.exitFullscreen();
  }
}

function onmousedown(e) {
  if (e.code === "KeyX" || e.code === "Enter") {
    if (Math.random() < 0.75) {
      throwRandomModel();
    } else {
      splat(
        0.5 + (Math.random() - 0.5) * 0.4,
        0.5 + (Math.random() - 0.5) * 0.4,
      );
    }
    return;
  }
  if (e.code === "KeyC") {
    cleanup();
    return;
  }
  if (e.code === "KeyR") {
    camRot = !camRot;
    return;
  }
  if (e.code === "KeyF") {
    toggleFullscreen();
    return;
  }
  if (e.code === "KeyS") {
    shadersEnabled = !shadersEnabled;
    return;
  }
  if (e.code === "KeyM") {
    const gui = window.__gui;
    if (gui) {
      const el = gui.domElement;
      el.style.display = el.style.display === "none" ? "" : "none";
    }
    return;
  }
}

// ---------- MODEL PRELOAD ----------
const preloadModels = async () => {
  const promises = models.map(({ file, scale, material }) => {
    return new Promise((resolve, reject) => {
      const mat = material ? new THREE.MeshStandardMaterial(material) : null;
      objLoader.load(
        `src/models/${file}`,
        (obj) => {
          obj.traverse((child) => {
            if (child.isMesh) {
              if (mat) child.material = mat;
              child.geometry.computeBoundingBox();
              child.geometry.computeBoundingSphere();
            }
          });
          obj.scale.setScalar(scale);
          loadedModels.push(obj);
          resolve();
        },
        undefined,
        reject,
      );
    });
  });
  await Promise.all(promises);
  console.log("Models preloaded:", loadedModels.length);
};

// ---------- SPAWN & THROW ----------
function throwRandomModel() {
  if (!loadedModels.length) return;

  const source = loadedModels[Math.floor(Math.random() * loadedModels.length)];
  const added = thrownModels.push(source.clone(true));
  const model = thrownModels[added - 1];

  // Position in front of camera
  model.position.copy(camera.position);
  model.position.y = params.wallY * boxSize.y * 0.5;

  // Add to scene
  scene.add(model);

  // Physics
  model.userData.physics = {
    mass: 1000,
    restitution: 0.2,
    friction: 0,
  };
  physics.addGroup(model);

  // Impulse forward + random spin
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y = 0;
  dir.z = -0.5 + Math.random();
  dir.normalize().multiplyScalar(20000);

  physics.setMeshVelocity(model, dir);
  const rotation = new THREE.Vector3(-10000 + Math.random() * 20000);

  physics.setTorqueImpulse(model, rotation);

  if (thrownModels.length > maxThrownModels) {
    physics.removeMesh(thrownModels[0]);
    scene.remove(thrownModels[0]);
    thrownModels.shift();
  }
}
