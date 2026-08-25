import { useState } from 'react';
import type { CreativeProject } from '../../../../src/domain/creativeProject.js';
import { humanize } from '../lib/viewModels.js';

const PROJECT_TYPES = ['song', 'album', 'score', 'sound_design', 'other'] as const;

export function ProjectsPanel({
  projects,
  selectedProjectId,
  onSelect,
  onCreate,
  creating,
}: {
  readonly projects: readonly CreativeProject[];
  readonly selectedProjectId: string | undefined;
  readonly onSelect: (projectId: string) => void;
  readonly onCreate: (input: { ownerProfileId: string; title: string; projectType: string }) => void;
  readonly creating: boolean;
}) {
  const [title, setTitle] = useState('');
  const [ownerProfileId, setOwnerProfileId] = useState('creator-1');
  const [projectType, setProjectType] = useState<(typeof PROJECT_TYPES)[number]>('song');

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p className="card__title">Projects</p>

      {projects.length === 0 ? (
        <p className="helper-text">No projects yet — create the first one below.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className="nav__item"
                aria-current={selectedProjectId === project.id ? 'page' : undefined}
                onClick={() => onSelect(project.id)}
                style={{ width: '100%', justifyContent: 'flex-start' }}
              >
                <span className="nav__label">{project.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim().length === 0 || ownerProfileId.trim().length === 0) {
            return;
          }
          onCreate({ ownerProfileId, title, projectType });
          setTitle('');
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', borderTop: '1px solid var(--surface-border)', paddingTop: 'var(--space-3)' }}
      >
        <label className="session-field">
          <span className="session-field__label">New project title</span>
          <input
            className="text-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Midnight Drive"
          />
        </label>
        <label className="session-field">
          <span className="session-field__label">Owner profile ID</span>
          <input className="text-input" value={ownerProfileId} onChange={(e) => setOwnerProfileId(e.target.value)} />
        </label>
        <label className="session-field">
          <span className="session-field__label">Project type</span>
          <select className="text-input" value={projectType} onChange={(e) => setProjectType(e.target.value as (typeof PROJECT_TYPES)[number])}>
            {PROJECT_TYPES.map((type) => (
              <option key={type} value={type}>
                {humanize(type)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn--primary" disabled={creating || title.trim().length === 0}>
          {creating ? 'Creating…' : 'Create project'}
        </button>
      </form>
    </div>
  );
}
