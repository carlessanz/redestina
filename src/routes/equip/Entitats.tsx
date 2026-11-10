// El listado «Entitats» del equipo (plan 1, rebanada 1C, D1): una fila por ORGANIZACIÓN, con
// su papel o doble papel, sobre `v_entitats_llistat`. Sustituye a los dos listados de antes
// («Entitats productores» / «Entitats receptores», uno por tabla).
//
// Filtros con `BarraFiltres` (fase 6): papel, estado, zona, tipo de entidad y cuenta.
// «Estat» es el ESTADO CRM (Plan 2, B1, 10-11-2026): Potencial · En desenvolupament · Actiu ·
// Inactiu; con el papel fijado (`?rol=` o el filtro «Rol») manda el estado de ese papel, sin él
// el de la organización (`v_entitats_llistat.estat_crm`). **Por defecto solo `actiu`** (P10 del
// plan 1): el filtro viene puesto y el contador «Mostrant N de M» lo dice.
// `?rol=ofertant|receptor` en la URL fija el papel (es a donde redirigen `/equip/productors` y
// las tarjetas del tablero). Como los listados de siempre: arriba las de prueba, buscador en
// cliente (son cientos de filas, deuda §12.5), «Missatge» y «Correu» por fila (iconos). «Darrer
// contacte» es la nota interna más reciente (1F, `notes_internes`). «Importa des d'Excel»
// (06-11-2026, solo super_admin) lleva al importador, `/equip/entitats/importa`. «Exporta a
// Excel» (Plan 2 B3, 10-11-2026; D10, todo el equipo) baja LAS FILAS VISIBLES con el formato de la
// plantilla del importador (`lib/exportEntitats.ts`), para completarlas fuera y volver a subirlas.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Download, Eye, FileDown, FileSpreadsheet, Mail, MessageCircle, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useAppContext, useCanals, useWhatsappActiu } from '../../hooks/useAppContext'
import { motiuCanal } from '../../lib/canals'
import { assegurarContacte, pendentsPerTelefon } from '../../lib/contactes'
import { filtraCerca } from '../../lib/cerca'
import { useCerca } from '../../hooks/useCerca'
import { useFiltresLlistat } from '../../hooks/useFiltresLlistat'
import { filtraLlistat, opcionsDisponibles, type Dimensio } from '../../lib/filtres'
import { avuiLocal, dataCurta } from '../../lib/format'
import { estatSeguiment, faTemps } from '../../lib/notesInternes'
import { classeEstatCrm, estatPerFiltre } from '../../lib/estatCrm'
import { ambComunicacions, csvConsentiments, filesExport, llistaConsentiments } from '../../lib/consentiments'
import { descarregarBlob, descarregarText } from '../../lib/tancament'
import { carregaExportacio } from '../../lib/importacions'
import { MAX_FILES } from '../../lib/importEntitats'
import { blobExportacio, enOrdre, nomFitxerExportacio } from '../../lib/exportEntitats'
import { carregaMunicipis, llistesTerritori } from '../../lib/municipis'
import { carregaTipusActivitat } from '../../lib/organitzacio'
import BarraFiltres from '../../components/BarraFiltres'
import BotoIcona from '../../components/BotoIcona'
import { FilaClicable, TitolFila } from '../../components/FilaClicable'
import DialegCorreu, { type DestinatariCorreu } from '../../components/DialegCorreu'
import type { EntitatLlistat } from '../../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

const COLS = 'id, nom_comercial, razon_social, nif, persona_contacte, email, telefono, poblacion, comarca, municipio_ine, productor_id, entidad_id, es_generadora, es_receptora, productor_activo, entidad_activo, activa, tipo_receptor, tipus_activitat, te_compte, compte_estat, canal_preferido, created_at, es_test, rebutjada, modalitats_interes, prioritat, conveni_productor, conveni_entitat, darrera_activitat, darrer_contacte_at, darrer_contacte_canal, seguiments_pendents, propera_seguiment, productor_estat_crm, entidad_estat_crm, estat_crm'

const soloDigitos = (s: string | null) => (s ?? '').replace(/\D/g, '')
const PER_DEFECTE = { estat: 'actiu' }

/** Cómo van los seguimientos de una entidad: el más próximo decide si hay alguno vencido. */
function seguimentDe(e: EntitatLlistat): 'vencut' | 'avui' | 'pendent' | 'cap' {
  if (!e.propera_seguiment || e.seguiments_pendents === 0) return 'cap'
  const estat = estatSeguiment(e.propera_seguiment, avuiLocal(), false)
  return estat === 'previst' || estat === 'fet' ? 'pendent' : estat
}

