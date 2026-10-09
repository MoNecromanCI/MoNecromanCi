# Real-host check

Runs `@mnci/az-durable` on a **real Durable Functions host** (Azure Functions Core Tools plus Azurite), which nothing
else in this package does: the unit tests drive the typed boundary with a harness, never the SDK's replay engine.
It is run by hand, not in CI, because it needs `func` and a storage emulator and takes about a minute.

Exception to the repository's lint rules: `app.cjs` and `drive.cjs` carry `eslint-disable` (a manual harness, not shipped
code; temporary until it is ported to a gated test). Their own style is not the point; what they observe is.

## Run it

```
mkdir host && cd host
cp <this folder>/app.cjs app.js && cp <this folder>/drive.cjs drive.js && cp <this folder>/host.json .
npm init -y && npm i @azure/functions durable-functions
mkdir -p node_modules/@mnci && cp -r <repo>/packages/az-durable node_modules/@mnci/az-durable   # after `nx build az-durable`
echo '{"IsEncrypted":false,"Values":{"AzureWebJobsStorage":"UseDevelopmentStorage=true","FUNCTIONS_WORKER_RUNTIME":"node"}}' > local.settings.json
npx azurite --silent &
func start &        # wait for "Host lock lease acquired"
node drive.js
```

`package.json` needs `"main": "app.js"`. Results are in the package's `test/dogfood/FINDINGS.md`, finding 9.
