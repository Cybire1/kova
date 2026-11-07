'use client'

import { useEffect } from 'react'
import { THEME_KEY } from '@/lib/theme'

/** What each gallery card's + opens: three plain points, and a note where one is owed. */
const DETAILS: Record<string, { title: string; points: string[]; note?: string }> = {
  private: {
    title: 'Pay privately. Only they can see it.',
    points: [
      'Every private payment goes to a brand-new address that only the receiver can open.',
      'Add a note. It’s sealed, so only the two of you can read it.',
      'Spend it privately too: pay shops and send straight from your private dollars.',
    ],
  },
  offline: {
    title: 'No signal? You still get paid.',
    points: [
      'Kova signs the payment on your phone and shows it as a code.',
      'The other phone scans it. It settles as soon as either phone is back online.',
      'Each code pays once, however many times it’s shown.',
    ],
  },
  agents: {
    title: 'Give an AI agent a budget, not your wallet.',
    points: [
      'Make a key for Claude or any AI agent, with a daily limit you choose.',
      'The limit is enforced on Monad, so the key can’t spend a cent more.',
      'Allowances and teammates work the same way. Freeze any key in a tap.',
    ],
  },
  stocks: {
    title: 'Own a slice of Tesla.',
    points: [
      'Buy tokenized stocks and funds on Monad: Tesla, Nvidia, the S&P 500, gold and more.',
      'Start with a fraction of a share.',
      'They sit next to your dollars, and you can sell back to dollars in the app.',
    ],
    note: 'Stocks can lose value. Kova doesn’t give investment advice.',
  },
  cashout: {
    title: 'Cash out to your bank, in your currency.',
    points: [
      'Send dollars to a bank or mobile money account in 17 currencies.',
      'Naira lands in seconds.',
      'You see the rate and any fee before you confirm.',
    ],
  },
  send: {
    title: 'Send to a friend in a second.',
    points: [
      'Type a name or scan their code, then confirm with Face ID.',
      'It lands in about a second, any time of day.',
      'Kova pays the network fee, so they get every cent.',
    ],
  },
}

type Look = 'system' | 'light' | 'dark'

/**
 * Everything on the home page that moves or answers a tap: the floating nav and its menus, the
 * hero's load-in and parallax, the gallery (arrows, drag, progress, detail sheet), the tabs, the
 * key switches, reveal-on-scroll and the Light / Auto / Dark choice. The markup is rendered on the
 * server (app/page.tsx); this only wires it up, and takes it all down again on unmount.
 */
