// Rendu, ciel dynamique (atmosphère + nuages + étoiles), lumière soleil/lune, post-traitement, qualité.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export const QUALITY = {
  low:    { label: 'Basse',   pr: 0.85, prMax: 1,   shadow: 1024, soft: false, ao: false, bloom: false, dof: false, aa: 'fxaa', water: 0,    grass: 0.35, hint: 'Pour les machines modestes : ombres simples, pas d\'occlusion ambiante, eau sans reflets.' },
  medium: { label: 'Moyenne', pr: 1,    prMax: 1.25, shadow: 2048, soft: true,  ao: false, bloom: true,  dof: false, aa: 'smaa', water: 256,  grass: 0.7,  hint: 'Bon compromis : ombres douces, bloom, reflets de la lagune.' },
  high:   { label: 'Haute',   pr: 1,    prMax: 1.5, shadow: 2048, soft: true,  ao: true,  bloom: true,  dof: false, aa: 'smaa', water: 512,  grass: 1,    hint: 'Occlusion ambiante GTAO, reflets détaillés, végétation dense.' },
  ultra:  { label: 'Ultra',   pr: 1,    prMax: 2,   shadow: 4096, soft: true,  ao: true,  bloom: true,  dof: true,  aa: 'smaa', water: 1024, grass: 1.4,  hint: 'Tout au maximum + profondeur de champ cinématique. Carte graphique dédiée recommandée.' },
};

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 0.55;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  return renderer;
}

