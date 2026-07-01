const VHSShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0.0 },
    scanlineIntensity: { value: 0.15 },
    noiseIntensity: { value: 0.08 },
    colorBleed: { value: 0.003 },
    distortion: { value: 0.001 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float scanlineIntensity;
    uniform float noiseIntensity;
    uniform float colorBleed;
    uniform float distortion;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      // Vertical wobble distortion
      float wobble = sin(vUv.y * 100.0 + time * 3.0) * distortion;
      float bigWobble = sin(vUv.y * 5.0 + time * 0.5) * distortion * 2.0;
      vec2 uv = vUv;
      uv.x += wobble + bigWobble;

      // Chromatic aberration / color bleed (horizontal only, like VHS)
      float r = texture2D(tDiffuse, vec2(uv.x + colorBleed, uv.y)).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, vec2(uv.x - colorBleed, uv.y)).b;
      vec3 color = vec3(r, g, b);

      // Scanlines
      float scanline = sin(vUv.y * 800.0) * 0.5 + 0.5;
      color -= scanline * scanlineIntensity;

      // Noise
      float noise = rand(vUv + fract(time)) * noiseIntensity;
      color += noise;

      // Slight vignette
      float vignette = smoothstep(0.8, 0.3, distance(vUv, vec2(0.5)));
      color *= vignette;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export { VHSShader };
