import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { fetchUiSettings, updateUiSettings } from '../services/api';
import type { UiSettingsConfig } from '../types/api';
export function WorkspacePresentationSettings({ onUiSettingsChanged }: { onUiSettingsChanged?: (value: UiSettingsConfig) => void }) {
  const [uiSettings, setUiSettings] = useState<UiSettingsConfig | null>(null);
  const [uiForm, setUiForm] = useState<UiSettingsConfig | null>(null);
  const [savingUi, setSavingUi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const load = async () => { try { const value = await fetchUiSettings(); setUiSettings(value); setUiForm(value); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Workspace settings could not load.'); } };
  useEffect(() => { void load(); }, []);
  async function handleSaveUiSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!uiForm || !uiSettings) return;
    setSavingUi(true);
    setError(null);
    try {
      const updated = await updateUiSettings({
        brand_name: uiForm.brand_name.trim(),
        workspace_label: uiForm.workspace_label.trim(),
        default_theme: uiForm.default_theme,
        default_page: uiForm.default_page,
        welcome_title: uiForm.welcome_title.trim(),
        welcome_description: uiForm.welcome_description.trim(),
        navigation: uiForm.navigation,
        expected_version: uiSettings.version,
      });
      setUiSettings(updated);
      setUiForm(updated);
      onUiSettingsChanged?.(updated);
      setSettingsSuccess('Workspace presentation saved and applied to this session.');
      setTimeout(() => setSettingsSuccess(null), 4500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save workspace presentation. Reload and try again.');
    } finally {
      setSavingUi(false);
    }
  }

  function moveUiNavigation(index: number, direction: -1 | 1) {
    setUiForm(current => {
      if (!current) return current;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.navigation.length) return current;
      const navigation = [...current.navigation];
      [navigation[index], navigation[nextIndex]] = [navigation[nextIndex], navigation[index]];
      return { ...current, navigation };
    });
  }

  return (
    <div className="settings-card">
      {error && (
        <div className="settings-alert settings-alert-error" role="alert">
          <span>{error}</span>
          <button className="btn btn-secondary" onClick={() => void load()}>Reload</button>
        </div>
      )}
      {settingsSuccess && (
        <div className="settings-alert settings-alert-success" role="status">
          {settingsSuccess}
        </div>
      )}
      <div className="settings-header-row">
        <div>
          <h3 className="settings-title">
            <SlidersHorizontal size={19} /> Workspace Presentation
          </h3>
          <p className="settings-subtitle">
            Customize this scoped admin workspace. Changes are persisted for this tenant and project.
          </p>
        </div>
      </div>
      {!uiForm ? (
        <p role="status">Loading workspace presentation…</p>
      ) : (
        <form onSubmit={handleSaveUiSettings} style={{ display: 'grid', gap: 18, maxWidth: 960 }}>
          <div className="settings-form-grid">
            {([
              ['brand_name', 'Brand name'],
              ['workspace_label', 'Workspace label'],
              ['welcome_title', 'Welcome title'],
            ] as const).map(([field, label]) => (
              <label key={field} className="settings-field">
                <span className="settings-field-label">{label}</span>
                <input
                  className="settings-input"
                  required
                  maxLength={field === 'welcome_title' ? 200 : 120}
                  value={uiForm[field]}
                  onChange={e => setUiForm(current => current ? { ...current, [field]: e.target.value } : current)}
                />
              </label>
            ))}
            <label className="settings-field">
              <span className="settings-field-label">Default theme</span>
              <select
                className="settings-select"
                value={uiForm.default_theme}
                onChange={e => setUiForm(current => current ? { ...current, default_theme: e.target.value as UiSettingsConfig['default_theme'] } : current)}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </label>
          </div>
          <label className="settings-field">
            <span className="settings-field-label">Welcome description</span>
            <textarea
              className="settings-textarea"
              required
              maxLength={1000}
              rows={3}
              value={uiForm.welcome_description}
              onChange={e => setUiForm(current => current ? { ...current, welcome_description: e.target.value } : current)}
              style={{ resize: 'vertical' }}
            />
          </label>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <strong style={{ color: 'var(--tx)', fontSize: 13.5 }}>Navigation Hierarchy &amp; Visibility</strong>
              <span className="settings-subtitle">Rename, reorder, or hide workspace sections.</span>
            </div>
            <div className="settings-nav-list">
              {uiForm.navigation.map((item, index) => (
                <div key={item.page} className="settings-nav-item">
                  <span className="settings-nav-order">{index + 1}</span>
                  <input
                    className="settings-input"
                    aria-label={`${item.page} navigation label`}
                    value={item.label}
                    onChange={e => setUiForm(current => current ? { ...current, navigation: current.navigation.map(nav => nav.page === item.page ? { ...nav, label: e.target.value } : nav) } : current)}
                  />
                  <input
                    className="settings-input"
                    aria-label={`${item.page} navigation description`}
                    value={item.description}
                    onChange={e => setUiForm(current => current ? { ...current, navigation: current.navigation.map(nav => nav.page === item.page ? { ...nav, description: e.target.value } : nav) } : current)}
                    placeholder="Description"
                    maxLength={240}
                  />
                  <input
                    className="settings-input"
                    aria-label={`${item.page} navigation group`}
                    value={item.group}
                    onChange={e => setUiForm(current => current ? { ...current, navigation: current.navigation.map(nav => nav.page === item.page ? { ...nav, group: e.target.value } : nav) } : current)}
                    placeholder="Group"
                    maxLength={80}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--tx)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={item.visible}
                      onChange={e => setUiForm(current => current ? { ...current, navigation: current.navigation.map(nav => nav.page === item.page ? { ...nav, visible: e.target.checked } : nav) } : current)}
                    />
                    Visible
                  </label>
                  <span className="settings-nav-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={index === 0}
                      onClick={() => moveUiNavigation(index, -1)}
                      aria-label={`Move ${item.label} up`}
                      style={{ padding: '6px 8px' }}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={index === uiForm.navigation.length - 1}
                      onClick={() => moveUiNavigation(index, 1)}
                      aria-label={`Move ${item.label} down`}
                      style={{ padding: '6px 8px' }}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="settings-actions-bar">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--tx)', marginRight: 'auto' }}>
              Default initial page:
              <select
                className="settings-select"
                value={uiForm.default_page}
                onChange={e => setUiForm(current => current ? { ...current, default_page: e.target.value } : current)}
                style={{ width: 'auto', minWidth: 160 }}
              >
                {uiForm.navigation.filter(item => item.visible).map(item => <option key={item.page} value={item.page}>{item.label}</option>)}
              </select>
            </label>
            <button type="submit" className="btn btn-primary" disabled={savingUi}>
              {savingUi ? 'Saving…' : 'Save workspace presentation'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
