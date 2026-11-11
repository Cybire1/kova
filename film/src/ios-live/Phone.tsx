import { Environment, Lightformer, RoundedBox, useTexture } from '@react-three/drei'
import { ThreeCanvas } from '@remotion/three'
import { useMemo } from 'react'
import { staticFile } from 'remotion'
import * as THREE from 'three'

function rounded(w: number, h: number, r: number) {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

function plate(w: number, h: number, r: number) {
  const g = new THREE.ShapeGeometry(rounded(w, h, r), 24)
  const p = g.getAttribute('position')
  const uv = g.getAttribute('uv')
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5)
  return g
}

function Device() {
  const original = useTexture(staticFile('private/sam/01-home-before.png'))
  const texture = useMemo(() => {
    const t = original.clone()
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 16
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
    return t
  }, [original])
  const body = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(rounded(2.40, 5.15, 0.38), {
      depth: 0.16, bevelEnabled: true, bevelSegments: 5,
      steps: 1, bevelSize: 0.035, bevelThickness: 0.035, curveSegments: 24,
    })
    g.translate(0, 0, -0.08)
    g.computeVertexNormals()
    return g
  }, [])
  const front = useMemo(() => plate(2.37, 5.12, 0.365), [])
  const display = useMemo(() => plate(2.26, 2.26 * 2556 / 1179, 0.30), [])
  const back = useMemo(() => plate(2.34, 5.09, 0.35), [])
  return (
    <group>
      <mesh geometry={body}>
        <meshStandardMaterial color="#a2a6a4" metalness={0.97} roughness={0.24} />
      </mesh>
      <mesh geometry={front} position={[0, 0, 0.118]}>
        <meshBasicMaterial color="#070b0c" toneMapped={false} />
      </mesh>
      <mesh geometry={display} position={[0, 0, 0.123]}>
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <mesh geometry={back} position={[0, 0, -0.119]} rotation={[0, Math.PI, 0]}>
        <meshStandardMaterial color="#252e2d" metalness={0.5} roughness={0.32} />
      </mesh>
      <RoundedBox args={[0.92, 0.98, 0.10]} radius={0.16} smoothness={5} position={[-0.58, 1.86, -0.17]}>
        <meshStandardMaterial color="#394442" metalness={0.75} roughness={0.23} />
      </RoundedBox>
      {[[-0.78, 2.10], [-0.36, 1.84], [-0.78, 1.59]].map(([x, y], i) => (
        <group key={i} position={[x, y, -0.24]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh><cylinderGeometry args={[0.18, 0.18, 0.05, 40]} /><meshStandardMaterial color="#76827f" metalness={1} roughness={0.17} /></mesh>
          <mesh position={[0, -0.028, 0]}><cylinderGeometry args={[0.145, 0.145, 0.008, 40]} /><meshPhysicalMaterial color="#07141a" metalness={0.5} roughness={0.1} clearcoat={1} /></mesh>
        </group>
      ))}
      {[[-1.224, 1.53, 0.18], [-1.224, 0.99, 0.35], [-1.224, 0.45, 0.35], [1.224, 0.96, 0.57]].map(([x, y, h], i) => (
        <RoundedBox key={i} args={[0.033, h, 0.082]} radius={0.014} smoothness={3} position={[x, y, 0]}>
          <meshStandardMaterial color="#b6bcb9" metalness={0.98} roughness={0.2} />
        </RoundedBox>
      ))}
      {[-2.1, 2.1].map((y) => (
        <group key={y}>
          <mesh position={[1.219, y, 0]}><boxGeometry args={[0.011, 0.033, 0.16]} /><meshStandardMaterial color="#303937" roughness={0.7} /></mesh>
          <mesh position={[-1.219, y, 0]}><boxGeometry args={[0.011, 0.033, 0.16]} /><meshStandardMaterial color="#303937" roughness={0.7} /></mesh>
        </group>
      ))}
    </group>
  )
}

export interface PhonePose {
  x: number; y: number; scale: number; rx: number; ry: number; rz: number
}

export function Phone({ pose }: { pose: PhonePose }) {
  return (
    <ThreeCanvas width={1920} height={1080} orthographic camera={{ position: [0, 0, 24], zoom: 168, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }} style={{ position: 'absolute', inset: 0 }}>
      <ambientLight intensity={0.65} />
      <directionalLight position={[-4, 8, 12]} intensity={3.5} color="#fff5e5" />
      <directionalLight position={[6, -1, 4]} intensity={2.5} color="#e2f5f0" />
      <directionalLight position={[-5, -2, -4]} intensity={3} color="#ed9c8b" />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={4} color="#fff5e5" scale={[4, 9, 1]} position={[-5, 3, 6]} rotation={[0, 0.5, 0]} />
        <Lightformer form="rect" intensity={3} color="#f5fbff" scale={[1, 10, 1]} position={[5, 1, 4]} rotation={[0, -0.6, 0]} />
        <Lightformer form="rect" intensity={2} color="#f0b29d" scale={[8, 2, 1]} position={[0, -6, 1]} rotation={[Math.PI / 3, 0, 0]} />
      </Environment>
      <group position={[pose.x, pose.y, 0]} scale={pose.scale} rotation={[pose.rx, pose.ry, pose.rz]}>
        <Device />
      </group>
    </ThreeCanvas>
  )
}
