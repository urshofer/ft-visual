import * as THREE from "three";

const W = 200,
  H = 112;

// Sim buffers
const sim = new Float32Array(W * H * 4);
const tmp = new Float32Array(W * H * 4);
const buf = new Uint8Array(W * H * 4);
const drip = new Float32Array(W);
for (let x = 0; x < W; x++)
  drip[x] =
    0.5 + Math.sin(x * 0.37 + 1.1) * 0.25 + Math.sin(x * 0.89 + 2.9) * 0.2;

const I = (x, y) => (y * W + x) * 4;
const waitMap = new Uint8Array(W * H); // per-pixel wait frames
let hue = Math.random();

// Params
const splashParams = {
  size: 50,
  flow: 2,
  wait: 3,
  blur: 0,
};

function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x2 = c * (1 - Math.abs(((h * 6) % 2) - 1)),
    m = l - c / 2;
  const i = ((h * 6) | 0) % 6;
  return [
    [c, x2, 0],
    [x2, c, 0],
    [0, c, x2],
    [0, x2, c],
    [x2, 0, c],
    [c, 0, x2],
  ][i].map((v) => v + m);
}

function spreadIter() {
  tmp.set(sim);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = I(x, y),
        a = sim[i + 3];
      if (a < 0.006) continue;
      const r = sim[i],
        g = sim[i + 1],
        b = sim[i + 2];
      const ns = [];
      if (y > 0) ns.push(I(x, y - 1));
      if (y < H - 1) ns.push(I(x, y + 1));
      if (x > 0) ns.push(I(x - 1, y));
      if (x < W - 1) ns.push(I(x + 1, y));
      for (const di of ns) {
        const ex = a - sim[di + 3];
        if (ex < 0.004) continue;
        const f = Math.min((ex * 0.38) / ns.length, a * 0.16);
        if (f < 1e-4) continue;
        const oa = tmp[di + 3],
          na = Math.min(1.0, oa + f),
          act = na - oa;
        if (act < 1e-4) continue;
        tmp[di] = (tmp[di] * oa + r * act) / na;
        tmp[di + 1] = (tmp[di + 1] * oa + g * act) / na;
        tmp[di + 2] = (tmp[di + 2] * oa + b * act) / na;
        tmp[di + 3] = na;
        tmp[i + 3] = Math.max(0, tmp[i + 3] - act);
      }
    }
  sim.set(tmp);
}

function gravityIter(rate) {
  for (let y = H - 2; y >= 0; y--)
    for (let x = 0; x < W; x++) {
      const i = I(x, y),
        a = sim[i + 3];
      if (a < 1e-4) continue;
      const bi = I(x, y + 1),
        ba = sim[bi + 3],
        space = 1.0 - ba;
      if (space < 1e-3) continue;
      const boost = 1.0 + Math.max(0, a - 0.06) * 9.0;
      const f = Math.min(a * rate * boost * drip[x], a * 0.88, space);
      if (f < 1e-4) continue;
      const r = sim[i],
        g = sim[i + 1],
        b = sim[i + 2],
        nba = ba + f;
      sim[bi] = (sim[bi] * ba + r * f) / nba;
      sim[bi + 1] = (sim[bi + 1] * ba + g * f) / nba;
      sim[bi + 2] = (sim[bi + 2] * ba + b * f) / nba;
      sim[bi + 3] = nba;
      sim[i + 3] -= f;
    }
  for (let x = 0; x < W; x++) {
    const i = I(x, H - 1);
    sim[i + 3] = Math.max(0, sim[i + 3] - rate * 5.0);
  }
  const decay = rate * 0.016;
  for (let k = 0; k < sim.length; k += 4) {
    sim[k + 3] -= decay;
    if (sim[k + 3] < 0.012) {
      sim[k] = 0;
      sim[k + 1] = 0;
      sim[k + 2] = 0;
      sim[k + 3] = 0;
    }
  }
}

