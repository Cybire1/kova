'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

/**
 * The basic phone in 3D (three.js): a dark handset with rounded edges, physical keys that press
 * in, and a lit LCD that draws Kova's real USSD screen (from components/ussd-demo.tsx). It tilts
 * toward the pointer and floats a little; with reduced motion it holds still. Clicking a key calls
 * back exactly as the flat phone's buttons do, so the keyboard and the flat fallback stay the same.
 */

export interface PhoneScreen {
  status: [string, string, string]
  lines: string[]
  input?: string | undefined
  hint?: string | undefined
  banner?: { title: string; text: string } | null
  dim?: boolean
}

export type PhoneKey = 'call' | 'back' | 'end' | string

const KEYS: [string, string][] = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
]

const LCD = { w: 640, h: 500 }

/** Draws the LCD: status bar, the screen's lines (wrapped), the answer being typed, a text arriving. */
function drawScreen(ctx: CanvasRenderingContext2D, s: PhoneScreen) {
  const { w, h } = LCD
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, s.dim ? '#aab3a0' : '#d6e3c6')
  g.addColorStop(1, s.dim ? '#9aa391' : '#c3d1b2')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // Faint pixel grid, as on a real LCD.
  ctx.fillStyle = 'rgba(28,42,26,0.035)'
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1)
  const ink = '#1c2a1a'
  ctx.fillStyle = ink
  ctx.textBaseline = 'top'
  ctx.font = 'bold 26px ui-monospace, Menlo, monospace'
  ctx.fillText(s.status[0], 22, 16)
  const mid = ctx.measureText(s.status[1]).width
  ctx.fillText(s.status[1], (w - mid) / 2, 16)
  const right = ctx.measureText(s.status[2]).width
  ctx.fillText(s.status[2], w - 22 - right, 16)
  ctx.fillRect(18, 54, w - 36, 2)

  ctx.font = '30px ui-monospace, Menlo, monospace'
  const max = w - 48
  let y = 74
  const wrap = (line: string) => {
    const words = line.split(' ')
    let current = ''
    const out: string[] = []
    for (const word of words) {
      const next = current ? `${current} ${word}` : word
      if (ctx.measureText(next).width > max && current) {
        out.push(current)
        current = word
      } else current = next
    }
    out.push(current)
    return out
  }
  for (const line of s.lines.flatMap((l) => (l === '' ? [''] : wrap(l)))) {
    if (y > h - 120) break
    ctx.fillText(line, 24, y)
    y += 38
  }
  if (s.input !== undefined) {
    ctx.strokeStyle = 'rgba(28,42,26,0.6)'
    ctx.lineWidth = 2
    ctx.strokeRect(22, y + 6, w - 44, 46)
    ctx.font = 'bold 30px ui-monospace, Menlo, monospace'
    ctx.fillText(s.input || '_', 34, y + 14)
  }
  if (s.hint) {
    ctx.font = '22px ui-monospace, Menlo, monospace'
    ctx.globalAlpha = 0.7
    ctx.fillText(s.hint, 24, h - 44)
    ctx.globalAlpha = 1
  }
  if (s.banner) {
    ctx.fillStyle = '#1c2a1a'
    const bh = 112
    ctx.beginPath()
    ctx.roundRect(14, h - bh - 14, w - 28, bh, 14)
    ctx.fill()
    ctx.fillStyle = '#d6e3c6'
    ctx.font = 'bold 22px ui-monospace, Menlo, monospace'
    ctx.fillText(s.banner.title, 30, h - bh + 2)
    ctx.font = '22px ui-monospace, Menlo, monospace'
    const text = s.banner.text.length > 84 ? `${s.banner.text.slice(0, 82)}…` : s.banner.text
    const half = text.length > 42 ? text.lastIndexOf(' ', 42) : -1
    ctx.fillText(half > 0 ? text.slice(0, half) : text, 30, h - bh + 34)
    if (half > 0) ctx.fillText(text.slice(half + 1), 30, h - bh + 62)
  }
}