/* ================= Ciel ================= */
const cloudVS = `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // toujours au fond
}`;
const cloudFS = `
uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uCoverage; uniform float uDay; uniform float uBright;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; mat2 r = mat2(0.8, -0.6, 0.6, 0.8); for (int i = 0; i < 6; i++) { v += a * noise(p); p = r * p * 2.02; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  if (d.y < 0.0) discard;
  vec2 uv = d.xz / (d.y + 0.12) * 0.9;
  vec2 wind = vec2(uTime * 0.0035, uTime * 0.0012);
  float base = fbm(uv * 1.3 + wind);
  float detail = fbm(uv * 4.0 - wind * 2.0);
  float n = base * 0.78 + detail * 0.22;
  float c = smoothstep(uCoverage, uCoverage + 0.22, n);
  float towards = fbm(uv * 1.3 + wind + uSunDir.xz * 0.06) * 0.78 + detail * 0.22;
  float shade = clamp(1.0 - (towards - n) * 4.0, 0.25, 1.0);
  float thick = smoothstep(uCoverage, uCoverage + 0.5, n);
  float sunGlow = pow(max(dot(d, uSunDir), 0.0), 6.0);
  vec3 darkC = mix(vec3(0.42, 0.45, 0.52), vec3(0.62, 0.48, 0.42), clamp(1.0 - uSunDir.y * 3.0, 0.0, 1.0));
  vec3 col = mix(darkC, uSunColor, shade * (1.0 - thick * 0.45));
  col += uSunColor * sunGlow * (1.0 - thick) * 1.5;
  col *= uBright * uDay;
  col += vec3(0.012, 0.016, 0.03) * (1.0 - uDay);
  float a = c * smoothstep(0.0, 0.18, d.y);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Environment {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastEnvHour = -99; this.lastEnvTime = 0;

    // atmosphère
    this.sky = new Sky(); this.sky.scale.setScalar(4500);
    this.sky.material.uniforms.turbidity.value = 4.2;  // air chaud et humide, mais ciel encore bleu
    this.sky.material.uniforms.rayleigh.value = 2.2;
    this.sky.material.uniforms.mieCoefficient.value = 0.005;
    this.sky.material.uniforms.mieDirectionalG.value = 0.86;
    scene.add(this.sky);

    // nuages
    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: cloudVS, fragmentShader: cloudFS, transparent: true, depthWrite: false, side: THREE.BackSide,
      uniforms: { uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) }, uCoverage: { value: 0.57 }, uDay: { value: 1 }, uBright: { value: 9 } },
    });
    const cg = new THREE.SphereGeometry(4000, 48, 24);
    this.clouds = new THREE.Mesh(cg, this.cloudMat); this.clouds.renderOrder = -1; this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    // étoiles
    const sp = []; for (let i = 0; i < 2200; i++) { const v = new THREE.Vector3().randomDirection(); if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05; v.normalize().multiplyScalar(3800); sp.push(v.x, v.y, v.z); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.frustumCulled = false;
    scene.add(this.stars);

    // scène dédiée à la génération de l'éclairage d'environnement
    this.envScene = new THREE.Scene();
    this.envSky = new Sky(); this.envSky.scale.setScalar(4500); this.envSky.material = this.sky.material;
    this.envClouds = new THREE.Mesh(cg, this.cloudMat);
    this.envScene.add(this.envSky, this.envClouds);

    // lumières
    this.sun = new THREE.DirectionalLight('#fff3e0', 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera; sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 160;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun, this.sun.target);
    this.night = new THREE.HemisphereLight('#3a4a78', '#1a140f', 0);
    scene.add(this.night);

    scene.fog = new THREE.FogExp2('#c8d2d4', 0.0026);
    this.sunDir = new THREE.Vector3();
    this.dayFactor = 1;
    this.horizon = new THREE.Color();
  }

  /** hour: 0..24 ; focus: point suivi par l'ombre */
  update(hour, time, focus, forceEnv = false) {
    // trajectoire du soleil (Abidjan ≈ 5°N : soleil presque au zénith à midi)
    const t = (hour - 6.15) / 12.2; // 0 lever → 1 coucher
    const el = Math.sin(t * Math.PI) * 78 * Math.PI / 180;
    const az = THREE.MathUtils.lerp(-100, 100, t) * Math.PI / 180;
    const sunUp = t > -0.05 && t < 1.05;
    const elev = sunUp ? el : -0.3;
    this.sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev) * 0.45 + 0.2).normalize();
    if (!sunUp) this.sunDir.set(0.3, -0.25, -0.2).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);

    const elevDeg = Math.asin(this.sunDir.y) * 180 / Math.PI;
    const day = THREE.MathUtils.smoothstep(elevDeg, -6, 8);
    const golden = 1 - THREE.MathUtils.smoothstep(elevDeg, 2, 22);
    this.dayFactor = day;

    // couleur du soleil : blanc chaud → orangé au ras de l'horizon
    const sunCol = new THREE.Color('#fff5e6').lerp(new THREE.Color('#ff9a4a'), golden * 0.85);
    this.cloudMat.uniforms.uSunDir.value.copy(this.sunDir.y > -0.1 ? this.sunDir : new THREE.Vector3(0, 1, 0));
    this.cloudMat.uniforms.uSunColor.value.copy(sunCol);
    this.cloudMat.uniforms.uDay.value = Math.max(day, 0.02);
    this.cloudMat.uniforms.uTime.value = time;
    this.starMat.opacity = (1 - day) * 0.9;

    // lumière directionnelle : soleil le jour, lune la nuit
    const moon = day < 0.05;
    const lightDir = moon ? new THREE.Vector3(-0.35, 0.8, 0.45).normalize() : this.sunDir.clone();
    if (lightDir.y < 0.06) lightDir.y = 0.06;
    this.sun.color.copy(moon ? new THREE.Color('#8ea6d8') : sunCol);
    this.sun.intensity = moon ? 0.55 : 6.3 * day * (0.6 + 0.4 * (1 - golden));
    const fx = Math.round(focus.x), fz = Math.round(focus.z);
    this.sun.position.set(fx + lightDir.x * 70, lightDir.y * 70, fz + lightDir.z * 70);
    this.sun.target.position.set(fx, 0, fz);
    this.night.intensity = (1 - day) * 1.1;

    // brume / brouillard atmosphérique
    this.horizon.set('#0d1422').lerp(new THREE.Color('#e3a77a'), golden * day).lerp(new THREE.Color('#c3d0d6'), day * (1 - golden));
    this.scene.fog.color.copy(this.horizon);
    this.scene.fog.density = 0.0011 + golden * 0.0008;
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(0.55, 0.86, day) + golden * 0.1 * day;

    // éclairage d'environnement (réflexions, lumière ambiante) recalculé quand le ciel change
    const now = performance.now();
    if (forceEnv || (Math.abs(hour - this.lastEnvHour) > 0.2 && now - this.lastEnvTime > 350)) {
      this.lastEnvHour = hour; this.lastEnvTime = now;
      const rt = this.pmrem.fromScene(this.envScene, 0, 1, 5000);
      this.scene.environment = rt.texture;
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environmentIntensity = 0.32 + 0.16 * day; // peu d'ambiance = ombres franches du soleil tropical
    }
    return { day, golden };
  }
}

/* ================= Post-traitement ================= */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.32 }, uWarm: { value: 0.04 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uWarm; varying vec2 vUv;
    float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // étalonnage léger : ombres un peu froides, hautes lumières chaudes
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb += vec3(uWarm, uWarm * 0.4, -uWarm) * smoothstep(0.4, 1.0, l);
      c.rgb += vec3(-0.008, 0.0, 0.012) * (1.0 - smoothstep(0.0, 0.35, l));
      c.rgb = mix(vec3(l), c.rgb, 1.06);
      // vignettage
      vec2 d = vUv - 0.5; c.rgb *= 1.0 - dot(d, d) * uVignette * 2.0;
      // grain de film discret
      c.rgb += (rand(vUv * 1000.0 + uTime) - 0.5) * 0.018;
      gl_FragColor = c;
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.composer = null;
  }
  build(q) {
    const r = this.renderer;
    if (this.composer) this.composer.dispose();
    const size = r.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x * r.getPixelRatio(), size.y * r.getPixelRatio(), { type: THREE.HalfFloatType, samples: 0 });
    const c = new EffectComposer(r, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = null; this.bloom = null; this.bokeh = null;
    if (q.ao) {
      // occlusion ambiante calculée en demi-résolution : quasi invisible à l'œil, ~4× moins coûteuse
      this.gtao = new GTAOPass(this.scene, this.camera, size.x / 2, size.y / 2);
      const setGtaoSize = this.gtao.setSize.bind(this.gtao);
      this.gtao.setSize = (w, h) => setGtaoSize(Math.ceil(w / 2), Math.ceil(h / 2));
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 8 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 });
      this.gtao.blendIntensity = 0.85;
      c.addPass(this.gtao);
    }
    if (q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.45, 2.6); c.addPass(this.bloom); }
    if (q.dof) { this.bokeh = new BokehPass(this.scene, this.camera, { focus: 12, aperture: 0.00012, maxblur: 0.006 }); c.addPass(this.bokeh); }
    c.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader); c.addPass(this.grade);
    if (q.aa === 'smaa') c.addPass(new SMAAPass(size.x * r.getPixelRatio(), size.y * r.getPixelRatio()));
    else if (q.aa === 'fxaa') {
      const fx = new ShaderPass(FXAAShader);
      fx.material.uniforms.resolution.value.set(1 / (size.x * r.getPixelRatio()), 1 / (size.y * r.getPixelRatio()));
      c.addPass(fx);
    }
    this.composer = c;
  }
  setSize(w, h) { if (this.composer) this.composer.setSize(w, h); }
  render(dt, time, nightFactor, focusDist) {
    if (this.grade) this.grade.uniforms.uTime.value = time % 100;
    if (this.bloom) { this.bloom.strength = 0.06 + nightFactor * 0.5; this.bloom.threshold = THREE.MathUtils.lerp(4.0, 1.2, nightFactor); }
    if (this.bokeh) this.bokeh.uniforms.focus.value = focusDist;
    this.composer.render(dt);
  }
}