function gravityIterPerPixel(rate) {
  for (let y = H - 2; y >= 0; y--)
    for (let x = 0; x < W; x++) {
      if (waitMap[y * W + x] > 0) continue; // this pixel is still held
      const i = I(x, y),
        a = sim[i + 3];
      if (a < 1e-4) continue;
      const bi = I(x, y + 1),
        ba = sim[bi + 3],
        space = 1.0 - ba;
      if (space < 1e-3) continue;
      const boost = 1.0 + Math.max(0, a - 0.06) * 9.0;
      const f = Math.min(a * rate * boost * drip[x], a * 0.88, space);
      if (f < 1e-4) continue;
      const r = sim[i],
        g = sim[i + 1],
        b = sim[i + 2],
        nba = ba + f;
      sim[bi] = (sim[bi] * ba + r * f) / nba;
      sim[bi + 1] = (sim[bi + 1] * ba + g * f) / nba;
      sim[bi + 2] = (sim[bi + 2] * ba + b * f) / nba;
      sim[bi + 3] = nba;
      sim[i + 3] -= f;
    }
  for (let x = 0; x < W; x++) {
    if (waitMap[(H - 1) * W + x] > 0) continue;
    const i = I(x, H - 1);
    sim[i + 3] = Math.max(0, sim[i + 3] - rate * 5.0);
  }
  const decay = rate * 0.016;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (waitMap[y * W + x] > 0) continue;
      const k = I(x, y);
      sim[k + 3] -= decay;
      if (sim[k + 3] < 0.012) {
        sim[k] = 0;
        sim[k + 1] = 0;
        sim[k + 2] = 0;
        sim[k + 3] = 0;
      }
    }
}

// Fractal splash boundary (adapted from magicBox by Aiekick)
function magicBox(px, py, pz, c) {
  let x = 1 - Math.abs(1 - (((px % 2) + 2) % 2));
  let y = 1 - Math.abs(1 - (((py % 2) + 2) % 2));
  let z = 1 - Math.abs(1 - (((pz % 2) + 2) % 2));
  let lL = Math.sqrt(x * x + y * y + z * z);
  let tot = 0;
  for (let i = 0; i < 10; i++) {
    x = Math.abs(x) / (lL * lL) - c;
    y = Math.abs(y) / (lL * lL) - c;
    z = Math.abs(z) / (lL * lL) - c;
    const nL = Math.sqrt(x * x + y * y + z * z);
    tot += Math.abs(nL - lL);
    lL = nL;
  }
  return tot;
}

function splat(nx, ny) {
  const sx = nx * W,
    sy = ny * H;
  const rad = splashParams.size;
  const maxReach = W * 0.025;
  hue = (hue + 0.14 + Math.random() * 0.14) % 1;
  const [pr, pg, pb] = hsl(
    hue,
    0.88 + Math.random() * 0.12,
    0.36 + Math.random() * 0.24,
  );

  // Random fractal seed per splash
  const c = Math.sin(1 + Math.random() * 6.28);
  const extent = 4.0 + Math.random() * 3.0;
  const uvScale = 2.4 + Math.random() * 1.2;
  const rotation = Math.random() * Math.PI * 2;
  const cosR = Math.cos(rotation),
    sinR = Math.sin(rotation);

  const scan = Math.ceil(maxReach + rad);
  for (
    let y = Math.max(0, (sy - scan) | 0);
    y < Math.min(H, (sy + scan + 1) | 0);
    y++
  )
    for (
      let x = Math.max(0, (sx - scan) | 0);
      x < Math.min(W, (sx + scan + 1) | 0);
      x++
    ) {
      const dx = x - sx,
        dy = y - sy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > scan) continue;

      // Normalize to splash-local UV space and rotate
      let ux = (dx / rad) * uvScale;
      let uy = (dy / rad) * uvScale;
      const rx = ux * cosR - uy * sinR;
      const ry = ux * sinR + uy * cosR;

      // Angle for fractal 3rd dimension
      let a = Math.atan2(ry, rx);
      if (rx < 0) a = Math.PI - Math.atan2(-ry, -rx) * 1.66;
      else a *= 0.275;

      // Fractal threshold
      const fc = magicBox(rx, ry, a, c) + 1.0;
      const dd = rx * rx + ry * ry;
      if (dd < 0.0001) continue;
      const threshold = extent / dd;
      const inside = 1.0 - (fc < threshold ? 0.0 : 1.0);

      if (inside < 0.01) continue;
      const k = I(x, y);
      sim[k] = pr;
      sim[k + 1] = pg;
      sim[k + 2] = pb;
      sim[k + 3] = Math.min(1.0, Math.max(sim[k + 3], inside));
      waitMap[y * W + x] = splashParams.wait;
    }
}

