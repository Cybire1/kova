import { Art, Brand } from '@/components/brand'

/** Split screen: the painted world on one side, one short form on the other. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-art" aria-hidden="true">
        <Brand />
        <div className="auth-scene">
          <Art name="scene-welcome" size={560} priority />
        </div>
        <p className="auth-line">Tap. Paid. Anywhere.</p>
        <p className="auth-sub">
          Payments that settle in about a second, straight to your own wallet, in dollars your
          customers can pay from anywhere.
        </p>
      </aside>
      <main className="auth-main">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        {/* On a phone the painted world comes along too, small, above the form. */}
        <div className="auth-mobile-art" aria-hidden="true">
          <Art name="scene-welcome" size={260} />
        </div>
        {children}
      </main>
    </div>
  )
}
