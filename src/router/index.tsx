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
import { EspigoladaDetall, NovaEspigolada } from '../routes/equip/Espigolades'
import Confirmar from '../routes/public/Confirmar'
import Aprovacions from '../routes/equip/Aprovacions'
import { ProductorInici, ProductorOfertes } from '../routes/productor/Ofertes'
import NovaOferta from '../routes/productor/NovaOferta'
import ProductorOfertaDetall from '../routes/productor/OfertaDetall'
import PerfilOrganitzacio from '../routes/PerfilOrganitzacio'
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
              {
                path: '/equip',
                element: <RoleGuard rol="intern" />,
                children: [
                  { index: true, element: <Navigate to="/equip/tauler" replace /> },
                  { path: 'tauler', element: <Dashboard />, handle: { titleKey: 'nav.dashboard' } },
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
                  { path: 'espigolades/nova', element: <NovaEspigolada />, handle: { titleKey: 'nav.espigolades' } },
                  { path: 'espigolades/:id', element: <EspigoladaDetall />, handle: { titleKey: 'nav.espigolades' } },
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
                  { path: 'perfil', element: <PerfilOrganitzacio key="productor" tipus="productor" />, handle: { titleKey: 'nav.my_producer_org' } },
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
                  { path: 'perfil', element: <PerfilOrganitzacio key="entidad" tipus="entidad" />, handle: { titleKey: 'nav.my_entity' } },
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
