import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // Compiler optimization recommendations are warnings during this migration;
  // the app does not enable the React Compiler.
  { rules: { 'react-hooks/refs': 'warn', 'react-hooks/set-state-in-effect': 'warn' } },
  globalIgnores(['.next/**', 'node_modules/**', 'next-env.d.ts']),
])
