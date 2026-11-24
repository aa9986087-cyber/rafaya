import * as THREE from "three";

export function wetSurface(material, weather, strength) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.surfaceWet = weather.wet;
    shader.uniforms.wetStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
      uniform float surfaceWet, wetStrength;`).replace("#include <color_fragment>", `#include <color_fragment>
      diffuseColor.rgb *= 1.0 - wetStrength * surfaceWet;`).replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.36, surfaceWet * wetStrength);`);
  };
  return material;
}

/** Shared one-pass water for the lake, wadi and shallow rain pools. */
export function worldWater(weather, { mask = null, puddle = false, current = 0 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    defines: { ...(mask && { WATER_MASK: 1 }), ...(puddle && { WATER_PUDDLE: 1 }) },
    uniforms: {
      waterTime: weather.time, waterRain: weather.rain, waterWet: weather.wet,
      waterDay: weather.day, waterFlow: { value: current }, shapeMap: { value: mask },
    },
    vertexShader: `
      varying vec2 surfaceUv;
      varying vec3 waterWorld;
      void main() {
        surfaceUv = uv;
        vec4 p = modelMatrix * vec4(position, 1.);
        waterWorld = p.xyz;
        gl_Position = projectionMatrix * viewMatrix * p;
      }`,
    fragmentShader: `
      varying vec2 surfaceUv;
      varying vec3 waterWorld;
      uniform float waterTime, waterRain, waterWet, waterDay, waterFlow;
      uniform sampler2D shapeMap;

      vec2 waterHash(vec2 p) {
        p = fract(p * vec2(.3183099,.3678794) + vec2(.17,.51));
        p += dot(p,p.yx+19.19);
        return fract(vec2(p.x*p.y,p.x+p.y) * vec2(17.35, 43.17));
      }

      void main() {
        vec2 p = waterWorld.xz;
        float cover = 1.;
        float depth = .8;
        #ifdef WATER_MASK
          cover = texture2D(shapeMap, surfaceUv).g;
          depth = smoothstep(.33,.97,cover);
          cover = smoothstep(.32,.64,cover);
        #endif
        #ifdef WATER_PUDDLE
          vec2 q = surfaceUv * 2. - 1.;
          float a = atan(q.y,q.x + .00001);
          float r = length(q) + sin(a*3.+p.x*.29)*.12 + sin(a*7.)*.054;
          cover = (1.-smoothstep(.59+.23*waterWet,.72+.24*waterWet,r)) * smoothstep(.11,.52,waterWet);
          depth = (1.-r) * .31;
        #endif
        if(cover<.012) discard;
        float t = waterTime;
        vec2 flow = p + vec2(-t * waterFlow,0.);
        float w1 = flow.x*9.5 + flow.y*5.1 - t*2.45;
        float w2 = flow.x*3.7 - flow.y*10.6 + t*1.83;
        float w3 = flow.x*23. - flow.y*12. + t*2.1;
        vec3 n = normalize(vec3(cos(w1)*.061 + cos(w2)*.044,1.,sin(w2)*.074+sin(w3)*.021));
        vec3 v = normalize(cameraPosition - waterWorld);
        float fresnel = .17 + .65*pow(1.-max(dot(n,v),0.),3.);
        float reflected = smoothstep(.01,.94,.5 + .5*sin(flow.y*3.3 + sin(flow.x*1.4) + cos(w1)*.13));
        vec3 shallow = vec3(.133,.234,.163);
        vec3 deep = vec3(.012,.084,.091);
        vec3 sky = mix(vec3(.055,.085,.14),vec3(.36,.46,.50),waterDay);
        vec3 color = mix(shallow,deep,depth) * mix(.23,1.,waterDay);
        color = mix(color,sky*(.57+reflected*.34),fresnel + waterRain*.11);
        vec2 cell = floor(p * 3.1);
        vec2 rand = waterHash(cell);
        float age = fract(t*1.04 + rand.x*2.);
        float dist = length(fract(p*3.1) - (.24+.52*rand));
        float radius = age * (.29 + rand.y*.23);
        float ring = (1.-smoothstep(.012,.037,abs(dist-radius))) * (1.-age) * smoothstep(.04,.19,age);
        ring *= smoothstep(.15,.62,rand.y) * (.5+.5*sin(w2+rand.x*4.));
        float crest = pow(max(0.,sin(w1 + sin(w2)*.36)),20.) * (.031 + reflected*.056);
        color += vec3(.72,.83,.91) * (crest*waterDay + ring*.31*waterRain);
        #ifdef WATER_PUDDLE
          color = mix(vec3(.046,.044,.039)*mix(.42,1.,waterDay),color,.62+reflected*.20);
        #endif
        gl_FragColor = vec4(color,cover*.91);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function rainField(weather, count) {
  const vertices = new Float32Array(count * 6), ends = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const shape = [Math.random()-.5, Math.random(), Math.random()-.5];
    vertices.set(shape, i * 6); vertices.set(shape, i * 6 + 3);
    ends[i * 2 + 1] = 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute("trailEnd", new THREE.BufferAttribute(ends, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { rainTime: weather.time, storm: weather.rain, fieldSize: { value: 17 } },
    vertexShader: `
      attribute float trailEnd;
      varying float streakAlpha;
      uniform float rainTime, fieldSize;
      void main() {
        float phase = fract(position.y - rainTime * (1.05 + fract(position.x*17.)*.37));
        float drift = (phase + trailEnd*.065) * 1.64;
        vec3 local = vec3(position.x * fieldSize + drift, phase * 7. + trailEnd * (.25+position.y*.2), position.z * fieldSize);
        streakAlpha = (1.-trailEnd*.72) * smoothstep(0.,.07,phase) * (1.-smoothstep(.9,1.,phase)) * (.56 + position.y*.44);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.);
      }`,
    fragmentShader: `
      uniform float storm;
      varying float streakAlpha;
      void main() {
        gl_FragColor = vec4(.79,.88,.95,storm*streakAlpha*.63);
        #include <colorspace_fragment>
      }`,
  });
  const field = new THREE.LineSegments(geometry, material);
  field.frustumCulled = false;
  return field;
}
