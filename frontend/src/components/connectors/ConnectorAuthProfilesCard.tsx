import React from 'react';
import { Key, Lock, CheckCircle2 } from 'lucide-react';
import type { ConnectorAuthProfilesCardProps } from './types';

export const ConnectorAuthProfilesCard: React.FC<ConnectorAuthProfilesCardProps> = ({
  authProfiles,
  selectedProfileId,
  onSelectProfile,
  selectableProfileIds,
  readOnly = false,
}) => {
  return (
    <div className="prism-auth-profiles-section">
      <div style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <Key size={15} style={{ color: 'var(--acc, #2563eb)' }} />
          <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx, #0f172a)', margin: 0 }}>
            Authentication Profiles
          </h4>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--muted, #475569)', margin: 0 }}>
          Authentication methods declared by this connector. Select an available profile to configure its credential references.
        </p>
      </div>

      {/* Auth Profile Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: '12px',
          marginBottom: '14px',
        }}
      >
        {authProfiles.map(profile => {
          const isPlanned = profile.status === 'planned';
          const isBlocked = profile.status === 'disabled_by_policy';
          const isUnavailable =
            profile.status === 'active' &&
            selectableProfileIds !== undefined &&
            !selectableProfileIds.includes(profile.id);
          const isSelected = selectedProfileId === profile.id;
          const isSelectable = profile.status === 'active' && !isUnavailable && !readOnly;

          return (
            <button
              type="button"
              aria-pressed={isSelected}
              disabled={!isSelectable}
              key={profile.id}
              onClick={() => {
                if (isSelectable && onSelectProfile) {
                  onSelectProfile(profile.id);
                }
              }}
              style={{
                display: 'flex',
                textAlign: 'left',
                font: 'inherit',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: '8px',
                border: isSelected
                  ? '1.5px solid var(--acc, #2563eb)'
                  : '1px solid var(--line, #e2e8f0)',
                background: isSelected
                  ? 'rgba(37, 99, 235, 0.06)'
                  : isPlanned || isBlocked || isUnavailable
                  ? 'var(--card-subtle, #f8fafc)'
                  : 'var(--card, #ffffff)',
                boxShadow: isSelected ? '0 0 0 1px var(--acc, #2563eb)' : '0 1px 3px rgba(0, 0, 0, 0.04)',
                cursor: isSelectable ? 'pointer' : 'default',
                opacity: isPlanned || isBlocked || isUnavailable ? 0.65 : 1,
                transition: 'all 0.15s ease',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Lock size={13} style={{ color: isSelected ? 'var(--acc, #2563eb)' : 'var(--muted, #64748b)' }} />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx, #0f172a)' }}>
                      {profile.name || profile.id}
                    </span>
                  </div>
                  {isPlanned ? (
                    <span
                      style={{
                        fontSize: '10.5px',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        background: 'rgba(217, 119, 6, 0.1)',
                        border: '1px solid rgba(217, 119, 6, 0.3)',
                        color: 'var(--acc-amber)',
                        fontWeight: 600,
                      }}
                    >
                      Planned
                    </span>
                  ) : isBlocked || isUnavailable ? (
                    <span
                      style={{
                        fontSize: '10.5px',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: 'var(--acc-rose)',
                        fontWeight: 600,
                      }}
                    >
                      {isBlocked ? 'Blocked' : 'Unavailable'}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '10.5px',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        background: 'rgba(16, 185, 129, 0.1)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        color: 'var(--acc3)',
                        fontWeight: 600,
                      }}
                    >
                      Active
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '11.5px', color: 'var(--muted, #64748b)', marginBottom: '8px' }}>
                  {profile.transport_compatibility ? `Transport: ${profile.transport_compatibility}` : 'Standard HTTPS'}
                </div>

                {profile.required_fields && profile.required_fields.length > 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--muted, #475569)' }}>
                    <strong>Required:</strong> {profile.required_fields.join(', ')}
                  </div>
                )}
                {profile.optional_fields && profile.optional_fields.length > 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--muted, #475569)', marginTop: '4px' }}>
                    <strong>Optional:</strong> {profile.optional_fields.join(', ')}
                  </div>
                )}
              </div>

              {isSelected && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '8px', fontSize: '11px', color: 'var(--acc, #2563eb)', fontWeight: 600 }}>
                  <CheckCircle2 size={12} /> Selected Profile
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
