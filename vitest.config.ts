import { defineConfig } from 'vitest/config';

/**
 * Two things worth knowing:
 *
 *  - `globals: true`, so the suites use bare describe/it/expect rather than
 *    importing them into every file.
 *  - the `'./Foo.js' -> './Foo'` alias. The sources use ESM-style specifiers
 *    that point at the *compiled* name; vite resolves them against the .ts
 *    originals.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/__tests__/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            enabled: true,
            reportsDirectory: 'coverage',
            reporter: ['text', 'lcov'],
            include: ['src/**'],
            exclude: ['src/**/__tests__/**']
        }
    },
    resolve: {
        alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' }]
    }
});
