// Linter, acotado a UNA cosa: las reglas de los hooks de React.
//
// POR QUÉ NO ESLINT ENTERO (deuda §12.1, decidido el 14-09-2026). `tsc` ya corre con
// `strict`, `noUnusedLocals` y `noUnusedParameters`, que es de donde sale la mayor parte
// del valor de un linter en un proyecto TypeScript. Estrenar el conjunto completo de
// reglas sobre 40 componentes escritos sin él daría cientos de avisos de estilo que nadie
// va a triar, y un linter cuyos avisos se ignoran es peor que no tenerlo: enseña a
// ignorar la salida en rojo.
//
// POR QUÉ SÍ ESTAS DOS. `rules-of-hooks` y `exhaustive-deps` no son estilo: cazan errores
// que compilan y fallan en ejecución, y este repo ya los ha tenido. El patrón
// `useCallback` + `useEffect` con dependencias a mano está por todo `src/` —el Dashboard y
// las ofertas del productor, justo donde vivía la deuda §12.5— y una dependencia que falta
// ahí no da error de tipos: da una pantalla que no se refresca, o un efecto que se
// dispara en bucle.
//
// ⚠️ LA LÍNEA BASE ES CERO. Si esto empieza a dar avisos que se dejan pasar, deja de
// servir. Al añadir una regla nueva, o se arregla todo lo que saca o no se añade.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  // Nada de esto es código de la aplicación: `dist` es la salida, `supabase/functions` y
  // `scripts` son Deno (los comprueba `deno check`, §11) y `tests` tiene su propio tsconfig.
  { ignores: ['dist/**', 'dev-dist/**', 'supabase/**', 'scripts/**', 'tests/**', 'design/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Las dos que justifican que esto exista.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // Todo lo demás, apagado a propósito: o lo cubre `tsc` con más precisión, o es
      // estilo. Ver la cabecera.
      ...Object.fromEntries(
        Object.keys({ ...js.configs.recommended.rules }).map((r) => [r, 'off']),
      ),
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
)