function uploadTexture(dataTexture) {
  // Tick per-pixel wait timers
  let anyWaiting = false;
  for (let i = 0; i < waitMap.length; i++) {
    if (waitMap[i] > 0) {
      waitMap[i]--;
      anyWaiting = true;
    }
  }

  // Only run gravity on pixels that aren't waiting
  const sp = splashParams.flow;
  const rate = 0.022 + sp * 0.022;
  const steps = 4 + Math.round(sp * 0.9);
  for (let s = 0; s < steps; s++) gravityIterPerPixel(rate);

  // Write premultiplied RGBA into the texture data (flipped Y)
  const data = dataTexture.image.data;
  for (let y = 0; y < H; y++) {
    const sy = y * W * 4,
      dy = (H - 1 - y) * W * 4;
    for (let x = 0; x < W; x++) {
      const s = sy + x * 4,
        d = dy + x * 4;
      const a = sim[s + 3];
      if (a < 0.012) {
        data[d] = 0;
        data[d + 1] = 0;
        data[d + 2] = 0;
        data[d + 3] = 0;
      } else {
        data[d] = (sim[s] * a * 255 + 0.5) | 0;
        data[d + 1] = (sim[s + 1] * a * 255 + 0.5) | 0;
        data[d + 2] = (sim[s + 2] * a * 255 + 0.5) | 0;
        data[d + 3] = (a * 255 + 0.5) | 0;
      }
    }
  }
  dataTexture.needsUpdate = true;
}

// Blur shader material
const PaintBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    uPx: { value: new THREE.Vector2(1 / W, 1 / H) },
    uBlur: { value: 3.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform vec2 uPx;
    uniform float uBlur;
    void main() {
      float s = uBlur;
      vec2 offsets[9];
      offsets[0] = vec2(-s,-s); offsets[1] = vec2(0.0,-s); offsets[2] = vec2(s,-s);
      offsets[3] = vec2(-s,0.0); offsets[4] = vec2(0.0,0.0); offsets[5] = vec2(s,0.0);
      offsets[6] = vec2(-s, s); offsets[7] = vec2(0.0, s); offsets[8] = vec2(s, s);
      float weights[9];
      weights[0]=1.0; weights[1]=2.0; weights[2]=1.0;
      weights[3]=2.0; weights[4]=4.0; weights[5]=2.0;
      weights[6]=1.0; weights[7]=2.0; weights[8]=1.0;
      vec4 acc = vec4(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 9; i++) {
        vec4 s2 = texture2D(tDiffuse, vUv + offsets[i] * uPx);
        acc += s2 * weights[i];
        wsum += weights[i];
      }
      acc /= wsum;
      vec3 col = acc.a > 0.001 ? acc.rgb / acc.a : vec3(0.0);
      gl_FragColor = vec4(col, acc.a);
    }
  `,
};

function createPaintOverlay(camera) {
  // DataTexture for the sim
  const data = new Uint8Array(W * H * 4);
  const dataTexture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  dataTexture.minFilter = THREE.LinearFilter;
  dataTexture.magFilter = THREE.LinearFilter;
  dataTexture.needsUpdate = true;

  // ShaderMaterial with blur
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: dataTexture },
      uPx: { value: new THREE.Vector2(1 / W, 1 / H) },
      uBlur: { value: splashParams.blur },
    },
    vertexShader: PaintBlurShader.vertexShader,
    fragmentShader: PaintBlurShader.fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  // Size the plane to exactly fill the viewport at the given z distance
  const dist = 1;
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const planeH = 2 * Math.tan(vFov / 2) * dist;
  const planeW = planeH * camera.aspect;

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(planeW, planeH),
    material,
  );
  plane.frustumCulled = false;
  plane.position.set(0, 0, -dist);
  plane.renderOrder = 999;
  camera.add(plane);

  return { dataTexture, material, plane };
}

function resizePaintOverlay(overlay, camera) {
  const dist = 1;
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const planeH = 2 * Math.tan(vFov / 2) * dist;
  const planeW = planeH * camera.aspect;
  overlay.plane.geometry.dispose();
  overlay.plane.geometry = new THREE.PlaneGeometry(planeW, planeH);
}

function clearSim() {
  sim.fill(0);
  waitMap.fill(0);
}

export {
  createPaintOverlay,
  resizePaintOverlay,
  uploadTexture,
  splat,
  clearSim,
  splashParams,
  W,
  H,
};
