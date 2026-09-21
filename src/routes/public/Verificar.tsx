// `/verificar/:codi` — la página pública que dice si un certificado es auténtico.
//
// QUIÉN LLEGA AQUÍ. Un tercero sin cuenta y sin contexto: quien revisa una subvención, un
// ayuntamiento, quien lee una memoria anual. Llega escaneando el código del PDF o pulsando
// el sello de una web, probablemente desde el móvil y probablemente de pie. Así que:
//
//   · NO monta `AppContextProvider` ni nada que exija sesión. Va fuera de `RequireSessio`.
//   · Lo único que hace es UNA llamada de lectura a `verificar-certificat`. Cuanto menos
//     haga la página, menos hay que pueda fallar.
//   · Móvil primero: una columna, sin tablas, y la respuesta arriba del todo.
//
// 🔴 LOS CUATRO FINALES SE DISTINGUEN DE VERDAD, y esa es toda la razón de ser de esta
//    pantalla:
//
//    · **vàlid**       — existe y es el vigente.
//    · **substituït**  — existe, es auténtico, y hay otro posterior que lo sustituye. Un
//                        tercero TIENE que saberlo: los kilos de este papel ya están
//                        recogidos en otro, y darlo por bueno sería contarlos dos veces.
//                        Va en ámbar, no en rojo: no es falso, es viejo.
//    · **no consta**   — ningún certificado con ese código. Esto sí es rojo.
//    · **no ho sabem** — no hemos podido preguntar (red, servidor). **Nunca se pinta como
//                        «no consta»**: decirle a alguien que un certificado auténtico no
//                        existe, porque se ha caído una conexión, es acusarlo de
//                        falsificarlo.
//
// ⚠️ Un certificado en modo PRUEBA se dice en su propia banda. Su PDF lleva marca de agua,
//    pero quien verifica está mirando esta pantalla, no el papel.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { BadgeCheck, CircleAlert, CircleHelp, CircleX } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { verificaCertificat, type ResultatVerificacio } from '../../lib/verificacio'
import { dataCurta, kg } from '../../lib/albarans'
import LayoutAcces from '../../components/LayoutAcces'
import { Card, CardContent } from '@/components/ui/card'

export default function Verificar() {
  const { t } = useT()
  const { codi } = useParams<{ codi: string }>()
  const [res, setRes] = useState<ResultatVerificacio | null>(null)

  useEffect(() => {
    let viu = true
    if (!codi) { setRes({ estat: 'desconegut' }); return }
    void verificaCertificat(codi).then((r) => { if (viu) setRes(r) })
    return () => { viu = false }
  }, [codi])

  return (
    <LayoutAcces ample>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h1 className="text-xl font-bold">{t('ver.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('ver.subtitle')}</p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">{t('ver.code')}</p>
            {/* `break-all`: a 360 px un código sin guiones desbordaría la tarjeta. */}
            <p className="font-medium tabular-nums break-all">{codi ?? '—'}</p>
          </div>

          {res === null
            ? <p className="text-sm text-muted-foreground">{t('ver.checking')}</p>
            : <Resposta res={res} />}

          <p className="border-t pt-3 text-xs text-muted-foreground">{t('ver.foot')}</p>
        </CardContent>
      </Card>
    </LayoutAcces>
  )
}

function Resposta({ res }: { res: ResultatVerificacio }) {
  const { t } = useT()

  if (res.estat === 'desconegut') {
    return (
      <Banda to="error" icona={<CircleX className="size-5 shrink-0" aria-hidden />}>
        <p className="font-semibold">{t('ver.unknown_t')}</p>
        <p className="mt-1 text-sm">{t('ver.unknown')}</p>
      </Banda>
    )
  }

  if (res.estat === 'error') {
    return (
      <Banda to="neutre" icona={<CircleHelp className="size-5 shrink-0" aria-hidden />}>
        <p className="font-semibold">{t('ver.error_t')}</p>
        <p className="mt-1 text-sm">{t('ver.error')}</p>
      </Banda>
    )
  }

  const d = res.dades
  const vigent = res.estat === 'valid'

  return (
    <div className="space-y-4">
      <Banda
        to={vigent ? 'exit' : 'avis'}
        icona={vigent
          ? <BadgeCheck className="size-5 shrink-0" aria-hidden />
          : <CircleAlert className="size-5 shrink-0" aria-hidden />}
      >
        <p className="font-semibold">{vigent ? t('ver.valid_t') : t('ver.replaced_t')}</p>
        <p className="mt-1 text-sm">{vigent ? t('ver.valid') : t('ver.replaced')}</p>
      </Banda>

      {/* El modo prueba se dice aquí y no en una nota al pie: es lo que decide si este
          papel sirve para algo. */}
      {d.mode === 'prueba' && (
        <Banda to="avis" icona={<CircleAlert className="size-5 shrink-0" aria-hidden />}>
          <p className="font-semibold">{t('ver.test_t')}</p>
          <p className="mt-1 text-sm">{t('ver.test')}</p>
        </Banda>
      )}

      {/* Una columna en móvil y dos desde `sm`: son cinco datos cortos, no una tabla. */}
      <dl className="grid gap-3 sm:grid-cols-2">
        <Dada etiqueta={t('ver.f_number')} valor={d.numero ?? '—'} />
        <Dada etiqueta={t('ver.f_entity')} valor={d.entitat ?? '—'} />
        <Dada
          etiqueta={t('ver.f_period')}
          valor={d.periode.des_de && d.periode.fins_a
            ? t('mydoc.cdp_period', {
              desde: dataCurta(d.periode.des_de),
              fins: dataCurta(d.periode.fins_a),
            })
            : '—'}
        />
        <Dada etiqueta={t('ver.f_kg')} valor={d.kg === null ? '—' : `${kg(d.kg)} kg`} />
        <Dada etiqueta={t('ver.f_issued')} valor={dataCurta(d.emes_el)} />
      </dl>

      {/* Lo que esta pantalla NO dice, dicho: acredita kilos, no euros ni una donación
          deducible. Sin esto, quien lo lee puede darle un valor fiscal que no tiene. */}
      <p className="rounded-md bg-secondary p-3 text-sm text-secondary-foreground">
        {t('ver.scope')}
      </p>
    </div>
  )
}

/** Los cuatro tonos, con los tokens del sistema. El error es rojo; el coral no es error. */
const TO: Record<string, string> = {
  exit: 'bg-exito-fondo text-exito',
  avis: 'bg-aviso-fondo text-aviso',
  error: 'bg-error-fondo text-error',
  neutre: 'bg-secondary text-secondary-foreground',
}

function Banda(
  { to, icona, children }: { to: keyof typeof TO; icona: React.ReactNode; children: React.ReactNode },
) {
  return (
    <div className={`flex items-start gap-3 rounded-md p-3 ${TO[to]}`}>
      {icona}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function Dada({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="font-medium break-words">{valor}</dd>
    </div>
  )
}
