// Mapa de rutas. Dos mitades:
//
//   · Pública: landing, los dos accesos y el registro. No sabe nada de roles.
//   · Privada: todo lo demás, bajo RequireSessio, que es quien monta el contexto de rol.
//
// Dentro de la privada, prefijo por rol (`/equip`, `/productor`, `/receptor`) porque una
// misma cuenta puede tener varios paneles (doble rol productor+entidad, §12.16) y así
// la guarda es inequívoca y el enlace, compartible.
//
// Cada ruta declara en `handle` su título y cómo quiere el contenedor:
//   · fullBleed → gestiona su propio alto (Mensajería)
//   · ample     → listado ancho, como el 90% del layout anterior

import { createBrowserRouter, Navigate } from 'react-router'
import AppShell from '../layout/AppShell'
import { ArrelApp, ArrelPerRol, RequireSessio, RoleGuard, SenseAcces } from '../routes/Comuns'
import Landing from '../routes/public/Landing'
import LoginUsuaris from '../routes/public/LoginUsuaris'
import LoginEquip from '../routes/public/LoginEquip'
import Registre from '../routes/public/Registre'
import RestablirClau from '../routes/public/RestablirClau'
import Dashboard from '../components/Dashboard'
import Settings from '../components/Settings'
import { Entitats, Ofertes, Productors } from '../routes/equip/Llistats'
import OfertaDetall from '../routes/equip/OfertaDetall'
import FitxaRegistre from '../routes/equip/FitxaRegistre'
import Missatgeria from '../routes/equip/Missatgeria'
import Documents from '../routes/equip/Documents'
import Albarans from '../routes/equip/Albarans'
import AlbaraDetall from '../routes/equip/AlbaraDetall'
import Canalitzacio from '../routes/equip/Canalitzacio'
import CanalitzacioDetall from '../routes/equip/CanalitzacioDetall'
import { EspigoladaDetall, Espigolades, NovaEspigolada } from '../routes/equip/Espigolades'
import Confirmar from '../routes/public/Confirmar'
import Verificar from '../routes/public/Verificar'
import Signar from '../routes/public/Signar'
import Tancament from '../routes/equip/Tancament'
import TancamentDetall from '../routes/equip/TancamentDetall'
import Costos from '../routes/equip/Costos'
import Convenis from '../routes/equip/Convenis'
import ConveniDetall from '../routes/equip/ConveniDetall'
import CampanyaConvenis from '../routes/equip/CampanyaConvenis'
import ProductorDocuments from '../routes/productor/Documents'
import ReceptorDocuments from '../routes/receptor/Documents'
import Factura from '../routes/public/Factura'
import Aprovacions from '../routes/equip/Aprovacions'
import { ProductorInici, ProductorOfertes } from '../routes/productor/Ofertes'
import NovaOferta from '../routes/productor/NovaOferta'
import ProductorOfertaDetall from '../routes/productor/OfertaDetall'
import LaMevaOrganitzacio from '../routes/LaMevaOrganitzacio'
import Diagnostic from '../routes/Diagnostic'
import Diagnostics from '../routes/equip/Diagnostics'
import DiagnosticDetall from '../routes/equip/DiagnosticDetall'
import Mercat from '../routes/receptor/Mercat'
import { Historic, Interessos } from '../routes/receptor/Interessos'

