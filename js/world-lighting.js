import * as THREE from "three";

const LIGHT_PIXELS_PER_TILE = 10;

export function makeNightLighting(extent) {
  const size = extent * LIGHT_PIXELS_PER_TILE;
  const map = new THREE.DataTexture(new Uint8Array(size * size * 4), size, size);
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return { nightLightMap: { value: map }, nightLightMix: { value: 0 }, nightLightExtent: { value: extent } };
}

/** Bake fixed lights into one map. Red is falloff, green is colour temperature, and BA is direction. */
export function bakeNightLighting(lighting, sources) {
  const map = lighting.nightLightMap.value, extent = lighting.nightLightExtent.value;
  const { data, width: size } = map.image;
  const values = new Float32Array(data.length);
  const scale = size / extent, half = extent / 2;
  for (const { x, z, yaw = 0, width, length = width, strength, warmth } of sources) {
    const ux = Math.cos(yaw), uz = Math.sin(yaw), range = Math.max(width, length);
    const loX = Math.max(0, Math.floor((x - range + half) * scale));
    const hiX = Math.min(size - 1, Math.ceil((x + range + half) * scale));
    const loZ = Math.max(0, Math.floor((z - range + half) * scale));
    const hiZ = Math.min(size - 1, Math.ceil((z + range + half) * scale));
    for (let iy = loZ; iy <= hiZ; iy++) for (let ix = loX; ix <= hiX; ix++) {
      const dx = (ix + .5) / scale - half - x, dz = (iy + .5) / scale - half - z;
      const along = (dx * ux + dz * uz) / length, across = (-dx * uz + dz * ux) / width;
      const r2 = along * along + across * across;
      if (r2 >= 1) continue;
      const energy = ((1 - r2) ** 2 / (1 + r2 * 1.8)) * strength;
      const d = Math.max(.22, Math.hypot(dx, dz));
      const i = (iy * size + ix) * 4;
      values[i] += energy;
      values[i + 1] += energy * warmth;
      values[i + 2] -= energy * dx / d;
      values[i + 3] -= energy * dz / d;
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    const total = values[i];
    if (total <= 0) { data[i] = data[i + 1] = 0; data[i + 2] = data[i + 3] = 128; continue; }
    data[i] = Math.round(Math.min(1, total) * 255);
    data[i + 1] = Math.round(Math.min(1, values[i + 1] / total) * 255);
    data[i + 2] = Math.round((.5 + .5 * values[i + 2] / total) * 255);
    data[i + 3] = Math.round((.5 + .5 * values[i + 3] / total) * 255);
  }
  map.needsUpdate = true;
}

export const NIGHT_LIGHT_SHADER = `
uniform sampler2D nightLightMap;
uniform float nightLightMix, nightLightExtent;
vec4 sampleNightLight(vec2 pos) {
  return texture2D(nightLightMap, pos / nightLightExtent + .5);
}
vec3 nightLightTint(float warmth) {
  return mix(vec3(.83, .92, 1.), vec3(1., .66, .30), warmth);
}`;

/** Illuminate the surface itself; a shared sample by position can reach road paint, walls and glass. */
export function addNightLighting(material, lighting) {
  const prior = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prior.call(material, shader, renderer);
    Object.assign(shader.uniforms, lighting);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 nightWorld;")
      .replace("#include <project_vertex>", `
        vec4 lightPos = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
          lightPos = instanceMatrix * lightPos;
        #endif
        nightWorld = (modelMatrix * lightPos).xyz;
        #include <project_vertex>`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>",
      "#include <common>\nvarying vec3 nightWorld;\n" + NIGHT_LIGHT_SHADER)
      .replace("#include <emissivemap_fragment>", `
        #include <emissivemap_fragment>
        if (nightLightMix > .003 && nightWorld.y < .98) {
          vec4 localNight = sampleNightLight(nightWorld.xz);
          vec3 toLamp = normalize(vec3(localNight.b * 2. - 1., .54, localNight.a * 2. - 1.));
          vec3 localNormal = inverseTransformDirection(normal, viewMatrix);
          float facing = .19 + .81 * max(0., dot(localNormal, toLamp));
          float heightFalloff = 1. - smoothstep(.11, .98, nightWorld.y);
          float power = localNight.r * nightLightMix * facing * heightFalloff;
          totalEmissiveRadiance += diffuseColor.rgb * nightLightTint(localNight.g) * (power * 2.2);
        }`);
  };
  material.customProgramCacheKey = () => key + "|rafaya-night-light";
  return material;
}

/** A pair of tapered low beams on the road, in one batch for all moving cars. */
export function makeHeadlightMaterial(lighting, weather) {
  return new THREE.ShaderMaterial({
    uniforms: { headlightMix: lighting.nightLightMix, wetRoad: weather.wet },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 beamUv;
      void main() {
        beamUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.);
      }`,
    fragmentShader: `
      uniform float headlightMix, wetRoad;
      varying vec2 beamUv;
      void main() {
        float d = beamUv.x;
        float outer = .075 + d * .27;
        float offset = abs(abs(beamUv.y - .5) - .145 * (1. - d * .58));
        float beam = (1. - smoothstep(.018, outer, offset)) * smoothstep(0., .11, d)
          * (1. - smoothstep(.20, 1., d));
        gl_FragColor = vec4(.93, .95, 1., beam * headlightMix * (.26 + .19 * wetRoad));
        #include <colorspace_fragment>
      }`
  });
}
