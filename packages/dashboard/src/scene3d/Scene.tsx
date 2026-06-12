/**
 * Realtime 3D map. The chosen AP sits at the origin; devices are placed in the
 * local ENU frame estimated by the server. ENU (x=East, y=North, z=Up) is mapped
 * to Three.js (x=East, y=Up, z=South) so North points "into" the scene.
 */
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, Html, Line } from "@react-three/drei";
import type { CompassDirection, Vec3 } from "@ionity/metrification";

/** A live device track to render. */
export interface DeviceTrack {
  deviceId: string;
  position: Vec3;
  trail: Vec3[];
  distanceM: number;
  direction: CompassDirection;
  heightM: number;
  confidence: number;
}

/** Where the operator should place the device for the current calibration step. */
export interface CalibrationTarget {
  position: Vec3;
  label: string;
}

export interface SceneProps {
  devices: DeviceTrack[];
  calibrationPoints: Vec3[];
  target: CalibrationTarget | null;
}

function enu(v: Vec3): [number, number, number] {
  return [v.x, v.z, -v.y];
}

const DEVICE_COLORS = ["#22d3ee", "#a3e635", "#f472b6", "#fbbf24", "#818cf8"];

function colorFor(deviceId: string): string {
  let h = 0;
  for (const c of deviceId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return DEVICE_COLORS[h % DEVICE_COLORS.length]!;
}

function CompassLabels() {
  const r = 3.6;
  const winds: [CompassDirection, Vec3][] = [
    ["N", { x: 0, y: r, z: 0 }],
    ["E", { x: r, y: 0, z: 0 }],
    ["S", { x: 0, y: -r, z: 0 }],
    ["W", { x: -r, y: 0, z: 0 }],
  ];
  return (
    <>
      {winds.map(([dir, p]) => (
        <Html key={dir} position={enu(p)} center style={{ color: "#94a3b8", fontWeight: 700 }}>
          {dir}
        </Html>
      ))}
    </>
  );
}

export function Scene({ devices, calibrationPoints, target }: SceneProps) {
  return (
    <Canvas camera={{ position: [4, 4, 6], fov: 50 }} dpr={[1, 2]}>
      <color attach="background" args={["#0b1020"]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 5]} intensity={0.8} />

      <Grid
        args={[12, 12]}
        cellSize={0.5}
        cellColor="#1e293b"
        sectionSize={1}
        sectionColor="#334155"
        infiniteGrid
        fadeDistance={24}
        position={[0, 0, 0]}
      />

      {/* ENU axes from the AP origin */}
      <Line points={[enu({ x: 0, y: 0, z: 0 }), enu({ x: 3.5, y: 0, z: 0 })]} color="#ef4444" lineWidth={2} />
      <Line points={[enu({ x: 0, y: 0, z: 0 }), enu({ x: 0, y: 3.5, z: 0 })]} color="#22c55e" lineWidth={2} />
      <Line points={[enu({ x: 0, y: 0, z: 0 }), enu({ x: 0, y: 0, z: 1 })]} color="#3b82f6" lineWidth={2} />
      <CompassLabels />

      {/* AP at origin */}
      <mesh position={enu({ x: 0, y: 0, z: 0 })}>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshStandardMaterial color="#f8fafc" emissive="#475569" />
      </mesh>
      <Html position={enu({ x: 0, y: 0, z: 0.25 })} center style={{ color: "#e2e8f0", fontSize: 12 }}>
        AP
      </Html>

      {/* Completed calibration points */}
      {calibrationPoints.map((p, i) => (
        <mesh key={`cal-${i}`} position={enu(p)}>
          <boxGeometry args={[0.08, 0.08, 0.08]} />
          <meshStandardMaterial color="#64748b" />
        </mesh>
      ))}

      {/* Current calibration target (pulsing marker) */}
      {target && (
        <group position={enu(target.position)}>
          <mesh>
            <ringGeometry args={[0.18, 0.24, 32]} />
            <meshBasicMaterial color="#facc15" />
          </mesh>
          <Html center style={{ color: "#facc15", fontSize: 12, whiteSpace: "nowrap" }}>
            {target.label}
          </Html>
        </group>
      )}

      {/* Live devices + movement trails */}
      {devices.map((d) => {
        const color = colorFor(d.deviceId);
        return (
          <group key={d.deviceId}>
            {d.trail.length >= 2 && (
              <Line points={d.trail.map(enu)} color={color} lineWidth={1.5} transparent opacity={0.5} />
            )}
            <mesh position={enu(d.position)}>
              <sphereGeometry args={[0.1, 20, 20]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
            </mesh>
            <Html position={enu(d.position)} center style={{ color, fontSize: 11, whiteSpace: "nowrap" }}>
              <div style={{ transform: "translateY(-18px)" }}>
                {d.deviceId} · {d.distanceM.toFixed(2)}m {d.direction}
              </div>
            </Html>
          </group>
        );
      })}

      <OrbitControls makeDefault enableDamping />
    </Canvas>
  );
}
