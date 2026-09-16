// Página pública de Redestina: la raíz de la aplicación.
//
// Es lo primero que ve alguien que llega sin cuenta, así que explica qué es el servicio
// y encamina a registro o login. No anuncia el acceso del equipo interno: el panel de
// dinamización no se publicita en la parte pública.
//
// Ojo con la sesión: los enlaces mágicos y los de recuperación aterrizan aquí (el
// redirectTo es APP_URL, la raíz), así que esta pantalla tiene que apartarse en cuanto
// supabase-js confirma que hay token, o quien acaba de seguir su enlace se quedaría
// mirando la portada.

import { Link, Navigate } from 'react-router'
import { useT } from '../../lib/i18n'
import { useSessio } from '../../hooks/useSessio'
import SelectorIdioma from '../../components/SelectorIdioma'
import { ComprovantSessio } from '../../components/LayoutAcces'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

// Botón principal cuando va SOBRE VERDE (el hero): crema con texto verde, porque el `default`
// de Button es verde y desaparecería. En fondos claros se usa `default` sin más. El coral no es
// variante de botón (design/DESIGN.md §6).
const BOTO_SOBRE_VERD = 'bg-primary-foreground text-primary hover:bg-primary-foreground/90'

// Los cuatro momentos del proceso, los mismos que el panel del equipo enseña en su
// tablero; aquí contados para quien aún no es usuario.
const PROCES = [
  { n: 1, tk: 'land.p1t', dk: 'land.p1d' },
  { n: 2, tk: 'land.p2t', dk: 'land.p2d' },
  { n: 3, tk: 'land.p3t', dk: 'land.p3d' },
  { n: 4, tk: 'land.p4t', dk: 'land.p4d' },
]

