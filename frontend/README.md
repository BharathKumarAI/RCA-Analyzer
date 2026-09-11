# RCA Analyzer frontend

The React admin workspace uses authenticated FastAPI endpoints through the [API client](src/services/api.ts). API errors and empty responses stay visible; the UI does not substitute sample investigations, users, or connector results.

## Run locally

Start the backend from the repository root with `make dev`, then run:

```sh
cd frontend
npm ci
npm run dev
```

Open `/admin/` on the URL printed by Vite. The [development proxy](vite.config.ts) defaults to `http://127.0.0.1:8000`. To use another local API port, start Vite with `RCA_API_TARGET=http://127.0.0.1:8005 npm run dev`.

Open the session control and enter a valid deployment-issued bearer token. The server verifies the token and resolves membership; entering a token never grants roles or changes deployment scope. The token stays in memory and is cleared on page reload. See [authentication](../app/identity/auth.py) and the [session client](src/services/api.ts). For configured demo deployments, the existing [development token issuer](../scripts/issue_dev_token.py) can issue a token using an explicitly supplied private key; it refuses live mode.

## Build and verify

```sh
npm run build
npm run lint
```

The [FastAPI application](../app/api/application.py) serves the built `dist` directory at `/admin/` when it exists, with a legacy portal fallback when no build exists. Rebuild after changing the frontend before serving it through FastAPI. Run `make lint`, `make test`, and `make smoke` from the repository root for backend verification.

## Actual data versus live execution

The UI reads persisted runs, approved/draft agent configurations, parameter definitions and overrides, effective deployment configuration, and connector health from the backend. `RCA_MODE=demo` still runs the backend's simulated investigation workflow; connecting the frontend does not turn that into a live diagnosis. Live mode requires model access and the Jira/Splunk credentials described in [.env.example](../.env.example), implemented by the [Jira](../app/connectors/providers/jira.py) and [Splunk](../app/connectors/providers/splunk.py) providers.

Only the implemented read-only Jira and Splunk connectors can provide live external evidence. Database querying and other mockup connectors are unavailable. Unmeasured billing, accuracy, and latency metrics are not estimated. Configuration controls use supported backend operations; deployment-managed or unavailable operations are identified in the UI.
