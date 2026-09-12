# Production-Grade Engineering: Zero Mockups, Reuse & Extension First, Full-Stack Streamlining

## 1. Zero Mockup Policy (Real Data Only)
- **No Mockup or Dummy Data**: Never introduce hardcoded mock objects, fake arrays, dummy JSON fixtures, or simulated synthetic state into application views or client code.
- **Real Backend Endpoints Only**: All frontend interfaces, state stores, tools, and workflows must connect directly to real, authoritative backend endpoints and persistent data stores.
- **Backend-First Delivery**: If a required API endpoint, database table/model, query, or connector capability does not exist, implement the real backend functionality first (or alongside the UI) rather than stubbing it out with temporary mock data.
- **No Mock Stubs in Code**: Never commit code with "TODO: replace mock with real API" or placeholder demo payloads disguised as real data.

## 2. Reuse & Extend Existing Functionality Before Building New
- **Audit Existing Code First**: Before creating any new component, service, utility, hook, or API endpoint, conduct a thorough search across the codebase to identify existing implementations, patterns, and design primitives.
- **Extend Rather Than Duplicate**: If an existing component or backend service can fulfill the need through parameterization, composition, or backward-compatible props/options, extend the existing asset instead of building a duplicate or parallel implementation.
- **Standardized Architecture & Consistency**: Adhere strictly to the project's established design system, UI tokens, state management paradigms, connector abstractions, and API client conventions.

## 3. End-to-End Full-Stack Streamlining
- **Complete Vertical Slices**: Every feature must be delivered as a complete, fully wired vertical slice:
  1. Data model / schema & persistence / connector integration
  2. Domain logic, permissions, and validation
  3. Strongly typed API route, request/response models, and error responses
  4. Frontend API client, state synchronization, and reactive hook/store
  5. UI component with real data rendering, empty states, loading indicators, and error boundaries
- **Strict Contract Fidelity**: Frontend types and backend models/schemas must strictly match. Validate payloads at boundaries (e.g., Pydantic schemas, TypeScript interfaces).

## 4. Professional & Production-Grade Standards
- **Production-Ready Quality**: All code must meet production-grade standards immediately—clean typing, robust error handling, edge-case resilience, UTC timestamping, and appropriate logging/telemetry.
- **No Hacks or Compromises**: Avoid brittle shortcuts, monkey patches, unauthenticated backdoors, or unhandled promise rejections.
- **Testing & Verification**: Verify all changes end-to-end with tests, lints, and live smoke validation against the real system.