export default function Landing() {
  const { t } = useT()
  const { session, carregant } = useSessio()

  if (carregant) return <ComprovantSessio />
  if (session) return <Navigate to="/panell" replace />

  return (
    <div className="min-h-dvh bg-background">
      {/* Barra superior clara con el logo en color (design/DESIGN.md §6, «Parte pública»).
          Sticky sobre toda la página: es hija directa de la raíz, no del hero, o al salir el
          hero de pantalla se iría con él. */}
      <header className="sticky top-0 z-40 border-b border-border bg-card text-foreground">
        {/* Estándar de cabecera: altura fija (64px), logo y navegación agrupados a la izquierda
            —la navegación centrada «flotaba» lejos de la marca— y acciones a la derecha,
            separadas del idioma por un divisor. Enlaces en peso medio y con zona de clic y
            foco visibles, no texto suelto en gris claro. */}
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 md:h-20 md:px-6">
          <Link to="/" aria-label="Redestina" className="flex shrink-0 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <img src="/logo-redestina.svg" alt="Redestina" className="h-10 w-auto md:h-11 lg:h-12" />
          </Link>

          <nav className="ml-6 hidden items-center gap-1 md:flex lg:ml-10">
            <a href="#com-funciona" className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 lg:text-[15px] transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t('land.nav_how')}
            </a>
            <a href="#per-a-qui" className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 lg:text-[15px] transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t('land.nav_who')}
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <SelectorIdioma />
            <span aria-hidden className="mx-1 hidden h-6 w-px bg-border sm:block" />
            <Button asChild variant="ghost" className="font-medium">
              <Link to="/login">{t('land.enter')}</Link>
            </Button>
            <Button asChild className="font-medium">
              <Link to="/registre">{t('land.signup')}</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero en verde, con los botones en crema (BOTO_SOBRE_VERD) */}
      <section className="bg-primary px-4 py-16 text-center text-primary-foreground md:py-24">
        <h1 className="mx-auto max-w-4xl text-3xl leading-tight font-bold text-balance sm:text-4xl xl:text-5xl">{t('land.hero_title')}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-primary-foreground/80 md:text-lg">
          {t('land.hero_sub')}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className={BOTO_SOBRE_VERD}>
            <Link to="/registre?rol=productor">{t('land.hero_prod')}</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="border-primary-foreground/40 bg-transparent text-primary-foreground shadow-none hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            <Link to="/registre?rol=entitat">{t('land.hero_rec')}</Link>
          </Button>
        </div>
        <Link
          to="/login"
          className="mt-6 inline-block text-sm text-primary-foreground/70 underline underline-offset-4 transition-colors hover:text-primary-foreground"
        >
          {t('land.hero_login')}
        </Link>

        {/* Los mismos dos enlaces del `nav` de arriba, que es `hidden md:flex`: sin esto,
            por debajo de 768px las dos secciones de la página quedan sin ninguna forma de
            llegar salvo desplazándose a ciegas por 2.400px. Van aquí y no en una
            hamburguesa porque son dos: un menú desplegable para dos anclas es más
            maquinaria que la que resuelve. */}
        <nav className="mt-8 flex items-center justify-center gap-6 md:hidden" aria-label={t('land.nav_how')}>
          <a href="#com-funciona" className="py-2 text-sm text-primary-foreground underline underline-offset-4">
            {t('land.nav_how')}
          </a>
          <a href="#per-a-qui" className="py-2 text-sm text-primary-foreground underline underline-offset-4">
            {t('land.nav_who')}
          </a>
        </nav>
      </section>

      {/* ⚠️ LOS TÍTULOS DE SECCIÓN VAN EN `coral-oscuro`, QUE ES EL COLOR EXACTO DEL «RE»
          DEL LOGO (#e56a5c), y es una decisión del cliente tomada sabiendo lo que cuesta
          (16-09-2026): sobre el crema de la portada da **2,85:1**, por debajo del 3:1 que
          WCAG pide incluso para texto grande. Se midió y se le dijo; su respuesta fue «me
          da igual la legibilidad, quiero ese naranja».
          🔴 NO ES UN DESCUIDO Y NO SE «ARREGLA» PONIENDO `coral-texto`: eso ya estuvo y se
             cambió a propósito porque no se parecía al logo. Si alguien vuelve a medir el
             contraste y quiere corregirlo, que lo hable antes con el cliente.
          ⚠️ Esto vale SOLO para estos títulos de la portada. El resto del texto en coral
             sigue en `coral-texto` (4,47:1), que es para lo que ese token existe. */}
      {/* Cómo funciona: misma maquetación que el tablero del equipo (Dashboard, «dash.how») */}
      <section id="com-funciona" className="scroll-mt-16 md:scroll-mt-20 bg-background">
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-16">
          <h2 className="text-2xl font-bold text-coral-oscuro md:text-3xl">{t('land.how_title')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PROCES.map((p) => (
              <Card key={p.n}>
                <CardContent className="pt-6">
                  <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {p.n}
                  </span>
                  <h3 className="mt-2 text-sm font-semibold text-primary">{t(p.tk)}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t(p.dk)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Para quién: los dos perfiles que se pueden registrar, cada uno con su alta */}
      <section id="per-a-qui" className="scroll-mt-16 md:scroll-mt-20 bg-muted/50">
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-16">
          <h2 className="text-2xl font-bold text-coral-oscuro md:text-3xl">{t('land.who_title')}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-lg font-semibold text-primary">{t('land.prod_title')}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{t('land.prod_d')}</p>
                <Button asChild className="mt-5">
                  <Link to="/registre?rol=productor">{t('land.prod_cta')}</Link>
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-lg font-semibold text-primary">{t('land.rec_title')}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{t('land.rec_d')}</p>
                <Button asChild className="mt-5">
                  <Link to="/registre?rol=entitat">{t('land.rec_cta')}</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <footer className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-10 text-center">
          <img src="/logo-redestina-negativo.svg" alt="Redestina" className="h-7 w-auto" />
          <p className="text-sm text-primary-foreground/80">{t('land.foot_by')}</p>
          <a
            href="https://espigoladors.cat"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary-foreground underline underline-offset-4 transition-opacity hover:opacity-80"
          >
            {t('land.foot_web')}
          </a>
          <p className="text-xs text-primary-foreground/60">{t('login.foot')}</p>
        </div>
      </footer>
    </div>
  )
}
