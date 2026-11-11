/**
 * The stage: a dark talk set, a curved LED wall playing the Kova screen, two lounge chairs and a
 * side table in front of it. Built in three.js so the shot is ours (no borrowed footage).
 *
 * Realism comes from light, not detail: the wall is the key light (an area light the size of the
 * screen, rim-lighting the chairs from behind), one soft overhead spot makes the pool the chairs
 * sit in and casts their shadows, the floor is dark polished concrete that reflects the wall
 * softly; the wall's spill along its foot is a soft additive glow. On top (in 2D, which renders
 * reliably here): a lens vignette and grain seeded by the frame.
 */
import { ContactShadows, MeshReflectorMaterial, RoundedBox, useTexture } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { ThreeCanvas } from '@remotion/three'
import { useMemo } from 'react'
import { AbsoluteFill, Easing, Html5Audio, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'

RectAreaLightUniformsLib.init()

const R = 9
const THETA = 1.6 // radians of arc
const H = (R * THETA) / 3 // the arc is 3x the height, like the 3000x1000 screen
const WALL_Y = 0.25
const GLOW = '#5E968C' // the wall's average colour, dimmed: the light it throws

/** The wall plays the screen, run about 23% below full so it glows like a real LED wall on
 * camera instead of reading as a flat graphic. It plays the screen (WallScreen.tsx) rendered as an image sequence, one image per frame. */
function Wall() {
  const frame = useCurrentFrame()
  const tex = useTexture(staticFile(`wall/frames/element-${String(frame).padStart(3, '0')}.jpeg`))
  const map = useMemo(() => {
    const t = tex.clone()
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = THREE.RepeatWrapping
    t.repeat.x = -1 // seen from inside the cylinder
    t.anisotropy = 8
    t.needsUpdate = true
    return t
  }, [tex])
  return (
    <mesh position={[0, H / 2 + WALL_Y, 0]} rotation={[0, Math.PI - THETA / 2, 0]}>
      <cylinderGeometry args={[R, R, H, 128, 1, true, 0, THETA]} />
      <meshBasicMaterial map={map} color="#c4c4c4" side={THREE.BackSide} toneMapped={false} fog={false} />
    </mesh>
  )
}

/** A dim flat panel beside the wall, like the posters either side of a stage. */
function SidePanel({ src }: { src: string }) {
  const tex = useTexture(staticFile(src))
  const map = useMemo(() => {
    const t = tex.clone()
    t.colorSpace = THREE.SRGBColorSpace
    t.repeat.set(0.42, 1)
    t.offset.set(0.29, 0)
    t.needsUpdate = true
    return t
  }, [tex])
  return (
    <mesh position={[6.9, 2.4, -5.0]} rotation={[0, -0.95, 0]}>
      <planeGeometry args={[1.9, 4.4]} />
      <meshBasicMaterial map={map} color="#4a625f" toneMapped={false} fog={false} />
    </mesh>
  )
}

/** A low lounge chair: upholstered seat and back on a thin dark steel frame. Front faces +z. */
function Chair({ position, rotation }: { position: [number, number, number]; rotation: number }) {
  const fabric = <meshStandardMaterial color="#1C2A29" roughness={0.92} metalness={0} />
  const steel = <meshStandardMaterial color="#141818" roughness={0.38} metalness={0.85} />
  const legs: [number, number][] = [
    [-0.24, 0.2],
    [0.24, 0.2],
    [-0.24, -0.2],
    [0.24, -0.2],
  ]
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <RoundedBox args={[0.6, 0.09, 0.56]} radius={0.04} smoothness={4} position={[0, 0.43, 0.02]} castShadow receiveShadow>
        {fabric}
      </RoundedBox>
      <RoundedBox args={[0.6, 0.44, 0.08]} radius={0.04} smoothness={4} position={[0, 0.7, -0.25]} rotation={[-0.2, 0, 0]} castShadow receiveShadow>
        {fabric}
      </RoundedBox>
      {legs.map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x * 1.06, 0.195, z * 1.08]} rotation={[z * 0.25, 0, -x * 0.25]} castShadow>
          <cylinderGeometry args={[0.012, 0.009, 0.4, 12]} />
          {steel}
        </mesh>
      ))}
      <mesh position={[0, 0.375, 0]} castShadow>
        <boxGeometry args={[0.52, 0.02, 0.46]} />
        {steel}
      </mesh>
    </group>
  )
}

/** A small round side table between them, with two cups. */
function Table({ position }: { position: [number, number, number] }) {
  const dark = <meshStandardMaterial color="#141818" roughness={0.4} metalness={0.85} />
  return (
    <group position={position}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.025, 48]} />
        <meshStandardMaterial color="#8E8B80" roughness={0.45} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, 0.5, 16]} />
        {dark}
      </mesh>
      <mesh position={[0, 0.008, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.16, 0.17, 0.016, 40]} />
        {dark}
      </mesh>
      {[
        [-0.08, 0.05],
        [0.09, -0.04],
      ].map(([x, z]) => (
        <mesh key={x} position={[x, 0.55, z]} castShadow>
          <cylinderGeometry args={[0.035, 0.03, 0.08, 24]} />
          <meshStandardMaterial color="#D9D5C6" roughness={0.3} />
        </mesh>
      ))}
    </group>
  )
}

