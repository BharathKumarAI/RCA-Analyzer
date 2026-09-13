import React, { useState, useEffect } from 'react';
import { Save, Check, AlertCircle, Download, FileCode } from 'lucide-react';
import YAML from 'yaml';
import { ConfigFileDefinition } from '../types/harness';
import { YamlDiff } from './YamlDiff';

interface YamlSynchronizerProps {
  activeFile: ConfigFileDefinition;
  onApplyChanges: (path: string, newContent: string) => void;
}

export const YamlSynchronizer: React.FC<YamlSynchronizerProps> = ({
  activeFile,
  onApplyChanges,
}) => {
  const downloadFile = () => {
    const blob = new Blob([buffer], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = activeFile.path.split('/').pop() || 'config.yaml';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const [buffer, setBuffer] = useState(activeFile.content);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setBuffer(activeFile.content);
    setSyntaxError(null);
  }, [activeFile.path, activeFile.content]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setBuffer(val);
    try {
      YAML.parse(val);
      setSyntaxError(null);
    } catch (err: any) {
      setSyntaxError(err.message);
    }
  };

  const isDirty = buffer !== activeFile.content;

  return (
    <div className="hs-yaml-editor" style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileCode size={15} style={{ color: 'var(--acc)' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600 }}>
            {activeFile.path}
          </span>
          {isDirty && <span className="hs-dirty-indicator" title="Unsaved buffer edits" />}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '11px', padding: '4px 8px' }}
            onClick={downloadFile}
            title="Download this file"
          >
            <Download size={12} />
            <span>Download</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: '11px', padding: '4px 10px' }}
            disabled={!isDirty || syntaxError !== null}
            onClick={() => setShowDiff(true)}
          >
            <Save size={12} />
            <span>Apply YAML Changes</span>
          </button>
        </div>
      </div>

      {syntaxError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontSize: '10.5px', borderBottom: '1px solid rgba(239, 68, 68, 0.3)' }}>
          <AlertCircle size={13} flex-shrink="0" />
          <span style={{ fontFamily: 'var(--font-mono)' }}>{syntaxError}</span>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <textarea
          className="hs-textarea"
          style={{
            width: '100%',
            height: '100%',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            lineHeight: 1.6,
            background: '#0d1117',
            border: 'none',
            borderRadius: 0,
            padding: '12px 16px',
            resize: 'none',
            outline: 'none',
          }}
          value={buffer}
          onChange={handleChange}
          spellCheck={false}
        />
      </div>

      {showDiff && (
        <YamlDiff
          filePath={activeFile.path}
          originalContent={activeFile.content}
          modifiedContent={buffer}
          onConfirm={() => {
            setShowDiff(false);
            onApplyChanges(activeFile.path, buffer);
          }}
          onCancel={() => setShowDiff(false)}
        />
      )}
    </div>
  );
};
