// Accesos directos a las cuentas de prueba, para el login de usuarios.
//
// ⚠️ ESTO SON CREDENCIALES EN CLARO EN EL CÓDIGO DEL CLIENTE. Se acepta a propósito y con
// dos límites que no se pueden relajar:
//
//   1. NINGUNA cuenta con rol de plataforma (`usuario_roles`). Esas ven todas las fichas,
//      reales o no; el acceso del equipo es /admin, con contraseña y sin atajos.
//      Desde la fase 6 de los puntos 4-6 todas las de aquí gestionan organizaciones
//      FICTICIAS `TEST-*` (`scripts/sembrar-entitats-ficticies.ts`), y cada una ve solo la suya.
//   2. Todo el bloque va detrás de `VITE_ACCESSOS_TEST`. Con la variable apagada, Vite
//      sustituye la constante por `false`, el `&&` de LoginUsuaris queda en código muerto
//      y este módulo se cae del bundle al hacer tree-shaking. Hay que comprobarlo con un
//      grep sobre `dist/` después de compilar; no basta con confiar.
//
// Las contraseñas son las que imprimió `scripts/crear-usuarios-prueba.ts` y están también
// en `docs/usuarios-test.md` (fuera de git).

export const accessosActius = import.meta.env.VITE_ACCESSOS_TEST === 'true'

export interface AccesTest {
  /** Nombre de la organización: es lo que identifica el botón, así que va en grande. */
  organitzacio: string
  /** Qué es y qué puede hacer; va debajo, en pequeño. */
  tipus: string
  email: string
  password: string
}

export interface GrupAccessos {
  titolKey: string
  comptes: AccesTest[]
}

export const GRUPS_ACCESSOS: GrupAccessos[] = [
  {
    // La cuenta de pruebas de Carles: externa, creada aparte (`scripts/crear-usuarios-whatsapp.ts`),
    // no la suya del equipo, que entra por /admin. Desde la fase 6 de los puntos 4-6 (vaciado del
    // clon y siembra de organizaciones ficticias, `scripts/sembrar-entitats-ficticies.ts`) gestiona
    // el Obrador de prova. Las otras cuatro del grupo (Sebas, Raquel, Anna y Laura) y la del
    // Obrador de antes se quedaron sin organización y se retiraron de aquí: su botón llevaba a
    // `/sense-acces`. El doble rol de prueba no está porque su contraseña no está en el arnés.
    titolKey: 'test.grp_wa',
    comptes: [
      { organitzacio: 'Obrador de prova (maquila)', tipus: 'Entitat de transformació', email: 'hola+wa-carles@carlessanz.com', password: 'I4261-jWy0M-yefs7' },
    ],
  },
  // Un solo usuario por organización: el producto no tiene cargos dentro de la empresa,
  // todos sus usuarios ven el mismo panel. Había pares titular/operador y se retiraron.
  {
    titolKey: 'test.grp_prod',
    comptes: [
      { organitzacio: 'Ofertant de prova', tipus: 'Entitat productora', email: 'hola+prodowner-masprova@carlessanz.com', password: 'PyaCL-ia5jD-E6Ba9' },
      { organitzacio: 'Segon ofertant de prova', tipus: 'Entitat productora', email: 'hola+prodowner-hortaprova@carlessanz.com', password: 'VUQPK-k4sLa-hSZWE' },
    ],
  },
  // Sin receptor de alimentación animal: esa línea de servicio no se usa todavía.
  {
    titolKey: 'test.grp_rec',
    comptes: [
      { organitzacio: 'Entitat social receptora de prova', tipus: 'Entitat social', email: 'hola+recowner-social@carlessanz.com', password: 'UDBib-ABb7Y-eaqMg' },
      { organitzacio: 'Empresa receptora de prova', tipus: 'Empresa (compra i maquila)', email: 'hola+recowner-comercial@carlessanz.com', password: 'FmJMZ-QJzC4-r7aYg' },
    ],
  },
]
