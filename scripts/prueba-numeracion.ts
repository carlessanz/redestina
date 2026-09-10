// Prueba de concurrencia de la numeración documental (incógnita B.2 del spike).
//
//   SUPABASE_URL=... SB_SECRET_KEY=... deno run -A scripts/prueba-numeracion.ts
//   … deno run -A scripts/prueba-numeracion.ts --pasadas 5 --emisiones 50 --fallos 0.2
//
// QUÉ DEMUESTRA. Una serie documental no puede tener huecos ni repeticiones: si el
// certificado de donación CD-2026-0007 no existe, la serie está rota y no se arregla a
// posteriori. `siguiente_numero()` (20260928100000) resuelve eso con un
// `insert … on conflict (serie, ejercicio) do update set ultimo = ultimo + 1`, que toma
// el bloqueo de la fila del contador y serializa a quien llegue después.
//
// La propiedad interesante es la que una `sequence` de Postgres NO tiene: si la
// transacción que pidió el número no llega a `commit`, **el número vuelve atrás**.
// `nextval()` no se deshace con el `rollback`, así que cada emisión fallida dejaría un
// hueco permanente. Por eso el 20 % de las llamadas de esta prueba levantan una
// excepción DESPUÉS de haber pedido su número (`emitir_documento_prova(true)`): lo que
// se mide es que esos números se reciclan y la serie sigue siendo 1..N sin saltos.
//
// CRITERIO DE SALIDA (§B.2 del plan de ejecución): los números de las filas que
// sobreviven son exactamente 1..N consecutivos y `max(numero) = count(*)`. Y tiene que
// pasar 5 veces seguidas, limpiando con `reiniciar_documentos_prova()` entre pasadas.
//
// SE EJECUTA CONTRA LOCAL. Con la service key: `emitir_documento_prova()` exige
// `es_super_admin()` cuando hay sesión de usuario, y deja pasar a `service_role`
// (auth.uid() null), que es quien la llama aquí y quien la llamará desde el servidor.

import { createClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------------

function argNum(nombre: string, defecto: number): number {
  const i = Deno.args.indexOf(`--${nombre}`);
  if (i === -1) return defecto;
  const v = Number(Deno.args[i + 1]);
  return Number.isFinite(v) ? v : defecto;
}

const PASADAS = argNum("pasadas", 5);
const EMISIONES = argNum("emisiones", 50);
const PROPORCION_FALLOS = argNum("fallos", 0.2);

const url = Deno.env.get("SUPABASE_URL");
const secret = Deno.env.get("SB_SECRET_KEY");
if (!url || !secret) {
  console.error("Faltan SUPABASE_URL o SB_SECRET_KEY en el entorno.");
  console.error("Contra el stack local: SUPABASE_URL=http://127.0.0.1:55321");
  Deno.exit(1);
}

const admin = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Una pasada
// ---------------------------------------------------------------------------

interface Pasada {
  n: number;
  ok: boolean;
  emitidas: number;
  fallidas: number;
  otrosErrores: string[];
  numeros: number[];
  motivo: string;
}

/** 'PROVA-2026-0042' -> 42. El correlativo es siempre el último tramo. */
function numeroDe(numeroCompleto: string): number {
  return Number(numeroCompleto.split("-").at(-1));
}

async function unaPasada(n: number): Promise<Pasada> {
  // Limpieza previa: la pasada tiene que empezar con el contador a 0 y sin documentos
  // de prueba, o el criterio 1..N no significaría nada.
  const { error: errLimpieza } = await admin.rpc("reiniciar_documentos_prova");
  if (errLimpieza) {
    return {
      n, ok: false, emitidas: 0, fallidas: 0, otrosErrores: [], numeros: [],
      motivo: `no se pudo limpiar: ${errLimpieza.message}`,
    };
  }

  // Las EMISIONES llamadas salen A LA VEZ: `Promise.all` sobre peticiones HTTP
  // independientes, cada una en su propia transacción de PostgREST. Es lo más parecido
  // a la concurrencia real que se puede montar sin un pool de conexiones propio.
  const cuantasFallan = Math.round(EMISIONES * PROPORCION_FALLOS);
  const plan = Array.from({ length: EMISIONES }, (_, i) => i < cuantasFallan);
  // Se barajan para que los fallos no queden todos al principio: lo que se quiere
  // provocar es un rollback en medio de la cola, con otros esperando el bloqueo.
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [plan[i], plan[j]] = [plan[j], plan[i]];
  }

  const resultados = await Promise.all(
    plan.map((fallar) => admin.rpc("emitir_documento_prova", { p_fallar: fallar })),
  );

  let emitidas = 0;
  let fallidas = 0;
  const otrosErrores: string[] = [];
  resultados.forEach((r, i) => {
    if (!r.error) {
      emitidas++;
      if (plan[i]) otrosErrores.push("una llamada con p_fallar=true NO falló");
      return;
    }
    // 22023 es el código con el que emitir_documento_prova simula el fallo.
    if (plan[i] && r.error.code === "22023") fallidas++;
    else otrosErrores.push(`${r.error.code ?? "?"}: ${r.error.message.slice(0, 80)}`);
  });

  // El estado final de la serie, leído de los documentos que quedan.
  const { data, error } = await admin
    .from("documentos")
    .select("numero_completo")
    .eq("serie", "PROVA")
    .order("numero_completo", { ascending: true });
  if (error) {
    return {
      n, ok: false, emitidas, fallidas, otrosErrores, numeros: [],
      motivo: `no se pudieron leer los documentos: ${error.message}`,
    };
  }

  const numeros = (data ?? []).map((f) => numeroDe(f.numero_completo)).sort((a, b) => a - b);
  const esperados = Array.from({ length: numeros.length }, (_, i) => i + 1);
  const consecutivos = numeros.length > 0 &&
    numeros.every((v, i) => v === esperados[i]);
  const maxIgualCuenta = numeros.length > 0 && numeros[numeros.length - 1] === numeros.length;
  const cuadraElRecuento = numeros.length === emitidas;

  const problemas: string[] = [];
  if (!consecutivos) {
    const huecos = esperados.filter((v) => !numeros.includes(v));
    problemas.push(`no son 1..N (faltan: ${huecos.slice(0, 10).join(", ") || "—"})`);
  }
  if (!maxIgualCuenta) problemas.push(`max=${numeros.at(-1)} ≠ count=${numeros.length}`);
  if (!cuadraElRecuento) problemas.push(`${emitidas} emisiones ok pero ${numeros.length} filas`);
  if (otrosErrores.length > 0) problemas.push(`errores inesperados: ${otrosErrores[0]}`);

  return {
    n,
    ok: problemas.length === 0,
    emitidas,
    fallidas,
    otrosErrores,
    numeros,
    motivo: problemas.join("; ") ||
      `1..${numeros.length} sin huecos (${fallidas} rollbacks reciclaron su número)`,
  };
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

console.log(
  `\nPrueba de numeración · ${PASADAS} pasadas × ${EMISIONES} emisiones ` +
    `(${Math.round(PROPORCION_FALLOS * 100)} % con rollback) contra ${url}\n`,
);

const pasadas: Pasada[] = [];
for (let i = 1; i <= PASADAS; i++) {
  const t0 = performance.now();
  const p = await unaPasada(i);
  const ms = Math.round(performance.now() - t0);
  pasadas.push(p);
  console.log(
    `${p.ok ? "  ok  " : " FALLA"}  pasada ${String(i).padStart(2)}  ` +
      `${String(p.emitidas).padStart(3)} emitidas · ${String(p.fallidas).padStart(3)} rollbacks · ` +
      `${String(ms).padStart(5)} ms  → ${p.motivo}`,
  );
}

// Se deja la base como estaba: los documentos de prueba no tienen por qué sobrevivir a
// la prueba que los creó.
const { error: errFinal } = await admin.rpc("reiniciar_documentos_prova");
if (errFinal) console.log(`\n⚠️  No se pudo limpiar al terminar: ${errFinal.message}`);

const fallidas = pasadas.filter((p) => !p.ok);
if (fallidas.length > 0) {
  console.log(
    `\n${pasadas.length - fallidas.length}/${pasadas.length} pasadas correctas. ` +
      `La numeración TIENE huecos: no se puede seguir con el sistema documental.\n`,
  );
  Deno.exit(1);
}
console.log(`\n${pasadas.length}/${pasadas.length} pasadas correctas. Numeración sin huecos.\n`);
