import React from 'react';
import { FileCode, Folder, FolderOpen, FileText } from 'lucide-react';
import { ConfigFileDefinition } from '../types/harness';

interface FileTreeExplorerProps {
  files: ConfigFileDefinition[];
  activeFilePath: string;
  onSelectFile: (path: string) => void;
}

export const FileTreeExplorer: React.FC<FileTreeExplorerProps> = ({
  files,
  activeFilePath,
  onSelectFile,
}) => {
  return (
    <div className="hs-file-tree">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', color: 'var(--muted)', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        <FolderOpen size={13} style={{ color: 'var(--acc)' }} />
        <span>Harness Workspace Files</span>
      </div>

      <div style={{ marginTop: 6 }}>
        {files.map(file => {
          const isActive = file.path === activeFilePath;
          const fileName = file.path.split('/').pop();
          const isSub = file.path.includes('/');

          return (
            <div
              key={file.path}
              className={`hs-file-item ${isActive ? 'active' : ''}`}
              style={{ paddingLeft: isSub ? 20 : 8 }}
              onClick={() => onSelectFile(file.path)}
              title={file.path}
            >
              <FileCode size={13} style={{ color: isActive ? 'var(--acc)' : undefined }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{fileName}</span>
              {file.isDirty && <span className="hs-dirty-indicator" title="Unsaved changes" />}
            </div>
          );
        })}
      </div>
    </div>
  );
};