function keyLabel(main: string, letters: string, color = '#f1efea') {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 160
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `bold ${letters ? 76 : 88}px Manrope, ui-sans-serif, system-ui, sans-serif`
  ctx.fillText(main, 128, letters ? 66 : 82)
  if (letters) {
    ctx.globalAlpha = 0.6
    ctx.font = 'bold 30px Manrope, ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(letters, 128, 128)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

export function Phone3D({
  screen,
  onKey,
  onFail,
  flash,
}: {
  screen: PhoneScreen
  onKey: (key: PhoneKey) => void
  onFail: () => void
  /** A key pressed on the keyboard: its 3D key presses in too. */
  flash?: { id: string; at: number } | null
}) {
  const host = useRef<HTMLDivElement>(null)
  const capsRef = useRef<THREE.Mesh[]>([])
  const draw = useRef<((s: PhoneScreen) => void) | null>(null)
  const latest = useRef(screen)
  const keyRef = useRef(onKey)
  keyRef.current = onKey

  useEffect(() => {
    latest.current = screen
    draw.current?.(screen)
  }, [screen])

  useEffect(() => {
    if (!flash) return
    const cap = capsRef.current.find((c) => c.userData.id === flash.id)
    if (cap) cap.userData.pressedAt = performance.now()
  }, [flash])

  useEffect(() => {
    const el = host.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      })
    } catch {
      onFail()
      return
    }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.92
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.55
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
    camera.position.set(0, 0.05, 9.4)

    scene.add(new THREE.AmbientLight(0xffffff, 0.35))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(3, 4, 6)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x9fd0d0, 0.8)
    rim.position.set(-4, 2, -3)
    scene.add(rim)

    const disposables: { dispose: () => void }[] = [pmrem, env]
    const track = <T extends { dispose: () => void }>(x: T) => {
      disposables.push(x)
      return x
    }

    const phone = new THREE.Group()
    scene.add(phone)

    // The handset: a soft-cornered body, a slightly lighter face, a speaker slot.
    const body = new THREE.Mesh(
      track(new RoundedBoxGeometry(2.1, 4.2, 0.42, 8, 0.32)),
      track(
        new THREE.MeshPhysicalMaterial({
          color: 0x0e1416,
          roughness: 0.38,
          metalness: 0.3,
          clearcoat: 0.8,
          clearcoatRoughness: 0.3,
        }),
      ),
    )
    phone.add(body)
    const face = new THREE.Mesh(
      track(new RoundedBoxGeometry(1.92, 4.0, 0.02, 4, 0.26)),
      track(new THREE.MeshPhysicalMaterial({ color: 0x151c1e, roughness: 0.6, metalness: 0.1 })),
    )
    face.position.z = 0.215
    phone.add(face)
    const speaker = new THREE.Mesh(
      track(new RoundedBoxGeometry(0.5, 0.06, 0.02, 2, 0.03)),
      track(new THREE.MeshBasicMaterial({ color: 0x080c0d })),
    )
    speaker.position.set(0, 1.86, 0.23)
    phone.add(speaker)

    // The LCD: a canvas texture of the real screen, under a thin glass with reflections.
    const canvas = document.createElement('canvas')
    canvas.width = LCD.w
    canvas.height = LCD.h
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    const lcdTexture = track(new THREE.CanvasTexture(canvas))
    lcdTexture.colorSpace = THREE.SRGBColorSpace
    lcdTexture.anisotropy = 8
    const lcd = new THREE.Mesh(
      track(new THREE.PlaneGeometry(1.62, 1.27)),
      track(new THREE.MeshBasicMaterial({ map: lcdTexture, toneMapped: false })),
    )
    lcd.position.set(0, 0.98, 0.229)
    phone.add(lcd)
    const glass = new THREE.Mesh(
      track(new RoundedBoxGeometry(1.74, 1.4, 0.02, 3, 0.06)),
      track(
        new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.08,
          roughness: 0.05,
          metalness: 0,
          clearcoat: 1,
        }),
      ),
    )
    glass.position.set(0, 0.98, 0.236)
    phone.add(glass)
    draw.current = (s) => {
      drawScreen(ctx, s)
      lcdTexture.needsUpdate = true
    }
    draw.current(latest.current)

    // The keys: rounded caps that press in, each carrying its label.
    const keys: THREE.Mesh[] = []
    const addKey = (
      id: string,
      x: number,
      y: number,
      w: number,
      h: number,
      color: number,
      label: THREE.Texture | null,
    ) => {
      const cap = new THREE.Mesh(
        track(new RoundedBoxGeometry(w, h, 0.14, 4, Math.min(w, h) * 0.32)),
        track(
          new THREE.MeshPhysicalMaterial({
            color,
            roughness: 0.38,
            metalness: 0.05,
            clearcoat: 0.5,
          }),
        ),
      )
      cap.position.set(x, y, 0.27)
      cap.userData = { id, rest: 0.27, pressedAt: -1 }
      if (label) {
        const plate = new THREE.Mesh(
          track(new THREE.PlaneGeometry(w * 0.9, h * 0.86)),
          track(
            new THREE.MeshBasicMaterial({
              map: track(label),
              transparent: true,
              toneMapped: false,
            }),
          ),
        )
        plate.position.z = 0.072
        cap.add(plate)
      }
      phone.add(cap)
      keys.push(cap)
    }
    capsRef.current = keys
    addKey('call', -0.6, 0.05, 0.62, 0.3, 0x2e8b57, keyLabel('✓', ''))
    addKey('back', 0, 0.05, 0.36, 0.3, 0x3a4447, keyLabel('C', ''))
    addKey('end', 0.6, 0.05, 0.62, 0.3, 0xc2453a, keyLabel('✕', ''))
    KEYS.forEach(([k, letters], i) => {
      const col = i % 3
      const row = Math.floor(i / 3)
      addKey(k, (col - 1) * 0.6, -0.44 - row * 0.41, 0.52, 0.33, 0x222b2e, keyLabel(k, letters))
    })

    // A soft shadow on the floor beneath it.
    const shadowCanvas = document.createElement('canvas')
    shadowCanvas.width = 256
    shadowCanvas.height = 256
    const sctx = shadowCanvas.getContext('2d') as CanvasRenderingContext2D
    const rg = sctx.createRadialGradient(128, 128, 10, 128, 128, 128)
    rg.addColorStop(0, 'rgba(0,0,0,0.45)')
    rg.addColorStop(1, 'rgba(0,0,0,0)')
    sctx.fillStyle = rg
    sctx.fillRect(0, 0, 256, 256)
    const shadow = new THREE.Mesh(
      track(new THREE.PlaneGeometry(3.2, 1.1)),
      track(
        new THREE.MeshBasicMaterial({
          map: track(new THREE.CanvasTexture(shadowCanvas)),
          transparent: true,
          depthWrite: false,
        }),
      ),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = -2.55
    scene.add(shadow)

    // Size to the box it sits in.
    const resize = () => {
      const width = el.clientWidth
      const height = el.clientHeight
      renderer.setSize(width, height, false)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(el)

    // Pointer: tilt toward it, light the key under it, press what's clicked.
    const pointer = new THREE.Vector2(0, 0)
    const target = { x: 0, y: 0 }
    const ray = new THREE.Raycaster()
    let hovered: THREE.Object3D | null = null
    const pick = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      ray.setFromCamera(pointer, camera)
      return ray.intersectObjects(keys, true)[0]?.object ?? null
    }
    const capOf = (o: THREE.Object3D | null) =>
      o && keys.includes(o as THREE.Mesh) ? o : (o?.parent ?? null)
    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      target.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2
      target.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2
      hovered = capOf(pick(event))
      renderer.domElement.style.cursor = hovered ? 'pointer' : 'default'
    }
    const onDown = (event: PointerEvent) => {
      const cap = capOf(pick(event))
      if (!cap) return
      cap.userData.pressedAt = performance.now()
      keyRef.current(cap.userData.id as string)
    }
    const onLeave = () => {
      target.x = 0
      target.y = 0
      hovered = null
    }
    window.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerleave', onLeave)

    let frame = 0
    const clock = new THREE.Clock()
    const loop = () => {
      frame = requestAnimationFrame(loop)
      const t = clock.getElapsedTime()
      const now = performance.now()
      if (!still) {
        phone.rotation.y += (target.x * 0.32 - phone.rotation.y) * 0.08
        phone.rotation.x += (target.y * 0.16 - phone.rotation.x) * 0.08
        phone.position.y = Math.sin(t * 1.2) * 0.05
      }
      shadow.scale.setScalar(1 - phone.position.y * 0.6)
      for (const cap of keys) {
        const since = now - (cap.userData.pressedAt as number)
        const press = since >= 0 && since < 160 ? Math.sin((since / 160) * Math.PI) : 0
        cap.position.z =
          (cap.userData.rest as number) - press * 0.06 + (cap === hovered ? 0.012 : 0)
      }
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerleave', onLeave)
      draw.current = null
      for (const d of disposables) d.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [onFail])

  return (
    <div
      ref={host}
      className="ud-3d"
      role="img"
      aria-label="A basic phone. Use its keys, or your keyboard."
    />
  )
}
