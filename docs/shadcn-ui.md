# UI components

The Vite frontend uses shadcn/ui (New York, Radix) with Tailwind CSS 4. The installation follows the [existing Vite project guide](https://ui.shadcn.com/docs/installation/vite).

- Configuration: [components.json](../frontend/components.json).
- Components: [src/components/ui](../frontend/src/components/ui).
- Theme bridge: [shadcn.css](../frontend/src/styles/shadcn.css) maps component colors to the existing light/dark tokens. The app's `data-theme` attribute controls dark variants.
- Utilities use the `tw:` prefix. Tailwind preflight is omitted to preserve existing screens; utilities have priority over legacy element styles.
- Class merging: [utils.ts](../frontend/src/lib/utils.ts) understands the prefix. Keep component `cn` imports pointed at `@/lib/utils` when adding or updating registry components.
- [Overview](../frontend/src/pages/Overview.tsx) uses Button, Card, and Badge with existing API-backed project data. Other pages can migrate incrementally.

Installed: Button, Card, Badge, Input, Textarea, Label, Select, Checkbox, Switch, Tabs, Dialog, Alert, Table, Separator, Skeleton, Tooltip. TooltipProvider is mounted at the app root.

Add components from the frontend directory:

```sh
npx shadcn@latest add <component>
```

Use `@/components/ui/<component>` imports. Preserve semantic labels, validation, and backend save handlers when replacing existing controls. This setup does not change authentication, project scope, or backend APIs.
