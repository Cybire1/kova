/**
 * Between the page and Kova's background (an isolated-world content script). It passes the page's
 * provider requests on and the answers back, and shows Kova's notes on the page ("Paid 10¢ to read
 * this") in a shadow root the page can't style or read.
 */

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data as { target?: string; id?: number; method?: string; params?: unknown }
  if (
    data?.target !== 'kova-bridge' ||
    typeof data.id !== 'number' ||
    typeof data.method !== 'string'
  )
    return
  const id = data.id
  chrome.runtime
    .sendMessage({ type: 'rpc', method: data.method, params: data.params })
    .then(
      (reply: { ok: boolean; value?: { result?: unknown; error?: unknown }; error?: string }) => {
        const value = reply?.ok
          ? reply.value
          : { error: { code: -32603, message: reply?.error ?? 'Kova didn’t answer.' } }
        window.postMessage({ target: 'kova-inpage', id, ...value }, window.location.origin)
      },
    )
    .catch(() => {
      window.postMessage(
        {
          target: 'kova-inpage',
          id,
          error: { code: 4900, message: 'Kova is off. Reload the page.' },
        },
        window.location.origin,
      )
    })
})

chrome.runtime.onMessage.addListener(
  (message: {
    type?: string
    event?: string
    data?: unknown
    title?: string
    body?: string
    tone?: string
  }) => {
    if (message?.type === 'kova-event')
      window.postMessage(
        { target: 'kova-inpage', event: message.event, payload: message.data },
        window.location.origin,
      )
    if (message?.type === 'kova-toast' && message.title)
      showToast(message.title, message.body ?? '', message.tone === 'paid')
  },
)

const LOGO =
  '<svg viewBox="0 0 200 200" width="18" height="18" aria-hidden="true"><path d="M62 46V154" stroke="#ECE8E1" stroke-width="19" stroke-linecap="round" fill="none"/><path d="M92.6 74.3A40 40 0 0 1 92.6 125.7M115.6 55A70 70 0 0 1 115.6 145M138.6 35.7A100 100 0 0 1 138.6 164.3" stroke="#D46558" stroke-width="17" stroke-linecap="round" fill="none"/></svg>'

function showToast(title: string, body: string, paid: boolean) {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647'
  const root = host.attachShadow({ mode: 'closed' })
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  root.innerHTML = `
<style>
.t{width:300px;box-sizing:border-box;border-radius:18px;padding:14px;font:500 13px/1.4 Manrope,ui-sans-serif,system-ui,-apple-system,sans-serif;
background:${dark ? '#161616' : '#F4F2EE'};color:${dark ? '#ECE8E1' : '#0B1A1D'};
box-shadow:0 2px 6px rgba(11,26,29,.06),0 40px 80px -30px rgba(11,26,29,.45),inset 0 0 0 1px ${dark ? 'rgba(236,232,225,.08)' : 'rgba(11,26,29,.08)'};
animation:in .7s cubic-bezier(.32,.72,0,1) both}
.t.out{animation:out .45s cubic-bezier(.32,.72,0,1) forwards}
@keyframes in{from{opacity:0;transform:translateY(14px) scale(.98)}}
@keyframes out{to{opacity:0;transform:translateY(10px)}}
.r{display:flex;align-items:center;gap:10px}
.k{width:30px;height:30px;border-radius:9px;background:#0B1A1D;display:grid;place-items:center;flex:none}
b{display:block;font-weight:600;font-size:14px}
small{display:block;color:${dark ? '#9E998F' : '#5F6B6E'};font-size:12px;margin-top:1px}
.m{height:4px;border-radius:4px;background:${dark ? 'rgba(236,232,225,.1)' : 'rgba(11,26,29,.08)'};margin-top:12px;overflow:hidden}
.m i{display:block;height:100%;width:0;background:${paid ? '#D46558' : '#949C9E'};border-radius:4px;animation:fill 1.2s cubic-bezier(.32,.72,0,1) .3s forwards}
@keyframes fill{to{width:100%}}
button{all:unset;cursor:pointer;margin-left:auto;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:inherit;opacity:.5}
button:hover{opacity:1}
</style>
<div class="t" role="status"><div class="r"><span class="k">${LOGO}</span><span><b></b><small></small></span><button aria-label="Close">✕</button></div><div class="m"><i></i></div></div>`
  const card = root.querySelector('.t') as HTMLElement
  ;(root.querySelector('b') as HTMLElement).textContent = title
  ;(root.querySelector('small') as HTMLElement).textContent = body
  const close = () => {
    card.classList.add('out')
    setTimeout(() => host.remove(), 450)
  }
  ;(root.querySelector('button') as HTMLElement).addEventListener('click', close)
  document.documentElement.appendChild(host)
  setTimeout(close, 6500)
}
