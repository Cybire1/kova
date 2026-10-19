import { failure, kovaPublic } from '@/lib/api'

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const target = path.join('/')
  if (
    !/^(?:info|resolve|reserve|confirm|resend|otp|verify|claim|return|payments\/lnk_[a-z0-9]{26})$/.test(
      target,
    )
  )
    return Response.json({ error: 'Not found' }, { status: 404 })
  try {
    return Response.json(
      await kovaPublic(`/v1/phone/${target}`, {
        method: request.method,
        body: request.method === 'GET' ? undefined : JSON.stringify(await request.json()),
      }),
    )
  } catch (error) {
    return failure(error)
  }
}
export const GET = proxy
export const POST = proxy
