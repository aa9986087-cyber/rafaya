import * as THREE from "three";

export const BUILDING_SURFACES = ["stone", "plaster", "wood"];
const surfaceCache = new Map();

// Periodic patterns in a single small texture per material. The same projection covers every wall in a model.
function wallTexture(kind) {
  if (surfaceCache.has(kind)) return surfaceCache.get(kind);
  const size = 256, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d"), rgba = context.createImageData(size,size), pi = Math.PI*2;
  let seed = 61, index = 0;
  const random = () => ((seed = Math.imul(seed,1664525) + 1013904223 | 0) >>> 0) / 4294967296;
  const unit = (n) => n - Math.floor(n);
  const scalar = (v) => Math.round(255*Math.min(1,Math.max(0,v)));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x/size, v = y/size, grain = random() - .5;
    const macro = Math.cos(pi*(u*3+v))*Math.sin(pi*(v*2-u));
    const erosion = Math.sin(pi*(u*16+v*4 + Math.sin(v*pi)*.85)) * Math.cos(pi*(u*27-v*10));
    let shade;
    if (kind === "stone") {
      const row = Math.floor(v*8), h = unit(v*8), xShift = u*4 + (row%2)*.5;
      const block = Math.floor(xShift)%4, w = unit(xShift);
      const joints = Math.min(w*.86,(1-w)*.86,h*.54,(1-h)*.54);
      const wornEdge = joints + erosion*.012;
      const blockTint = .89 + Math.sin((row+1)*38.11+block*43.73)*.061;
      shade = wornEdge < .012 ? .51+grain*.12 : blockTint + macro*.031 + erosion*.046 + grain*.16;
      if (wornEdge < .026 && h < .14) shade -= .09;
      if (wornEdge < .024 && h > .83) shade += .069;
    } else if (kind === "wood") {
      const seam = unit(u*8 + .07*Math.cos(v*pi*6));
      const fibre = Math.cos(pi*(u*54+Math.sin(v*pi*2)*.33 + macro*.22));
      shade = seam < .035 ? .49 + grain*.1 : .82 + fibre*.064 + erosion*.024 + grain*.085;
    } else {
      const pits = Math.max(0, erosion*.74 + grain*.46 - .37);
      shade = .92 + macro*.049 + erosion*.023 + grain*.105 - pits*.24;
    }
    rgba.data[index++] = scalar(shade);
    rgba.data[index++] = scalar(shade*(kind === "wood" ? .975 : .991));
    rgba.data[index++] = scalar(shade*(kind === "wood" ? .941 : .982));
    rgba.data[index++] = 255;
  }
  context.putImageData(rgba,0,0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  surfaceCache.set(kind,texture);
  return texture;
}

export function buildingMaterials(quality) {
  return Object.fromEntries(BUILDING_SURFACES.map((kind) => {
    const map = wallTexture(kind);
    return [kind,new THREE.MeshStandardMaterial({
      vertexColors: true, map, roughness: kind === "wood" ? .71 : .91,
      bumpMap: quality === "high" ? map : null, bumpScale: kind === "stone" ? .011 : kind === "plaster" ? .0018 : .005, // (plaster: a light touch, more read as crumpled paper from the game's camera)
    })];
  }));
}
