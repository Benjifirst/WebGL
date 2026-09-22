// Orbit-Kamera um den Ursprung (y nach oben), gemeinsam für 3D-Darstellungen.
export type V3 = [number, number, number];

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Kamera auf einer Kugel (yaw um y, pitch über dem Äquator) mit Blick auf den Ursprung */
export function orbitCamera(yaw: number, pitch: number, distance: number) {
  const pos: V3 = [
    distance * Math.cos(pitch) * Math.sin(yaw),
    distance * Math.sin(pitch),
    distance * Math.cos(pitch) * Math.cos(yaw),
  ];
  const fwd = normalize([-pos[0], -pos[1], -pos[2]]);
  const right = normalize(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { u_camPos: pos, u_camFwd: fwd, u_camRight: right, u_camUp: up };
}
