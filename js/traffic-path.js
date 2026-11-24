// Visual wheel paths, in coordinates relative to the center of a road tile.
export const ISLAND_RADIUS = 0.26;
const CIRCULATION_RADIUS = 0.365;
const HALF_TILE = 0.5;
const LANE_SHIFT = 0.16;
const TURN_ARC = Math.PI * 2;
const laneCache = new Map();

function cubic(a,b,c,d,t) {
  const u = 1 - t;
  return a*u*u*u + b*3*u*u*t + c*3*u*t*t + d*t*t*t;
}

function trafficCurve(start, end, incoming, outgoing, pull) {
  return (t) => [
    cubic(start[0],start[0] + incoming[0]*pull,end[0] - outgoing[0]*pull,end[0],t),
    cubic(start[1],start[1] + incoming[1]*pull,end[1] - outgoing[1]*pull,end[1],t),
  ];
}

export function tileLane(ix, iz, ox, oz, roundabout = false) {
  const key = `${ix},${iz},${ox},${oz},${roundabout}`;
  if (laneCache.has(key)) return laneCache.get(key);
  const start = [-ix*HALF_TILE - iz*LANE_SHIFT, -iz*HALF_TILE + ix*LANE_SHIFT];
  const end = [ox*HALF_TILE - oz*LANE_SHIFT, oz*HALF_TILE + ox*LANE_SHIFT];
  const points = [];
  const append = (sample, count) => {
    for (let i = points.length ? 1 : 0; i <= count; i++) points.push(sample(i/count));
  };
  if (roundabout && (ix || iz) && (ox || oz)) {
    // In x/z map coordinates, decreasing angles circulate counterclockwise.
    const join = Math.atan2(start[1],start[0]) - 0.33;
    const leave = Math.atan2(end[1],end[0]) + 0.33;
    const arc = ((join - leave) % TURN_ARC + TURN_ARC) % TURN_ARC;
    const at = (a) => [Math.cos(a)*CIRCULATION_RADIUS, Math.sin(a)*CIRCULATION_RADIUS];
    const tangent = (a) => [Math.sin(a),-Math.cos(a)];
    append(trafficCurve(start,at(join),[ix,iz],tangent(join),0.082), 10);
    append((t) => at(join - t*arc), Math.max(4,Math.ceil(arc*12)));
    append(trafficCurve(at(leave),end,tangent(leave),[ox,oz],0.082), 10);
  } else {
    const pull = ix === ox && iz === oz ? 1/3 : 0.37;
    append(trafficCurve(start,end,[ix,iz],[ox,oz],pull), 24);
  }
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i-1], b = points[i];
    distances.push(distances[i-1] + Math.hypot(b[0]-a[0], b[1]-a[1]));
  }
  const lane = { points, distances, length: distances.at(-1) };
  laneCache.set(key, lane);
  return lane;
}

export function lanePosition(lane, progress, out) {
  const { points, distances, length } = lane;
  const distance = length*Math.min(1,Math.max(0,progress));
  let lo = 0, hi = distances.length-1;
  while (hi-lo > 1) {
    const mid = (lo+hi) >> 1;
    if (distances[mid] < distance) lo = mid;
    else hi = mid;
  }
  const a = points[lo], b = points[hi];
  const ratio = (distance-distances[lo])/(distances[hi]-distances[lo] || 1);
  out.x = a[0] + (b[0]-a[0])*ratio;
  out.z = a[1] + (b[1]-a[1])*ratio;
  out.dx = b[0]-a[0];
  out.dz = b[1]-a[1];
  return out;
}