/** One slow push in over the whole film, eased at both ends: the only camera move. */
function Drift() {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const k = Easing.inOut(Easing.sin)(frame / (durationInFrames - 1))
  return <Aim position={[-3.0 + 0.32 * k, 1.25 - 0.04 * k, 4.9 - 0.7 * k]} target={[0.45 + 0.1 * k, 1.85, -6.5]} />
}

/** Points the camera on every render, so the shot is a pure function of the frame. */
function Aim({ position, target }: { position: [number, number, number]; target: [number, number, number] }) {
  const camera = useThree((s) => s.camera)
  camera.position.set(...position)
  camera.lookAt(...target)
  camera.updateProjectionMatrix()
  return null
}

/** The overhead spot, aimed with a real target object so it renders the same every frame. */
function Spot() {
  const target = useMemo(() => {
    const o = new THREE.Object3D()
    o.position.set(-0.1, 0, -4.4)
    return o
  }, [])
  return (
    <>
      <primitive object={target} />
      <spotLight
        position={[0.4, 7.5, -2.6]}
        target={target}
        angle={0.42}
        penumbra={0.85}
        intensity={260}
        decay={2}
        color="#BFD9D2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-radius={6}
      />
    </>
  )
}

/** The wall as a light: an area light the size of the screen, just in front of it. */
function WallLight() {
  const light = useMemo(() => {
    const l = new THREE.RectAreaLight(GLOW, 2.6, R * THETA * 0.85, H)
    l.position.set(0, H / 2 + WALL_Y, -R + 0.6)
    l.lookAt(0, H / 2 + WALL_Y, 0)
    return l
  }, [])
  return <primitive object={light} />
}

/** The wall's light spilled on the floor: a soft additive glow, the way it reads on camera. */
function Pool({ position, scale, color, opacity }: { position: [number, number, number]; scale: [number, number]; color: string; opacity: number }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d') as CanvasRenderingContext2D
    const r = g.createRadialGradient(128, 128, 0, 128, 128, 128)
    r.addColorStop(0, 'rgba(255,255,255,1)')
    r.addColorStop(0.45, 'rgba(255,255,255,.4)')
    r.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = r
    g.fillRect(0, 0, 256, 256)
    return new THREE.CanvasTexture(c)
  }, [])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={position} scale={[scale[0], scale[1], 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={tex} color={color} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} fog={false} />
    </mesh>
  )
}

/** The wall's light caught in the air just in front of it: a faint additive veil, strongest low. */
function Haze() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 256
    const g = c.getContext('2d') as CanvasRenderingContext2D
    const l = g.createLinearGradient(0, 256, 0, 0)
    l.addColorStop(0, 'rgba(255,255,255,1)')
    l.addColorStop(0.5, 'rgba(255,255,255,.35)')
    l.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = l
    g.fillRect(0, 0, 64, 256)
    return new THREE.CanvasTexture(c)
  }, [])
  return (
    <mesh position={[0, 2.4, -6.2]}>
      <planeGeometry args={[18, 4.8]} />
      <meshBasicMaterial map={tex} color={GLOW} transparent opacity={0.07} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} fog={false} />
    </mesh>
  )
}

/** Film grain, seeded by the frame so every render is the same. */
function Grain() {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ mixBlendMode: 'overlay', opacity: 0.22, pointerEvents: 'none' }}>
      <svg width="100%" height="100%">
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={frame % 97} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  )
}

export function WallStage() {
  const { width, height } = useVideoConfig()
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <ThreeCanvas width={width} height={height} shadows gl={{ antialias: true, preserveDrawingBuffer: true }} camera={{ fov: 40, near: 0.1, far: 80 }}>
        <Drift />
        <color attach="background" args={['#000']} />
        <fog attach="fog" args={['#000', 12, 28]} />
        <ambientLight intensity={0.03} />
        <WallLight />
        <Spot />
        <Wall />
        <SidePanel src="wall/frames/element-359.jpeg" />
        <Chair position={[-1.05, 0, -4.35]} rotation={1.15} />
        <Chair position={[0.95, 0, -4.15]} rotation={-1.2} />
        <Table position={[-0.05, 0, -4.05]} />
        <Haze />
        <Pool position={[0, 0.006, -7.6]} scale={[17, 4.2]} color={GLOW} opacity={0.5} />
        <ContactShadows position={[0, 0.003, -4.2]} opacity={0.55} scale={6} blur={2.2} far={1.2} resolution={1024} color="#000" frames={1} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[60, 60]} />
          <MeshReflectorMaterial
            resolution={1024}
            blur={[300, 90]}
            mixBlur={1}
            mixStrength={2.4}
            roughness={0.75}
            depthScale={0.5}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.3}
            color="#1A2524"
            metalness={0.35}
            mirror={0.6}
          />
        </mesh>
      </ThreeCanvas>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 52% 48%, rgba(0,0,0,0) 45%, rgba(0,0,0,.62) 100%)' }} />
      <Grain />
      <Html5Audio src={staticFile('wall/score.wav')} />
    </AbsoluteFill>
  )
}
