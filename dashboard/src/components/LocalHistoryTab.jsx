import React, { useState, useEffect } from 'react';
import { Loader2, Download, Film, FolderOpen, RefreshCw } from 'lucide-react';
import { apiJson } from '../lib/api';
import { getApiUrl } from '../config';

// Self-host History: every job folder on this machine (GET /api/local/projects),
// newest first. "open" loads the finished job back into the Clip Generator.
// The cloud library (R2-backed) is HistoryTab.jsx.
export default function LocalHistoryTab({ onOpenProject }) {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(null);
  const [openError, setOpenError] = useState('');

  const load = () => {
    setError('');
    apiJson('/api/local/projects')
      .then((d) => setProjects(d.projects || []))
      .catch(() => setError('Could not load your projects.'));
  };

  useEffect(load, []);

  const handleOpen = async (jobId) => {
    if (!onOpenProject || opening) return;
    setOpening(jobId);
    setOpenError('');
    try {
      await onOpenProject(jobId);
    } catch (e) {
      setOpenError(e?.message || 'Could not open this project.');
      setOpening(null);
    }
  };

  const fmtDate = (iso) => (iso
    ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '');

  if (projects === null && !error) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brass" /></div>;
  }

  return (
    <div className="animate-fade">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-8">
        <div>
          <p className="eyebrow mb-1.5">07 · HISTORY</p>
          <h1 className="font-display lowercase text-2xl text-ink mb-2">Your projects</h1>
          <p className="text-muted text-sm lowercase">
            Every video you've clipped on this machine. Open a project to keep editing its clips.
          </p>
        </div>
        <button onClick={load} className="btn-ghost px-3 py-2 text-xs" title="Refresh">
          <RefreshCw size={14} /> refresh
        </button>
      </div>

      {error && <p className="text-danger text-sm">{error}</p>}
      {openError && <p className="text-danger text-sm mb-4">{openError}</p>}

      {projects && projects.length === 0 && (
        <div className="text-center py-20 text-muted">
          <Film size={40} className="mx-auto mb-4 text-muted" />
          <p className="lowercase">No projects yet. Generate your first short from the Clip Generator.</p>
        </div>
      )}

      <div className="space-y-10">
        {(projects || []).map((p) => (
          <section key={p.job_id}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-2 border-b border-rule">
              <div className="min-w-0">
                <p className="text-sm text-ink font-medium truncate" title={p.title}>{p.title}</p>
                <p className="readout mt-0.5">
                  {fmtDate(p.created_at)} · {p.clips.length} clip{p.clips.length === 1 ? '' : 's'}
                  {p.status !== 'completed' && ` · ${p.status}`}
                </p>
              </div>
              {p.status === 'completed' && p.clips.length > 0 && (
                <button
                  onClick={() => handleOpen(p.job_id)}
                  disabled={!!opening}
                  className="btn-ghost px-3 py-2 text-xs shrink-0"
                  title="Load this project in the Clip Generator to keep editing subtitles, hooks, framing and effects"
                >
                  {opening === p.job_id
                    ? <><Loader2 size={14} className="animate-spin" /> opening…</>
                    : <><FolderOpen size={14} /> open project</>}
                </button>
              )}
            </div>
            {p.clips.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
                {p.clips.map((c) => (
                  <div key={c.index} className="card card-hover overflow-hidden">
                    <div className="aspect-[9/16] bg-black">
                      <video src={getApiUrl(c.video_url)} controls preload="metadata" className="w-full h-full object-contain" />
                    </div>
                    <div className="p-3">
                      <p className="text-sm text-ink font-medium line-clamp-2 mb-1" title={c.title || ''}>{c.title || `Clip ${c.index + 1}`}</p>
                      <a
                        href={getApiUrl(c.video_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-micro font-mono uppercase text-brass hover:text-ink flex items-center gap-1 transition-colors"
                        title="Open the video file in a new tab (right-click to save)"
                      >
                        <Download size={14} /> Download
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