export default function Entitats() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const waActiu = useWhatsappActiu()
  // «Importa des d'Excel» (06-11-2026): solo el super_admin (la RPC también lo exige).
  const esSuperAdmin = useAppContext().ctx?.esSuperAdmin ?? false
  // Con el correo apagado (§8) «Correu» desaparece, como «Missatge» con WhatsApp apagado.
  const motiuEmail = motiuCanal(useCanals(), 'email')
  const [correuA, setCorreuA] = useState<DestinatariCorreu | null>(null)
  const [files, setFiles] = useState<EntitatLlistat[]>([])
  const [loading, setLoading] = useState(true)
  const [exportant, setExportant] = useState(false)
  const [exportantExcel, setExportantExcel] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unanswered, setUnanswered] = useState<Record<string, number>>({})
  const { cerca, setCerca, q } = useCerca()

  useEffect(() => {
    let cancelled = false
    supabase.from('v_entitats_llistat').select(COLS).order('nom_comercial', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) setError(loadError.message)
        else setFiles([...((data ?? []) as EntitatLlistat[])].sort((x, y) =>
          String(x.nom_comercial ?? '').localeCompare(String(y.nom_comercial ?? ''), 'ca')))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    // Los pendientes los cuenta la BASE (§12.5); un mensaje nuevo invalida la cuenta.
    const recompta = () => { void pendentsPerTelefon().then((c) => { if (!cancelled) setUnanswered(c) }) }
    recompta()
    const channel = supabase
      .channel('wa-messages-entitats')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_messages' }, () => recompta())
      .subscribe()
    return () => { cancelled = true; void supabase.removeChannel(channel) }
  }, [])

  const fl = useFiltresLlistat('equip-entitats-crm', PER_DEFECTE)
  // `?rol=` fija el papel al llegar (del tablero o de la ruta antigua de productores).
  const rolUrl = params.get('rol')
  useEffect(() => {
    if (rolUrl === 'ofertant' || rolUrl === 'receptor') fl.setValors({ ...fl.valors, rol: rolUrl })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al llegar con `?rol=`
  }, [rolUrl])

  // El papel NO es una dimensión de `filtraLlistat` (una organización con doble rol cuenta en
  // los dos, y una dimensión solo admite un valor por fila): se filtra aparte, `perRol`.
  const rolFiltre = fl.valors.rol
  const dims = useMemo<Dimensio<EntitatLlistat>[]>(() => [
    { clau: 'estat', etiquetaKey: 'fl.d_estat', valor: (e) => estatPerFiltre(e, rolFiltre) },
    { clau: 'comarca', etiquetaKey: 'fl.d_comarca', valor: (e) => e.comarca },
    { clau: 'tipus', etiquetaKey: 'fl.d_tipus', valor: (e) => e.tipo_receptor },
    { clau: 'compte', etiquetaKey: 'fl.d_compte', valor: (e) => e.compte_estat },
    // Los seguimientos del CRM (1.5): con alguno vencido, para hoy, pendiente o sin ninguno.
    { clau: 'seguiment', etiquetaKey: 'fl.d_seguiment', valor: (e) => seguimentDe(e) },
  ], [rolFiltre])
  const perRol = (e: EntitatLlistat) => !fl.valors.rol
    || (fl.valors.rol === 'ofertant' && e.es_generadora) || (fl.valors.rol === 'receptor' && e.es_receptora)

  const { test, resto } = useMemo(() => {
    const filtrades = filtraLlistat(filtraCerca(files, q,
      (e) => [e.nom_comercial, e.razon_social, e.nif, e.persona_contacte, e.poblacion, e.comarca, e.telefono, e.email]), dims, fl.valors)
      .filter(perRol)
    const test: EntitatLlistat[] = []
    const resto: EntitatLlistat[] = []
    for (const e of filtrades) (e.es_test ? test : resto).push(e)
    return { test, resto }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `perRol` solo depende de `fl.valors`
  }, [files, q, dims, fl.valors])

  const textDim = (clau: string) => (v: string) => {
    if (clau === 'rol') return t(`fl.v_${v}`)
    if (clau === 'estat') return t(`fl.v_${v}`)
    if (clau === 'tipus') return t(`org.tr_${v}`)
    if (clau === 'compte') return t(`ef.compte_${v}`)
    if (clau === 'seguiment') return t(`el.seg_${v}`)
    return v
  }

  function conveni(e: EntitatLlistat): { text: string; ok: boolean } {
    const falta: string[] = []
    if (e.es_generadora && !e.conveni_productor) falta.push(t('ef.paper_ofertant').toLowerCase())
    if (e.es_receptora && !e.conveni_entitat) falta.push(t('ef.paper_receptor').toLowerCase())
    const papers = Number(e.es_generadora) + Number(e.es_receptora)
    if (falta.length === 0) return { text: t('c.yes'), ok: true }
    if (falta.length === papers) return { text: t('el.conveni_cap'), ok: false }
    const te = e.conveni_productor ? t('ef.paper_ofertant') : t('ef.paper_receptor')
    return { text: t('el.conveni_part', { rol: te.toLowerCase() }), ok: false }
  }

  // El criterio de las tablas (03-11-2026, AGENTS.md §2): cabe sin scroll horizontal a 360 px.
  // En móvil quedan el nombre —con sus marcas y, debajo, la persona de contacto, la población y
  // el papel— y las acciones; «Rol» sale desde `md`, «Conveni» y «Població» desde `lg`, y NIF,
  // cuenta y las dos fechas desde `xl` (con el menú lateral, antes no caben). Lo escondido sigue
  // en la ficha. Las acciones van en iconos con tooltip y se apilan en móvil.
  function tabla(lista: EntitatLlistat[], marcarTest: boolean) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('el.c_name')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('el.c_rols')}</TableHead>
            <TableHead className="hidden xl:table-cell">{t('el.c_nif')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('el.c_town')}</TableHead>
            <TableHead className="hidden xl:table-cell">{t('el.c_compte')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('el.c_conveni')}</TableHead>
            <TableHead className="hidden xl:table-cell">{t('el.c_activitat')}</TableHead>
            <TableHead className="hidden xl:table-cell">{t('el.c_contacte')}</TableHead>
            <TableHead className="w-15 md:w-32">
              <span className="sr-only md:not-sr-only">{t('el.c_actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lista.map((e) => {
            const tel = soloDigitos(e.telefono)
            const sense = tel ? (unanswered[tel] ?? 0) : 0
            const conv = conveni(e)
            const nom = e.nom_comercial || e.razon_social || e.persona_contacte || '—'
            const contacte = e.darrer_contacte_at ? faTemps(e.darrer_contacte_at) : null
            const seg = seguimentDe(e)
            // El papel en texto, para debajo del nombre cuando la columna «Rol» no cabe.
            const rols = [e.es_generadora && t('ef.paper_ofertant'), e.es_receptora && t('ef.paper_receptor')]
              .filter(Boolean).join(' · ')
            return (
              <FilaClicable key={e.id} data-testid="entitat-fila" to={`/equip/entitats/${e.id}`}>
                <TableCell className="font-medium">
                  <span className="flex flex-wrap items-center gap-2">
                    <TitolFila to={`/equip/entitats/${e.id}`}>{nom}</TitolFila>
                    {marcarTest && <Badge variant="secondary">{t('badge.test')}</Badge>}
                    {/* El estado CRM de la organización (B1): solo se marca lo que no es Actiu. */}
                    {e.estat_crm !== 'actiu' && (
                      <Badge className={classeEstatCrm(e.estat_crm)} data-testid="entitat-estat">{t(`ef.estat_${e.estat_crm}`)}</Badge>
                    )}
                    {/* Un alta rechazada se MARCA, no se esconde (§12.29). */}
                    {e.rebutjada && <Badge className="bg-error-fondo text-error">{t('badge.rejected')}</Badge>}
                    {sense > 0 && <Badge variant="destructive">{t('el.unanswered', { n: sense })}</Badge>}
                    {seg === 'vencut' && <Badge className="bg-error-fondo text-error" data-testid="seguiment-vencut">{t('el.seg_vencut')}</Badge>}
                  </span>
                  {e.persona_contacte && e.persona_contacte !== nom && (
                    <span className="block text-xs font-normal text-muted-foreground">{e.persona_contacte}</span>
                  )}
                  {/* Lo que en pantallas estrechas no tiene columna: población (hasta `lg`) y papel (hasta `md`). */}
                  {e.poblacion && (
                    <span className="block text-xs font-normal text-muted-foreground lg:hidden">{e.poblacion}</span>
                  )}
                  {rols && <span className="block text-xs font-normal text-muted-foreground md:hidden">{rols}</span>}
                </TableCell>
                <TableCell className="hidden text-center md:table-cell">
                  <span className="flex flex-wrap justify-center gap-1">
                    {/* Un papel inactivo, en gris: la organización puede seguir activa por el otro. */}
                    {e.es_generadora && (
                      <Badge variant="outline" className={e.productor_activo ? undefined : 'text-muted-foreground line-through'}>
                        {t('ef.paper_ofertant')}
                      </Badge>
                    )}
                    {e.es_receptora && (
                      <Badge variant="outline" className={e.entidad_activo ? undefined : 'text-muted-foreground line-through'}>
                        {t('ef.paper_receptor')}
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="hidden text-center whitespace-nowrap tabular-nums text-muted-foreground xl:table-cell">{e.nif ?? '—'}</TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  {e.poblacion ?? '—'}
                  {e.comarca && <span className="block text-xs">{e.comarca}</span>}
                </TableCell>
                <TableCell className="hidden text-center text-muted-foreground xl:table-cell">{t(`ef.compte_${e.compte_estat}`)}</TableCell>
                <TableCell className={`hidden text-center lg:table-cell ${conv.ok ? 'text-exito' : 'text-aviso'}`}>{conv.text}</TableCell>
                <TableCell className="hidden text-center whitespace-nowrap text-muted-foreground xl:table-cell">
                  {e.darrera_activitat ? dataCurta(e.darrera_activitat) : t('el.activitat_mai')}
                </TableCell>
                {/* La nota interna más reciente (1F): «fa 3 dies · WhatsApp». */}
                <TableCell className="hidden text-center text-muted-foreground xl:table-cell" data-testid="darrer-contacte"
                  title={e.darrer_contacte_at ? dataCurta(e.darrer_contacte_at) : undefined}>
                  {contacte
                    ? [t(contacte.clau, { n: contacte.n }),
                      e.darrer_contacte_canal && t(`ni.canal_${e.darrer_contacte_canal}`)].filter(Boolean).join(' · ')
                    : t('el.contacte_mai')}
                  {/* Y la próxima acción pendiente más cercana (1.5), en el color de cómo va. */}
                  {e.propera_seguiment && (
                    <span className={`block text-xs ${seg === 'vencut' ? 'text-error' : seg === 'avui' ? 'text-aviso' : ''}`}
                      data-testid="propera-seguiment">
                      {t('el.propera', { data: dataCurta(`${e.propera_seguiment}T12:00:00`) })}
                      {e.seguiments_pendents > 1 ? ` (+${e.seguiments_pendents - 1})` : ''}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                    <BotoIcona icona={Eye} etiqueta={t('ne.obre_fitxa')} onClick={() => navigate(`/equip/entitats/${e.id}`)} />
                    {/* Con WhatsApp apagado (§8) se quita, no se deshabilita; gris si no hay teléfono. */}
                    {waActiu && (
                      <BotoIcona icona={MessageCircle} etiqueta={t('el.a_whatsapp')}
                        disabled={!tel} motiu={t('el.no_phone')}
                        onClick={() => tel && void assegurarContacte(tel, nom).then(() => navigate(`/equip/missatgeria/${tel}`))} />
                    )}
                    {/* Y «Correu», igual: con el correo apagado —o todas las notificaciones— se
                        quita (decisión de Carles, 03-11-2026); gris solo si falta el correo. */}
                    {!motiuEmail && (
                      <BotoIcona icona={Mail} etiqueta={t('el.a_correu')}
                        disabled={!e.email} motiu={t('correu.no_email')}
                        onClick={() => setCorreuA({
                          email: e.email, nom,
                          tipus: e.productor_id ? 'productor' : 'entidad',
                          id: (e.productor_id ?? e.entidad_id) as string,
                        })} />
                    )}
                  </div>
                </TableCell>
              </FilaClicable>
            )
          })}
        </TableBody>
      </Table>
    )
  }

  const vacio = !loading && !error && test.length === 0 && resto.length === 0

  async function exportaCorreus() {
    setExportant(true)
    const r = await llistaConsentiments()
    setExportant(false)
    if (!r.ok) { toast.error(t('el.export_err')); return }
    const base = ambComunicacions(filesExport(r.files))
    if (base.length === 0) { toast.info(t('el.export_buit')); return }
    const capcalera = ['entitat', 'papers', 'correu', 'privacitat', 'com_redestina', 'com_espigoladors', 'origen', 'data']
      .map((c) => t(`el.exp_${c}`))
    descarregarText(`correus-consentiment-${avuiLocal()}.csv`,
      csvConsentiments(base, capcalera, (v) => (v === null ? '' : t(v ? 'c.yes' : 'c.no'))),
      'text/csv;charset=utf-8')
    toast.success(t('el.export_ok', { n: base.length }))
  }

  // «Exporta a Excel» (B3): las filas que se ven (con los filtros y la búsqueda), en su orden.
  // Sin nada filtrado se piden todas (`null`). Los catálogos dan las palabras de las listas,
  // como en la plantilla.
  async function exportaExcel() {
    const visibles = [...test, ...resto].map((e) => e.id)
    if (visibles.length === 0) { toast.info(t('el.export_excel_buit')); return }
    setExportantExcel(true)
    const [r, activitats, munis] = await Promise.all([
      carregaExportacio(visibles.length === files.length ? null : visibles),
      carregaTipusActivitat(),
      carregaMunicipis(),
    ])
    if (!r.ok) { setExportantExcel(false); toast.error(t('el.export_excel_err')); return }
    const filesExcel = enOrdre(r.dades, visibles)
    const blob = await blobExportacio(filesExcel, { t, lang, activitats, ...llistesTerritori(munis) })
    setExportantExcel(false)
    if (!blob) { toast.error(t('el.export_excel_err')); return }
    descarregarBlob(nomFitxerExportacio(avuiLocal()), blob)
    toast.success(t('el.export_excel_ok', { n: filesExcel.length }))
    // El importador acepta 1.000 filas por fichero: más, y habrá que partirlo para reimportarlo.
    if (filesExcel.length > MAX_FILES) toast.warning(t('el.export_excel_massa', { n: MAX_FILES }))
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div>
          <CardTitle>{t('el.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('el.subtitle')}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {/* La base de correos con consentimiento (RGPD, 04-11-2026): solo quien ha dicho que sí
              a alguna comunicación, con lo que dijo a cada una. */}
          <Button variant="outline" onClick={() => void exportaCorreus()} disabled={exportant}>
            <Download className="size-4" /> {t('el.export_correus')}
          </Button>
          {/* B3 (D10): todo el equipo exporta; importar sigue siendo del super_admin. */}
          <Button variant="outline" onClick={() => void exportaExcel()} disabled={exportantExcel || loading} data-testid="el-exporta">
            <FileDown className="size-4" /> {t('el.export_excel')}
          </Button>
          {esSuperAdmin && (
            <Button variant="outline" onClick={() => navigate('/equip/entitats/importa')} data-testid="el-importa">
              <FileSpreadsheet className="size-4" /> {t('ie.boto_importa')}
            </Button>
          )}
          {/* Sin cuenta (D5): el acceso se da después desde la ficha, «Dona-li accés» (1D). */}
          <Button onClick={() => navigate(`/equip/entitats/nova${fl.valors.rol ? `?rol=${fl.valors.rol}` : ''}`)}>
            <Plus className="size-4" /> {t('el.nova')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Input type="search" placeholder={t('el.search')} value={cerca} onChange={(e) => setCerca(e.target.value)} />
        <BarraFiltres
          id="ent"
          desplegables={[
            { clau: 'rol', etiquetaKey: 'fl.d_rol', opcions: ['ofertant', 'receptor'], text: textDim('rol') },
            ...dims.map((d) => ({
              clau: d.clau, etiquetaKey: d.etiquetaKey,
              opcions: opcionsDisponibles(files, dims, d.clau, fl.valors),
              text: textDim(d.clau),
            })),
          ]}
          valors={fl.valors}
          onValors={fl.setValors}
          mostrant={test.length + resto.length}
          total={files.length}
        />
        {loading && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
        {vacio && <p className="text-sm text-muted-foreground">{files.length === 0 ? t('el.empty') : t('el.no_match')}</p>}
        {test.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('grp.test', { n: test.length })}</h3>
            {tabla(test, true)}
          </section>
        )}
        {resto.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">{t('grp.rest', { n: resto.length })}</h3>
            {tabla(resto, false)}
          </section>
        )}
      </CardContent>
      <DialegCorreu obert={correuA !== null} onObert={(v) => { if (!v) setCorreuA(null) }} destinatari={correuA} />
    </Card>
  )
}
