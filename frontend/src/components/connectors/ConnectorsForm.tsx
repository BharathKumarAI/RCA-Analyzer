import {
  useId,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Check, Info, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import type {
  ConnectorAuthProfileItem,
  ConnectorTemplateField,
  ParameterDefinitionRow,
} from "../../types/api";
import "./ConnectorsForm.css";

/** Kept for callers that still import the old label type. */
export type AuthenticationProfile = string;

export type FieldMapping = {
  id: string;
  jiraField: string;
  triageField: string;
  category: "common" | "project";
};

export type Report = {
  id: string;
  name: string;
  jql: string;
  schedule: string;
  script: string;
  template: string;
};

export type BackendReferenceEndpoint = {
  action: string;
  method: string;
  endpoint: string;
};

type TemplateValue = string | number | boolean | Record<string, unknown> | unknown[];

export type ConnectorsFormProps = {
  /** Remount with key={connectorId + revision} when switching records. */
  initialValues?: Record<string, string | number | boolean>;
  /** Legacy props are accepted for source compatibility but are not rendered in template mode. */
  initialMappings?: FieldMapping[];
  initialReports?: Report[];
  systems?: { id: string; label: string }[];
  environments?: { id: string; label: string }[];
  authenticationProfiles?: AuthenticationProfile[];
  /** Authentication metadata returned by the published connector catalog. */
  authProfiles?: ConnectorAuthProfileItem[];
  /** Declared connector field contract from the published template. */
  parameterFields?: ConnectorTemplateField[];
  /** Database-first shared values and optimistic-concurrency revisions. */
  sharedParameters?: ParameterDefinitionRow[];
  view?: 'defaults' | 'authentication';
  onDirtyChange?: (dirty: boolean) => void;
  readOnly?: boolean;
  hideHeader?: boolean;
  /** Pass real role labels from your application; authorization remains server-side. */
  readAccessLabel?: string;
  writeAccessLabel?: string;
  onSave: (data: FormData) => Promise<void>;
  /** Deprecated for template mode. Connection tests belong to saved instances. */
  onTestConnection?: (data: FormData) => Promise<string>;
  onCancel?: () => void;
  connectorName?: string;
  connectorType?: string;
  connectorBadge?: string;
  brandSubtitle?: string;
  endpointLabel?: string;
  endpointPlaceholder?: string;
  endpointName?: string;
  hasFieldMapping?: boolean;
  fieldMappingTitle?: string;
  fieldMappingDescription?: string;
  queryLabel?: string;
  monitoringQueryLabel?: string;
  queryTokenHint?: string;
  backendReference?: {
    summary: string;
    description: string;
    endpoints: BackendReferenceEndpoint[];
  };
};

function Section({
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="cf-section" aria-labelledby={id}>
      <header className="cf-section-heading">
        <div>
          <h2 id={id}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function rowValue(row: ParameterDefinitionRow | undefined, fallback: unknown): unknown {
  if (!row) return fallback;
  if (row.active_value !== undefined) return row.active_value;
  if (row.effective_value !== undefined) return row.effective_value;
  return row.default_value;
}

function fieldLabel(field: ConnectorTemplateField): string {
  return field.label || field.variable_name.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseJsonValue(value: string): TemplateValue {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isObject(parsed) || Array.isArray(parsed)) return parsed;
  } catch {
    // Keep the raw edit so the server can return the authoritative validation error.
  }
  return value;
}

function serializeValue(value: unknown, type: ConnectorTemplateField["value_type"]): string {
  if (type === "json") return typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2);
  return displayValue(value);
}

export default function ConnectorsForm({
  initialValues = {},
  authenticationProfiles = [],
  authProfiles = [],
  parameterFields = [],
  sharedParameters = [],
  view,
  onDirtyChange,
  readOnly = false,
  hideHeader = false,
  onSave,
  connectorName = "Connector",
  connectorType = "Connector",
  connectorBadge,
  brandSubtitle = "Connectors",
}: ConnectorsFormProps) {
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState<"save" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const rowsByName = useMemo(
    () => new Map(sharedParameters.map((row) => [row.variable_name, row])),
    [sharedParameters],
  );

  // Template editing exposes only controls declared by the backend. Endpoint,
  // identity, secret, scope and schedule values belong to project instances.
  const editableFields = useMemo(
    () =>
      parameterFields.filter(
        (field) =>
          field.template_editable === true &&
          field.value_type !== "secret_ref",
      ),
    [parameterFields],
  );

  const activeProfiles = useMemo(
    () => authProfiles.filter((profile) => profile.status === "active"),
    [authProfiles],
  );

  const [values, setValues] = useState<Record<string, TemplateValue>>(() => {
    const initial: Record<string, TemplateValue> = {};
    for (const field of editableFields) {
      const provided = initialValues[field.variable_name];
      const value = provided !== undefined
        ? provided
        : rowValue(rowsByName.get(field.variable_name), field.default_value);
      initial[field.variable_name] = value as TemplateValue;
    }
    return initial;
  });

  const [baseline, setBaseline] = useState(() => JSON.stringify(values));
  const dirty = JSON.stringify(values) !== baseline;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function updateValue(name: string, value: TemplateValue) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function renderField(field: ConnectorTemplateField) {
    const name = field.variable_name;
    const current = values[name] ?? "";
    const row = rowsByName.get(name);
    const label = fieldLabel(field);
    const allowedValues = field.allowed_values || row?.allowed_values || undefined;
    const isMultiSelect = field.ui_control === "multi_select" || Array.isArray(current);
    const describedBy = `${name}-description`;
    const inherited = row?.source === "platform" && row.effective_state === "INHERIT";

    return (
      <div className="cf-contract-field" key={name}>
        <div className="cf-contract-field-header">
          <label htmlFor={`contract-${name}`}>
            {label}
            {field.required && <span aria-label="required"> *</span>}
          </label>
          <span className="cf-contract-source">
            {inherited ? "Inherited" : row?.source === "project" ? "Project override" : "Platform default"}
            {row?.revision ? ` · rev ${row.revision}` : ""}
          </span>
        </div>

        {field.value_type === "boolean" ? (
          <label className="cf-contract-toggle">
            <input
              id={`contract-${name}`}
              name={name}
              type="checkbox"
              role="switch"
              checked={current === true}
              onChange={(event) => updateValue(name, event.target.checked)}
              aria-describedby={describedBy}
            />
            <span>{current === true ? "Enabled" : "Disabled"}</span>
          </label>
        ) : allowedValues && allowedValues.length > 0 && !isMultiSelect ? (
          <select
            id={`contract-${name}`}
            name={name}
            value={String(current)}
            required={field.required}
            onChange={(event) => updateValue(name, event.target.value)}
            aria-describedby={describedBy}
          >
            {field.nullable && <option value="">Use platform default</option>}
            {allowedValues.map((option) => (
              <option key={String(option)} value={String(option)}>
                {String(option)}
              </option>
            ))}
          </select>
        ) : field.value_type === "json" ? (
          <textarea
            id={`contract-${name}`}
            name={name}
            value={serializeValue(current, field.value_type)}
            rows={5}
            required={field.required}
            onChange={(event) => updateValue(name, parseJsonValue(event.target.value))}
            aria-describedby={describedBy}
          />
        ) : (
          <input
            id={`contract-${name}`}
            name={name}
            type={field.value_type === "integer" || field.value_type === "number" ? "number" : "text"}
            value={serializeValue(current, field.value_type)}
            required={field.required}
            min={field.minimum}
            max={field.maximum}
            maxLength={field.max_length}
            step={field.value_type === "integer" ? 1 : field.value_type === "number" ? "any" : undefined}
            onChange={(event) => {
              const raw = event.target.value;
              if (field.value_type === "integer") updateValue(name, raw === "" ? "" : Number(raw));
              else if (field.value_type === "number") updateValue(name, raw === "" ? "" : Number(raw));
              else updateValue(name, raw);
            }}
            aria-describedby={describedBy}
          />
        )}

        <div id={describedBy} className="cf-contract-help">
          {field.description}
          {field.minimum != null || field.maximum != null
            ? ` Allowed range: ${field.minimum ?? "no minimum"}–${field.maximum ?? "no maximum"}.`
            : ""}
        </div>
      </div>
    );
  }

  async function runSave() {
    if (busy || !form.current || !form.current.reportValidity()) return;
    setBusy("save");
    setMessage("");
    setError("");
    try {
      const data = new FormData(form.current);
      // Checkbox values are omitted when unchecked; make false explicit.
      for (const field of editableFields) {
        const current = values[field.variable_name];
        if (field.value_type === "boolean") data.set(field.variable_name, current === true ? "true" : "false");
        else if (field.value_type === "json") data.set(field.variable_name, serializeValue(current, field.value_type));
      }
      await onSave(data);
      setBaseline(JSON.stringify(values));
      setMessage("Template settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save. Your edits are still here.");
    } finally {
      setBusy(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSave();
  }

  return (
    <div className={`connector-form ${hideHeader ? "no-header" : ""}`}>
      {!hideHeader && (
        <>
          <div className="cf-brand">Connector Templates <span>{brandSubtitle}</span></div>

          <header className="cf-page-heading">
            <div>
              <h1>Connector template</h1>
              <p>{connectorName}</p>
            </div>
            <span className="cf-badge">{connectorBadge || connectorType}</span>
          </header>
        </>
      )}

      <form ref={form} onSubmit={submit} aria-busy={busy !== null}>
        <fieldset className="cf-editable" disabled={busy !== null || readOnly}>
          {view !== "defaults" && <Section
            number={2}
            title="Authentication catalog"
            description="Authentication methods are reported by the installed adapter. Credential fields are configured on saved connector instances."
          >
            {activeProfiles.length > 0 ? (
              <div className="cf-auth-catalog" aria-label="Active authentication profiles">
                {activeProfiles.map((profile) => (
                  <article className="cf-auth-profile" key={profile.id}>
                    <div className="cf-auth-profile-title">
                      <KeyRound size={14} aria-hidden="true" />
                      <strong>{profile.name || profile.id}</strong>
                      <span className="cf-auth-status"><Check size={11} /> Active</span>
                    </div>
                    <div className="cf-auth-transport">
                      {profile.transport_compatibility || "Adapter-defined transport"}
                    </div>
                    {profile.required_fields.length > 0 && (
                      <div className="cf-auth-fields">
                        <span>Required by binding:</span> {profile.required_fields.join(", ")}
                      </div>
                    )}
                    {profile.optional_fields && profile.optional_fields.length > 0 && (
                      <div className="cf-auth-fields">
                        <span>Optional:</span> {profile.optional_fields.join(", ")}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : authenticationProfiles.length > 0 ? (
              <div className="cf-auth-legacy-list">
                {authenticationProfiles.map((profile) => <span key={profile}>{profile}</span>)}
              </div>
            ) : (
              <div className="cf-empty-state"><Info size={15} /> No active authentication profiles are registered for this adapter.</div>
            )}
            <div className="cf-platform-note">
              <ShieldCheck size={15} />
              <span>This screen describes supported authentication methods and never accepts plaintext credentials.</span>
            </div>
          </Section>}

          {view !== "authentication" && <Section
            number={3}
            title="Shared parameters"
            description="Shared defaults apply wherever a project has not set its own override."
          >
            {editableFields.length > 0 ? (
              <div className="cf-contract-grid">{editableFields.map(renderField)}</div>
            ) : (
              <div className="cf-empty-state">
                <LockKeyhole size={15} />
                <span>No editable shared parameters are declared for this published template.</span>
              </div>
            )}
          </Section>}
        </fieldset>

        <div className="cf-feedback" aria-live="polite">{message}</div>
        {error && <p className="cf-error" role="alert">{error}</p>}

        {view !== "authentication" && <footer className="cf-actions">
          <button type="button" disabled={busy !== null || !dirty} onClick={() => { setValues(JSON.parse(baseline)); setError(""); setMessage(""); }}>Discard changes</button>
          <div>
            <span className="cf-action-note"><Info size={13} /> Test a saved project instance to verify a live connection.</span>
            <button type="submit" className="cf-primary" disabled={busy !== null || readOnly || !dirty}>
              {readOnly ? "Platform admin required" : busy === "save" ? "Saving…" : "Save template settings"}
            </button>
          </div>
        </footer>}
      </form>
    </div>
  );
}
