# Contributing

Thanks for considering a contribution! The project is small on purpose - here is all you need:

## Adding a provider (the main extension point)

1. Copy `providers/example.js` into `~/Library/Application Support/TokenGauge/providers/`
   (or keep it in-repo as a built-in if you want it shipped).
2. Implement the contract:

   ```js
   module.exports = {
     id: 'my-provider',                          // globally unique
     name: 'My Provider',
     fields: [{ key: 'apiKey', label: 'API Key', type: 'password' }],
     async query(credentials) {
       return { ok: true, plan: '...', tiers: [{ name: 'Monthly', utilization: 42, resetsAt: '2025-01-01T00:00:00Z' }], queriedAt: Date.now() };
     },
   };
   ```

3. Add a selftest vector in `src/selftest.ts` if your parsing has any branching logic.

## Development

```bash
npm install
make selftest    # deterministic self-tests
make smoke       # boot smoke test
```

## Pull requests

- Keep changes focused; one PR per concern.
- Run `make selftest` and `make smoke` before pushing.
- The provider contract is public API - changes to it must stay backwards compatible.
