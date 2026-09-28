// Vercel Routing Middleware: corre delante de TODA la web, antes de los rewrites de
// `vercel.json`. Toda la lógica vive en `cortina/cortina.ts`, que es puro y tiene pruebas.
// ⚠️ En `npm run dev` no corre: Vite no sabe de él. La cortina solo existe en Vercel.
import { gestiona } from './cortina/cortina.ts'

export default function middleware(req: Request): Promise<Response> {
  return gestiona(req)
}
