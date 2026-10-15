import { Art, Brand } from './brand'

/** Something went wrong, said plainly, with what to do next. */
export function Notice({
  title,
  children,
  action,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <main className="page page-narrow">
      <header className="topbar">
        <Brand />
      </header>
      <div className="card notice" role="alert">
        <Art name="kovi-oops" size={130} />
        <h2>{title}</h2>
        {children}
        {action}
      </div>
    </main>
  )
}
