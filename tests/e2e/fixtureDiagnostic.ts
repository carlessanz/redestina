// El fixture del diagnóstico del productor de prueba (Mas de Prova), que el arnés
// (`scripts/comprobar-rls.ts`, A3) necesita para sus checks de lectura de las tablas de excedentes:
// Tomàquet como único principal, Tomàquet × EX (estacional, 500 kg, gestión {donacio, residu},
// destinos {donacio, venda}) y una acción «donacio» pendiente.
//
// Las E2E que tocan el diagnóstico (`diagnostic.e2e.ts`, `diagnostic-pdf.e2e.ts`) lo guardan al
// empezar (`fotoOperativa`) y lo dejan como estaba al terminar (`restauraFixtureDiagnostic`).
// Solo contra el CLON (usa `sql()`).

import { sql } from './ajuda'

const q = (s: string) => s.replace(/'/g, "''")

/** Las columnas de la Operativa que una E2E puede tocar (el trigger poda lo que no cuelga). */
const COLS = 'productos_habituales, productes_principals, varietats, volum_produccio, temporada, envasos_habituals'

/** La Operativa y las notas del diagnóstico, como JSON, para volver a ponerlas al final. */
export function fotoOperativa(prod: string): string {
  return sql(`select jsonb_build_object('op', (select to_jsonb(x) from (select ${COLS} from productores where id = '${prod}') x),
                                        'notes', (select notes from diagnostics where productor_id = '${prod}'))::text`)
}

/**
 * Deja el fixture del arnés y la Operativa de la foto (o, sin foto, Tomàquet y Carbassó como
 * habituales y Tomàquet como único principal). La cabecera de `diagnostics` se recalcula.
 */
export function restauraFixtureDiagnostic(prod: string, foto: string | null): void {
  const f = foto ? (JSON.parse(foto) as { op: Record<string, unknown> | null; notes: string | null }) : null
  if (f?.op) {
    sql(`update productores p set (${COLS}) = (select ${COLS} from jsonb_populate_record(null::productores, '${q(JSON.stringify(f.op))}'::jsonb))
          where p.id = '${prod}'`)
  } else {
    sql(`update productores set productos_habituales = '{Tomàquet,Carbassó}', productes_principals = '{Tomàquet}' where id = '${prod}'`)
  }
  sql(`begin;
    delete from diagnostic_productes where productor_id = '${prod}';
    insert into diagnostic_productes (productor_id, producte, sense_excedent) values ('${prod}', 'Tomàquet', false);
    insert into diagnostic_excedents (productor_id, producte, causa_codi, frequencia, volum_kg, gestio_actual, destins_interes)
      values ('${prod}', 'Tomàquet', 'EX', 'estacional', 500, '{donacio,residu}', '{donacio,venda}');
    insert into diagnostic_accions (excedent_id, desti, descripcio)
      select id, 'donacio', 'TEST arnes: conveni amb un banc d''aliments' from diagnostic_excedents
       where productor_id = '${prod}' and producte = 'Tomàquet' and causa_codi = 'EX';
    update diagnostics set notes = ${f?.notes ? `'${q(f.notes)}'` : 'null'},
           falten = diagnostic_falten_productor('${prod}'),
           complet = cardinality(diagnostic_falten_productor('${prod}')) = 0
     where productor_id = '${prod}';
    commit;`)
}
