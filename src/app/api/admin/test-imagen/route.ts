import { testImagenConnection } from '@/lib/ai/imagen'
import { createServerClient } from '@/lib/db/supabase-server'

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    console.log('[test-imagen] Testing image generation...')
    const result = await testImagenConnection()

    return Response.json({
      ...result,
      message: result.working
        ? `Image generation working via ${result.method}`
        : 'Both methods failed — see terminal logs for details'
    })
  } catch (err) {
    return Response.json({
      working: false,
      method: null,
      error: err instanceof Error ? err.message : 'Unknown error'
    })
  }
}
