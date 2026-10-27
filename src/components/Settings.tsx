// Configuració del equipo, por pestañas (27-10-2026): un submenú horizontal en vez de una
// página larga. Cada pestaña es un componente de `configuracio/` o un bloque que ya existía.
//
// La pestaña vive en la URL (`?tab=notificacions`), como en Albarans: es lo que deja que un
// aviso o un enlace lleven a la sección exacta. Un valor desconocido cae en «General».

import { useSearchParams } from 'react-router'
import { useT } from '../lib/i18n'
import { useAppContext } from '../hooks/useAppContext'
import DadesFundacio from './equip/DadesFundacio'
import FactorsImpacte from './equip/FactorsImpacte'
import EditorDiagnostic from './equip/EditorDiagnostic'
import SeccioGeneral from './configuracio/SeccioGeneral'
import SeccioNotificacions from './configuracio/SeccioNotificacions'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const PESTANYES = ['general', 'notificacions', 'fundacio', 'impacte', 'diagnostic'] as const

export default function Settings() {
  const { t } = useT()
  const { ctx } = useAppContext()
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab = (PESTANYES as readonly string[]).includes(tabParam ?? '') ? (tabParam as string) : 'general'
  // Los interruptores de `app_settings` solo los escribe el super_admin.
  const potCanviar = ctx?.esSuperAdmin ?? false

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">{t('set.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('set.subtitle')}</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams(v === 'general' ? {} : { tab: v }, { replace: true })}>
        {/* Cinco etiquetas no caben a 320 px: la lista scrollea sola en vez de empujar la
            página entera hacia la derecha. `min-w-0` porque es hijo de un flex (el `Tabs`):
            sin él, `min-width:auto` lo ensancha hasta su contenido y el scroll no actúa —
            medido a 320 px, 292 > 288 (§2, regla 4)—. Sin `-mx-1`, que también desbordaba. */}
        <div className="min-w-0 overflow-x-auto pb-1">
          <TabsList variant="line" className="w-max">
            <TabsTrigger value="general">{t('set.tab_general')}</TabsTrigger>
            <TabsTrigger value="notificacions">{t('set.tab_notificacions')}</TabsTrigger>
            <TabsTrigger value="fundacio">{t('set.tab_fundacio')}</TabsTrigger>
            <TabsTrigger value="impacte">{t('set.tab_impacte')}</TabsTrigger>
            <TabsTrigger value="diagnostic">{t('set.tab_diagnostic')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="general" className="pt-4"><SeccioGeneral potCanviar={potCanviar} /></TabsContent>
        <TabsContent value="notificacions" className="pt-4"><SeccioNotificacions potCanviar={potCanviar} /></TabsContent>
        {/* Los datos de la Fundación: lo que encabeza todos los documentos y lo que
            desbloquea la emisión con efecto fiscal. */}
        <TabsContent value="fundacio" className="pt-4"><DadesFundacio /></TabsContent>
        {/* Los factores del impacto (fase 10). */}
        <TabsContent value="impacte" className="pt-4"><FactorsImpacte /></TabsContent>
        {/* El cuestionario, las medidas y las reglas del diagnóstico (F2). */}
        <TabsContent value="diagnostic" className="pt-4"><EditorDiagnostic /></TabsContent>
      </Tabs>
    </div>
  )
}