export function HomeMotion() {
  useEffect(() => {
    const root = document.getElementById('kl')
    if (!root) return
    const ac = new AbortController()
    const signal = ac.signal
    const timers: number[] = []
    const observers: IntersectionObserver[] = []
    const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
      document.getElementById(id) as T | null
    const all = <T extends Element = HTMLElement>(sel: string) =>
      Array.from(root.querySelectorAll<T>(sel) as NodeListOf<T>)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const hover = window.matchMedia('(hover:hover)').matches
    const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
    /** A grid's chips come in one after another; once they're in, hovers answer at once. */
    const cascade = (grid: HTMLElement) => {
      grid.classList.remove('in', 'done')
      void grid.offsetWidth
      grid.classList.add('in')
      timers.push(window.setTimeout(() => grid.classList.add('done'), 1300))
    }

    // Headlines rise out of a mask, word by word: each word (and the odd inline picture) gets
    // its own clipped span, numbered for the stagger. Line breaks and inline spans are kept.
    const splitWords = (el: HTMLElement) => {
      if (el.dataset.split) return
      el.dataset.split = '1'
      let n = 0
      const masked = (content: Node) => {
        const w = document.createElement('span')
        w.className = 'w'
        const inner = document.createElement('span')
        inner.style.setProperty('--wi', String(n++))
        inner.append(content)
        w.append(inner)
        return w
      }
      const walk = (node: Node) => {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            const frag = document.createDocumentFragment()
            for (const part of (child.textContent ?? '').split(/(\s+)/)) {
              if (!part) continue
              frag.append(/^\s+$/.test(part) ? part : masked(document.createTextNode(part)))
            }
            child.replaceWith(frag)
          } else if (child instanceof HTMLElement && child.tagName !== 'BR') {
            if (child.tagName === 'IMG') {
              const holder = document.createComment('')
              child.replaceWith(holder)
              holder.replaceWith(masked(child))
            } else walk(child)
          }
        }
      }
      walk(el)
      el.classList.add('wsplit')
    }
    if (!reduce) {
      for (const h of all('h2')) if (!h.closest('.gc,.gd')) splitWords(h)
      const h1 = root.querySelector<HTMLElement>('.hero h1, .ad-copy h1')
      if (h1) {
        splitWords(h1)
        timers.push(window.setTimeout(() => h1.classList.add('in'), 90))
      }
    }

    // Load-in
    timers.push(window.setTimeout(() => root.classList.add('loaded'), 60))

    // Theme: the same choice as the wallet's
    const setLook = (look: Look) => {
      if (look === 'system') delete root.dataset.look
      else root.dataset.look = look
      for (const b of all('[data-t]')) b.setAttribute('aria-pressed', String(b.dataset.t === look))
    }
    try {
      const saved = localStorage.getItem(THEME_KEY)
      if (saved === 'light' || saved === 'dark') setLook(saved)
    } catch {
      // Private browsing: follow the phone.
    }
    for (const b of all('[data-t]'))
      b.addEventListener(
        'click',
        () => {
          const look = b.dataset.t as Look
          setLook(look)
          try {
            localStorage.setItem(THEME_KEY, look)
          } catch {
            // Lasts until the page closes.
          }
        },
        { signal },
      )

    // Nav: one glass bar after the hero; hides on the way down, back on the way up
    const nav = $('nav')
    const stage = $('stageIn')
    const pars = all('[data-par]')
    const prog = root.querySelector<HTMLElement>('.kprog')
    const band = root.querySelector<HTMLElement>('.dark')
    let lastY = 0
    let ticking = false
    const onScroll = () => {
      const y = window.scrollY
      if (nav) {
        nav.classList.toggle('island', y > 40)
        if (!root.classList.contains('menu-open'))
          nav.classList.toggle(
            'hide',
            y > 500 && y > lastY + 2 && !root.querySelector('.drop.open'),
          )
        if (y < lastY - 2) nav.classList.remove('hide')
      }
      lastY = y
      const h = window.innerHeight
      const docH = document.documentElement.scrollHeight - h
      prog?.style.setProperty('--page', String(docH > 0 ? clamp01(y / docH) : 0))
      if (stage) {
        const r = stage.getBoundingClientRect()
        if (r.bottom > 0 && r.top < h) {
          stage.style.setProperty(
            '--sy',
            `${Math.max(-90, Math.min(0, (r.top - h * 0.55) * 0.22))}px`,
          )
        }
      }
      if (band && !reduce) {
        const r = band.getBoundingClientRect()
        if (r.top < h * 1.2 && r.bottom > 0)
          band.style.setProperty('--bp', String(clamp01(1 - (r.top - h * 0.15) / (h * 0.75))))
      }
      for (const p of pars) {
        const b = p.getBoundingClientRect()
        if (b.bottom > 0 && b.top < h)
          p.style.setProperty('--vy', `${(b.top + b.height / 2 - h / 2) * -0.06}px`)
      }
      ticking = false
    }
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true
          requestAnimationFrame(onScroll)
        }
      },
      { passive: true, signal },
    )
    onScroll()

    // Hero art leans a little toward the pointer
    const art = all('.art-desk .a')
    if (hover && !reduce)
      window.addEventListener(
        'pointermove',
        (e) => {
          const dx = e.clientX / window.innerWidth - 0.5
          const dy = e.clientY / window.innerHeight - 0.5
          art.forEach((a, i) => {
            const d = 8 + (i % 4) * 6
            a.style.setProperty('--px', `${dx * d}px`)
            a.style.setProperty('--py', `${dy * d}px`)
          })
        },
        { passive: true, signal },
      )

    // Menus
    const triggers = all('[data-drop]')
    let shut = 0
    const dropOf = (t: HTMLElement) => $(t.dataset.drop ?? '')
    const closeDrops = (keep?: HTMLElement) => {
      for (const t of triggers) {
        if (t === keep) continue
        t.setAttribute('aria-expanded', 'false')
        dropOf(t)?.classList.remove('open')
      }
    }
    const openDrop = (t: HTMLElement) => {
      window.clearTimeout(shut)
      closeDrops(t)
      const d = dropOf(t)
      if (!d) return
      d.style.setProperty('--dx', '0px')
      const w = d.offsetWidth
      const c = t.getBoundingClientRect()
      const left = c.left + c.width / 2 - w / 2
      const max = document.documentElement.clientWidth - 16
      d.style.setProperty(
        '--dx',
        `${left < 16 ? 16 - left : left + w > max ? max - left - w : 0}px`,
      )
      t.setAttribute('aria-expanded', 'true')
      d.classList.add('open')
    }
    for (const t of triggers) {
      const box = t.parentElement
      t.addEventListener(
        'click',
        () => (t.getAttribute('aria-expanded') === 'true' ? closeDrops() : openDrop(t)),
        { signal },
      )
      if (hover && box) {
        box.addEventListener('mouseenter', () => openDrop(t), { signal })
        box.addEventListener(
          'mouseleave',
          () => {
            shut = window.setTimeout(() => closeDrops(), 180)
          },
          { signal },
        )
      }
      for (const a of box?.querySelectorAll('.drop a') ?? [])
        a.addEventListener('click', () => closeDrops(), { signal })
    }

    // Phone menu
    const menuBtn = $('menuBtn')
    const setMenu = (open: boolean) => {
      root.classList.toggle('menu-open', open)
      menuBtn?.setAttribute('aria-expanded', String(open))
      if (open) nav?.classList.remove('hide')
    }
    menuBtn?.addEventListener('click', () => setMenu(!root.classList.contains('menu-open')), {
      signal,
    })
    for (const a of all('[data-close]'))
      a.addEventListener('click', () => setMenu(false), { signal })
    document.addEventListener(
      'click',
      (e) => {
        if (!(e.target as Element).closest('.kpill')) closeDrops()
      },
      { signal },
    )
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape') {
          closeDrops()
          setMenu(false)
        }
      },
      { signal },
    )

    // Key switches
    for (const s of all('.sw'))
      s.addEventListener(
        'click',
        () => {
          const on = s.getAttribute('aria-pressed') !== 'true'
          s.setAttribute('aria-pressed', String(on))
          s.closest('.kw')?.classList.toggle('off', !on)
        },
        { signal },
      )

    // Places: tabs, and on phones the first eight until asked for all
    const countries = $('countries')
    const networks = $('networks')
    const placesMore = $('placesMore')
    const placesNote = $('placesNote')
    placesMore?.addEventListener(
      'click',
      () => {
        countries?.classList.add('all')
        networks?.classList.add('all')
        placesMore.style.display = 'none'
      },
      { signal },
    )
    const tabs = all('.tab')
    for (const t of tabs)
      t.addEventListener(
        'click',
        () => {
          const pane = t.dataset.pane
          for (const x of tabs) x.setAttribute('aria-selected', String(x === t))
          if (countries) countries.hidden = pane !== 'countries'
          if (networks) networks.hidden = pane !== 'networks'
          const shown = pane === 'countries' ? countries : networks
          if (shown) cascade(shown)
          const label = placesMore?.querySelector('span')
          if (label) label.textContent = pane === 'countries' ? 'Show all 18' : 'Show all 20'
          if (placesNote)
            placesNote.textContent =
              pane === 'countries'
                ? 'Rates and any fees are shown before you confirm.'
                : 'Arrives as USDC in about 2 minutes. No gas needed on either side.'
        },
        { signal },
      )

    // Code tabs
    const codeTabs = all('.ct')
    for (const t of codeTabs)
      t.addEventListener(
        'click',
        () => {
          for (const x of codeTabs) x.setAttribute('aria-selected', String(x === t))
          for (const p of all('[data-c]')) p.hidden = p.dataset.c !== t.dataset.code
        },
        { signal },
      )

    // Gallery
    const rail = $('rail')
    const prev = $<HTMLButtonElement>('prev')
    const next = $<HTMLButtonElement>('next')
    const bar = $('progBar')
    const cards = rail ? Array.from(rail.querySelectorAll<HTMLElement>('.gc')) : []
    if (rail && prev && next && bar && cards.length) {
      const step = () =>
        (cards[0]?.offsetWidth ?? 0) + (Number.parseFloat(getComputedStyle(rail).columnGap) || 20)
      prev.addEventListener('click', () => rail.scrollBy({ left: -step(), behavior: 'smooth' }), {
        signal,
      })
      next.addEventListener('click', () => rail.scrollBy({ left: step(), behavior: 'smooth' }), {
        signal,
      })
      let railTick = false
      const railFrame = () => {
        const max = rail.scrollWidth - rail.clientWidth
        const f = max > 0 ? rail.scrollLeft / max : 0
        const vis = rail.clientWidth / rail.scrollWidth
        bar.style.setProperty('--pw', `${Math.max(18, vis * 100)}%`)
        bar.style.setProperty('--px', `${f * (100 / Math.max(0.18, vis) - 100)}%`)
        prev.disabled = rail.scrollLeft < 8
        next.disabled = rail.scrollLeft > max - 8
        const mid = window.innerWidth / 2
        for (const c of cards) {
          const r = c.getBoundingClientRect()
          c.querySelector<HTMLElement>('.vis')?.style.setProperty(
            '--shift',
            `${((r.left + r.width / 2 - mid) / window.innerWidth) * -36}px`,
          )
        }
        railTick = false
      }
      rail.addEventListener(
        'scroll',
        () => {
          if (!railTick) {
            railTick = true
            requestAnimationFrame(railFrame)
          }
        },
        { passive: true, signal },
      )
      window.addEventListener('resize', railFrame, { signal })
      railFrame()

      // Drag with a mouse; a drag never counts as a click
      let down = false
      let moved = false
      let sx = 0
      let sl = 0
      rail.addEventListener(
        'pointerdown',
        (e) => {
          if (e.pointerType !== 'mouse' || e.button !== 0) return
          down = true
          moved = false
          sx = e.clientX
          sl = rail.scrollLeft
        },
        { signal },
      )
      window.addEventListener(
        'pointermove',
        (e) => {
          if (!down) return
          const dx = e.clientX - sx
          if (Math.abs(dx) > 5) {
            moved = true
            rail.classList.add('dragging')
          }
          if (moved) rail.scrollLeft = sl - dx
        },
        { signal },
      )
      window.addEventListener(
        'pointerup',
        () => {
          if (!down) return
          down = false
          if (moved) {
            const w = step()
            rail.classList.remove('dragging')
            rail.scrollTo({ left: Math.round(rail.scrollLeft / w) * w, behavior: 'smooth' })
          }
        },
        { signal },
      )
      rail.addEventListener(
        'click',
        (e) => {
          if (moved) {
            e.preventDefault()
            e.stopPropagation()
            moved = false
          }
        },
        { capture: true, signal },
      )

      // Each card leans toward the pointer, with a sheen where it is
      if (hover && !reduce)
        for (const c of cards) {
          c.addEventListener(
            'pointermove',
            (e) => {
              if (rail.classList.contains('dragging') || !c.classList.contains('in')) return
              const r = c.getBoundingClientRect()
              const px = (e.clientX - r.left) / r.width
              const py = (e.clientY - r.top) / r.height
              c.style.setProperty('--ry', `${(px - 0.5) * 9}deg`)
              c.style.setProperty('--rx', `${(0.5 - py) * 7}deg`)
              c.style.setProperty('--gx', `${px * 100}%`)
              c.style.setProperty('--gy', `${py * 100}%`)
              c.classList.add('tilt')
            },
            { signal },
          )
          c.addEventListener(
            'pointerleave',
            () => {
              c.classList.remove('tilt')
              c.style.setProperty('--rx', '0deg')
              c.style.setProperty('--ry', '0deg')
            },
            { signal },
          )
        }

      // Cards slide in one after another
      const gio = new IntersectionObserver(
        ([e]) => {
          if (!e?.isIntersecting) return
          cards.forEach((c, i) => {
            timers.push(window.setTimeout(() => c.classList.add('in'), Math.min(i, 5) * 90))
          })
          gio.disconnect()
        },
        { threshold: 0.2 },
      )
      gio.observe(rail)
      observers.push(gio)

      // The detail sheet
      const gd = $<HTMLDialogElement>('gd')
      const gdEb = $('gdEb')
      const gdTitle = $('gdTitle')
      const gdPts = $('gdPts')
      const gdNote = $('gdNote')
      if (gd && gdEb && gdTitle && gdPts && gdNote) {
        for (const c of cards)
          c.querySelector('.plus')?.addEventListener(
            'click',
            (e) => {
              e.stopPropagation()
              const d = DETAILS[c.dataset.g ?? '']
              if (!d) return
              const light = c.classList.contains('light')
              gd.style.setProperty('--c', c.style.getPropertyValue('--c'))
              gd.style.setProperty('--c-solid', c.style.getPropertyValue('--c-solid'))
              gd.style.setProperty('--fg', light ? '#0B1A1D' : '#fff')
              gd.style.setProperty('--fg2', light ? 'rgba(11,26,29,.66)' : 'rgba(255,255,255,.72)')
              gd.classList.toggle('light', light)
              const eb = c.querySelector('.eb')
              gdEb.replaceChildren(
                ...Array.from(eb?.childNodes ?? []).map((n) => n.cloneNode(true)),
              )
              gdTitle.textContent = d.title
              gdPts.replaceChildren(
                ...d.points.map((text, i) => {
                  const li = document.createElement('li')
                  const n = document.createElement('span')
                  n.className = 'n'
                  n.textContent = String(i + 1)
                  const t = document.createElement('span')
                  t.textContent = text
                  li.append(n, t)
                  return li
                }),
              )
              gdNote.textContent = d.note ?? ''
              gd.showModal()
            },
            { signal },
          )
        $('gdX')?.addEventListener('click', () => gd.close(), { signal })
        gd.addEventListener(
          'click',
          (e) => {
            if (e.target === gd) gd.close()
          },
          { signal },
        )
        let startY: number | null = null
        gd.addEventListener(
          'touchstart',
          (e) => {
            startY = gd.scrollTop <= 0 ? (e.touches[0]?.clientY ?? null) : null
          },
          { passive: true, signal },
        )
        gd.addEventListener(
          'touchmove',
          (e) => {
            const y = e.touches[0]?.clientY
            if (startY !== null && y !== undefined && y - startY > 90) {
              startY = null
              gd.close()
            }
          },
          { passive: true, signal },
        )
      }
    }

    // Reveal on scroll; a grid of places cascades in, then answers hovers at once
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          if (e.target.classList.contains('places')) cascade(e.target as HTMLElement)
          else e.target.classList.add('in')
          io.unobserve(e.target)
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.06 },
    )
    for (const el of all('.rv,.s-visual,.wsplit,.places')) io.observe(el)
    observers.push(io)

    // Buttons lean toward the pointer, a few pixels at most
    if (hover && !reduce)
      for (const el of all('.btn.b-ink, .btn.b-light, .btn.b-coral, .kstore, .arr')) {
        el.addEventListener(
          'pointermove',
          (e) => {
            const r = el.getBoundingClientRect()
            const dx = e.clientX - (r.left + r.width / 2)
            const dy = e.clientY - (r.top + r.height / 2)
            el.style.setProperty('--mx', `${Math.max(-8, Math.min(8, dx * 0.18))}px`)
            el.style.setProperty('--my', `${Math.max(-6, Math.min(6, dy * 0.3))}px`)
          },
          { signal },
        )
        el.addEventListener(
          'pointerleave',
          () => {
            el.style.setProperty('--mx', '0px')
            el.style.setProperty('--my', '0px')
          },
          { signal },
        )
      }

    // Nav: one highlight slides to whatever you point at, and stays on an open menu
    const pill = root.querySelector<HTMLElement>('.kpill')
    const ind = pill?.querySelector<HTMLElement>('.pl-ind')
    if (pill && ind && hover) {
      const moveTo = (el: HTMLElement) => {
        const pr = pill.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        const first = !pill.classList.contains('ind')
        if (first) ind.style.transition = 'none'
        ind.style.setProperty('--ix', `${r.left - pr.left}px`)
        ind.style.setProperty('--iy', `${r.top - pr.top}px`)
        ind.style.setProperty('--iw', `${r.width}px`)
        if (first) {
          void ind.offsetWidth
          ind.style.transition = ''
        }
        pill.classList.add('ind')
      }
      for (const pl of Array.from(pill.querySelectorAll<HTMLElement>('.pl')))
        pl.addEventListener('pointerenter', () => moveTo(pl), { signal })
      pill.addEventListener(
        'pointerleave',
        () => {
          timers.push(
            window.setTimeout(() => {
              if (pill.matches(':hover')) return
              const open = pill.querySelector<HTMLElement>('.pl[aria-expanded="true"]')
              if (open) moveTo(open)
              else pill.classList.remove('ind')
            }, 230),
          )
        },
        { signal },
      )
    }

    // Business: a soft glow follows the pointer across the dark block
    const spot = band?.querySelector<HTMLElement>('.spot')
    if (band && spot && hover && !reduce) {
      band.addEventListener(
        'pointermove',
        (e) => {
          const r = band.getBoundingClientRect()
          spot.style.setProperty('--lx', `${e.clientX - r.left}px`)
          spot.style.setProperty('--ly', `${e.clientY - r.top}px`)
          band.classList.add('lit')
        },
        { passive: true, signal },
      )
      band.addEventListener('pointerleave', () => band.classList.remove('lit'), { signal })
    }

    // Copy buttons (the Android page's checksum)
    for (const b of all<HTMLButtonElement>('[data-copy]'))
      b.addEventListener(
        'click',
        () => {
          void navigator.clipboard?.writeText(b.dataset.copy ?? '').then(() => {
            const label = b.querySelector('span')
            b.classList.add('done')
            if (label) label.textContent = 'Copied'
            timers.push(
              window.setTimeout(() => {
                b.classList.remove('done')
                if (label) label.textContent = 'Copy'
              }, 1800),
            )
          })
        },
        { signal },
      )

    return () => {
      ac.abort()
      for (const t of timers) window.clearTimeout(t)
      window.clearTimeout(shut)
      for (const o of observers) o.disconnect()
      root.classList.remove('loaded', 'menu-open')
    }
  }, [])

  return null
}