export const router = createBrowserRouter([
  {
    element: <ArrelApp />,
    children: [
      // ── Pública ──
      { path: '/', element: <Landing /> },
      { path: '/login', element: <LoginUsuaris /> },
      { path: '/admin', element: <LoginEquip /> },
      { path: '/registre', element: <Registre /> },
      { path: '/confirmar/:token', element: <Confirmar /> },
      { path: '/factura/:token', element: <Factura /> },
      { path: '/signar/:token', element: <Signar /> },
      // Verificación de un certificado (F4). Pública sin matices: quien llega es un
      // tercero sin cuenta —un ayuntamiento, quien revisa una subvención— que ha
      // escaneado el código del PDF o ha pulsado el sello de una web. Lo único que
      // «autoriza» es conocer el código, igual que en `/confirmar` lo hace el token.
      { path: '/verificar/:codi', element: <Verificar /> },
      { path: '/restablir', element: <RestablirClau /> },

      // ── Privada ──
      {
        element: <RequireSessio />,
        children: [
          { path: '/panell', element: <ArrelPerRol /> },
          { path: '/sense-acces', element: <SenseAcces /> },
          {
            element: <AppShell />,
            children: [
              // Fuera de los tres paneles a propósito: una organización no es «de» un
              // papel, y con doble rol una sola entrada evita dos nombres para lo mismo.
              {
                path: '/organitzacio',
                element: <LaMevaOrganitzacio />,
                handle: { titleKey: 'nav.my_org' },
              },
              // El diagnóstico de prevención (F2). Cuelga de `/organitzacio` y no de un
              // panel por lo mismo que la ficha: con doble rol son dos diagnósticos, pero
              // se entra por un solo sitio.
              {
                path: '/organitzacio/diagnostic',
                element: <Diagnostic />,
                handle: { titleKey: 'nav.my_diagnostic' },
              },
              {
                path: '/equip',
                element: <RoleGuard rol="intern" />,
                children: [
                  { index: true, element: <Navigate to="/equip/tauler" replace /> },
                  { path: 'tauler', element: <Dashboard />, handle: { titleKey: 'nav.dashboard' } },
                  // El ciclo guiado va ANTES de Ofertes, como en el menú: es el camino
                  // entero, y las demás pantallas son sus paradas.
                  { path: 'canalitzacio', element: <Canalitzacio />, handle: { titleKey: 'nav.canalitzacio', ample: true } },
                  { path: 'canalitzacio/:id', element: <CanalitzacioDetall />, handle: { titleKey: 'nav.canalitzacio' } },
                  { path: 'ofertes', element: <Ofertes />, handle: { titleKey: 'nav.offers', ample: true } },
                  { path: 'ofertes/:id', element: <OfertaDetall />, handle: { titleKey: 'nav.offers' } },
                  { path: 'aprovacions', element: <Aprovacions />, handle: { titleKey: 'nav.approvals' } },
                  { path: 'productors', element: <Productors />, handle: { titleKey: 'nav.producers', ample: true } },
                  { path: 'productors/nou', element: <FitxaRegistre tabla="productores" />, handle: { titleKey: 'nav.producers' } },
                  { path: 'productors/:id', element: <FitxaRegistre tabla="productores" />, handle: { titleKey: 'nav.producers' } },
                  { path: 'entitats', element: <Entitats />, handle: { titleKey: 'nav.entities', ample: true } },
                  { path: 'entitats/nova', element: <FitxaRegistre tabla="entidades" />, handle: { titleKey: 'nav.entities' } },
                  { path: 'entitats/:id', element: <FitxaRegistre tabla="entidades" />, handle: { titleKey: 'nav.entities' } },
                  { path: 'missatgeria', element: <Missatgeria />, handle: { titleKey: 'nav.messaging', fullBleed: true } },
                  { path: 'documents', element: <Documents />, handle: { titleKey: 'nav.documents', ample: true } },
                  { path: 'albarans', element: <Albarans />, handle: { titleKey: 'nav.albarans', ample: true } },
                  { path: 'albarans/:id', element: <AlbaraDetall />, handle: { titleKey: 'nav.albarans' } },
                  { path: 'espigolades', element: <Espigolades />, handle: { titleKey: 'nav.espigolades', ample: true } },
                  { path: 'espigolades/nova', element: <NovaEspigolada />, handle: { titleKey: 'nav.espigolades' } },
                  { path: 'espigolades/:id', element: <EspigoladaDetall />, handle: { titleKey: 'nav.espigolades' } },
                  { path: 'tancament', element: <Tancament />, handle: { titleKey: 'nav.tancament', ample: true } },
                  { path: 'tancament/:id', element: <TancamentDetall />, handle: { titleKey: 'nav.tancament', ample: true } },
                  { path: 'costos', element: <Costos />, handle: { titleKey: 'nav.costos', ample: true } },
                  { path: 'convenis', element: <Convenis />, handle: { titleKey: 'nav.convenis', ample: true } },
                  { path: 'convenis/campanya', element: <CampanyaConvenis />, handle: { titleKey: 'nav.convenis', ample: true } },
                  { path: 'convenis/:id', element: <ConveniDetall />, handle: { titleKey: 'nav.convenis' } },
                  { path: 'diagnostics', element: <Diagnostics />, handle: { titleKey: 'nav.diagnostics', ample: true } },
                  // `:tipus` decide el cuestionario y la tabla de la ficha; la pantalla lo
                  // valida antes de llamar a nada, para que una URL a mano no acabe en un
                  // `22023` de la RPC.
                  { path: 'diagnostics/:tipus/:id', element: <DiagnosticDetall />, handle: { titleKey: 'nav.diagnostics' } },
                  { path: 'missatgeria/:phone', element: <Missatgeria />, handle: { titleKey: 'nav.messaging', fullBleed: true } },
                  { path: 'configuracio', element: <Settings />, handle: { titleKey: 'nav.settings' } },
                ],
              },
              {
                path: '/productor',
                element: <RoleGuard rol="productor" />,
                children: [
                  { index: true, element: <Navigate to="/productor/inici" replace /> },
                  { path: 'inici', element: <ProductorInici />, handle: { titleKey: 'nav.home' } },
                  { path: 'ofertes', element: <ProductorOfertes />, handle: { titleKey: 'nav.my_offers' } },
                  { path: 'ofertes/nova', element: <NovaOferta />, handle: { titleKey: 'nav.new_offer' } },
                  { path: 'ofertes/:id', element: <ProductorOfertaDetall />, handle: { titleKey: 'nav.my_offers' } },
                  // `key` explícita: los dos «perfil» tienen la misma forma de match y sin
                  // ella React reutiliza la instancia entre paneles, arrastrando el estado
                  // de la organización anterior.
                  { path: 'documents', element: <ProductorDocuments />, handle: { titleKey: 'nav.my_documents' } },
                  // La ficha vive ahora en `/organitzacio`, fuera de los paneles. Estas
                  // dos rutas se quedan como redirección: hay enlaces y marcadores hechos.
                  { path: 'perfil', element: <Navigate to="/organitzacio" replace /> },
                ],
              },
              {
                path: '/receptor',
                element: <RoleGuard rol="receptor" />,
                children: [
                  { index: true, element: <Navigate to="/receptor/mercat" replace /> },
                  { path: 'mercat', element: <Mercat />, handle: { titleKey: 'nav.market' } },
                  { path: 'interessos', element: <Interessos />, handle: { titleKey: 'nav.my_interests' } },
                  { path: 'historic', element: <Historic />, handle: { titleKey: 'nav.history' } },
                  { path: 'documents', element: <ReceptorDocuments />, handle: { titleKey: 'nav.entity_documents' } },
                  { path: 'perfil', element: <Navigate to="/organitzacio" replace /> },
                ],
              },
            ],
          },
        ],
      },

      // Ruta desconocida → landing. Con sesión, la landing reenvía sola a /panell.
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
