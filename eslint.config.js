// ESLint 9 flat config：只做“真错”检查，不做风格约束
export default [
  {
    files: ['app/src/**/*.js', 'tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', console: 'readonly', location: 'readonly',
        fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
        clearInterval: 'readonly', requestIdleCallback: 'readonly', performance: 'readonly',
        EventSource: 'readonly', AbortController: 'readonly', ClipboardItem: 'readonly',
        navigator: 'readonly', localStorage: 'readonly', requestAnimationFrame: 'readonly',
        File: 'readonly', Blob: 'readonly', URL: 'readonly', TextDecoder: 'readonly',
        TextEncoder: 'readonly', DataView: 'readonly', Uint8Array: 'readonly', Float32Array: 'readonly',
        Int32Array: 'readonly', Float64Array: 'readonly', BigInt64Array: 'readonly', DOMException: 'readonly',
        indexedDB: 'readonly', klinecharts: 'readonly', HTMLElement: 'readonly', CustomEvent: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error'
    }
  },
  { ignores: ['app/vendor/**', 'packaging/**', 'node_modules/**'] }
];
