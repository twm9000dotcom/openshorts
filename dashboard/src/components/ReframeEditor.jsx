import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Loader2, Crosshair, RotateCcw, AlertCircle, Play, Pause, ArrowUpDown, Copy } from 'lucide-react';
import { getApiUrl } from '../config';
import { apiJson } from '../lib/api';

// Manual reframing, per scene (a scene is one camera; scenes left alone keep
// the automatic framing). Three modes:
//   - automatic: whatever the pipeline chose;
//   - single:    one 9:16 window, slid left/right over the source;
//   - top+bottom: two boxes, each exactly half of the output frame (9:8 for a
//     9:16 clip), dragged anywhere and resized freely, stacked top over bottom.
// A live preview beside the source draws the stitched result as you go.
//
// Override values sent to /api/clip/reframe (fractions of the source):
//   number                                  -> single window centre x
//   { top: {x, y, w}, bottom: {x, y, w} }   -> box centres + width
// (w is the crop width / source width; the height follows from the half's
// aspect, which the backend reports as split_half_aspect.)

const fmt = (s) => {
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, '0')}`;
};

const TOP_COLOR = 'var(--color-accent, #e0a43a)';
const BOTTOM_COLOR = '#38bdf8';
const MIN_BOX_W = 0.08;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const r4 = (v) => Number(Number(v).toFixed(4));

export default function ReframeEditor({ jobId, clipIndex, clipTitle, onClose, onReframed }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [overrides, setOverrides] = useState({});   // idx -> number | {top,bottom}
    const [active, setActive] = useState(0);          // selected scene index
    const [playing, setPlaying] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await apiJson(`/api/clip/${jobId}/${clipIndex}/scenes`);
                if (!alive) return;
                setData(res);
                // Start from what is already applied: a re-render rebuilds from
                // source with only what it receives, so opening blank would
                // quietly discard every earlier adjustment on the next save.
                const saved = res.saved_overrides || {};
                setOverrides(Object.fromEntries(
                    Object.entries(saved).map(([k, v]) => [Number(k), v])
                ));
            } catch (e) {
                if (alive) setError(e?.message || 'Could not read the scenes of this clip.');
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [jobId, clipIndex]);

    // --- geometry (all in fractions of the source frame) -------------------
    const W = data?.source_width || 1920;
    const H = data?.source_height || 1080;
    const singleW = data?.crop_width_fraction ?? 0.3164;
    const halfAspect = data?.split_half_aspect ?? 1.125;   // box width / height, in pixels
    // Box height as a fraction of source height, for a box of width fw.
    const heightOf = useCallback((fw) => fw * (W / H) / halfAspect, [W, H, halfAspect]);
    // Widest box that still fits the frame height.
    const maxBoxW = Math.min(1, H * halfAspect / W);

    const fitBox = useCallback((b) => {
        let w = Math.min(maxBoxW, Math.max(MIN_BOX_W, Number(b.w) || maxBoxW));
        const h = heightOf(w);
        const x = Math.min(1 - w / 2, Math.max(w / 2, Number(b.x)));
        const y = Math.min(1 - h / 2, Math.max(h / 2, Number(b.y)));
        return { x, y, w };
    }, [heightOf, maxBoxW]);

    // Saved splits from before boxes had a size: give them the old automatic
    // size (80% of the source height) so they open where they were.
    const normaliseSplit = useCallback((v) => {
        const legacyW = Math.min(maxBoxW, 0.8 * H * halfAspect / W);
        const half = (h) => (h && typeof h === 'object'
            ? fitBox({ x: h.x ?? 0.5, y: h.y ?? 0.5, w: h.w ?? legacyW })
            : fitBox({ x: Number(h) || 0.5, y: 0.5, w: legacyW }));
        return { top: half(v.top), bottom: half(v.bottom) };
    }, [fitBox, maxBoxW, H, W, halfAspect]);

    const scenes = data?.scenes || [];
    const scene = scenes.find((s) => s.index === active) || scenes[0];
    const raw = scene ? overrides[scene.index] : undefined;
    const mode = raw == null ? 'auto' : (typeof raw === 'object' ? 'split' : 'single');
    const split = mode === 'split' ? normaliseSplit(raw) : null;
    const singleX = mode === 'single'
        ? Math.min(1 - singleW / 2, Math.max(singleW / 2, Number(raw)))
        : null;

    const setSceneValue = useCallback((idx, v) => {
        setOverrides((o) => {
            const next = { ...o };
            if (v == null) delete next[idx]; else next[idx] = v;
            return next;
        });
    }, []);

    const setMode = (m) => {
        if (!scene) return;
        if (m === 'auto') return setSceneValue(scene.index, null);
        if (m === 'single') {
            return setSceneValue(scene.index, clamp01(scene.suggested_center ?? 0.5));
        }
        // Default stack for a stream: the whole picture on top, a tighter box
        // on the detected face below. Both are then free to move and resize.
        const faceX = scene.suggested_center ?? 0.5;
        const faceY = scene.suggested_center_y ?? 0.5;
        setSceneValue(scene.index, {
            top: fitBox({ x: 0.5, y: 0.5, w: maxBoxW }),
            bottom: fitBox({ x: faceX, y: faceY, w: Math.max(MIN_BOX_W, maxBoxW * 0.4) }),
        });
    };

    const updateHalf = useCallback((which, box) => {
        if (!scene) return;
        setOverrides((o) => {
            const cur = o[scene.index];
            if (!cur || typeof cur !== 'object') return o;
            const base = normaliseSplit(cur);
            return { ...o, [scene.index]: { ...base, [which]: fitBox(box) } };
        });
    }, [scene, fitBox, normaliseSplit]);

    const swap = () => {
        if (!split) return;
        setSceneValue(scene.index, { top: split.bottom, bottom: split.top });
    };

    const copyToAll = () => {
        if (raw == null) return;
        setOverrides(Object.fromEntries(scenes.map((s) => [s.index, raw])));
    };

    const adjusted = Object.keys(overrides).length;

    const handleSave = async () => {
        if (!adjusted || saving) return;
        setSaving(true);
        setError(null);
        try {
            const payload = Object.fromEntries(Object.entries(overrides).map(([k, v]) => {
                if (v && typeof v === 'object') {
                    const s = normaliseSplit(v);
                    const half = (b) => ({ x: r4(b.x), y: r4(b.y), w: r4(b.w) });
                    return [String(k), { top: half(s.top), bottom: half(s.bottom) }];
                }
                return [String(k), r4(v)];
            }));
            const res = await apiJson('/api/clip/reframe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ job_id: jobId, clip_index: clipIndex, crop_overrides: payload }),
            });
            if (onReframed) onReframed(clipIndex, res);
            onClose();
        } catch (e) {
            setError(e?.message || 'The re-render failed.');
        } finally {
            setSaving(false);
        }
    };

    // --- media: one uncropped preview of the clip, seeked per scene --------
    const videoRef = useRef(null);
    const imgRef = useRef(null);
    const [videoReady, setVideoReady] = useState(false);
    const [frameTick, setFrameTick] = useState(0);   // bumps when a new frame is on screen

    useEffect(() => {
        const v = videoRef.current;
        if (!v || !scene) return;
        setPlaying(false);
        v.pause();
        const target = scene.start + Math.min(0.5, (scene.end - scene.start) / 2);
        if (v.readyState >= 1) v.currentTime = target;
        else v.addEventListener('loadedmetadata', () => { v.currentTime = target; }, { once: true });
    }, [scene?.index, videoReady]);   // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const v = videoRef.current;
        if (!v || !scene) return;
        if (!playing) { v.pause(); return; }
        if (v.currentTime < scene.start || v.currentTime >= scene.end - 0.05) v.currentTime = scene.start;
        v.play().catch(() => setPlaying(false));
        const stopAtEnd = () => { if (v.currentTime >= scene.end) { v.pause(); setPlaying(false); } };
        v.addEventListener('timeupdate', stopAtEnd);
        return () => v.removeEventListener('timeupdate', stopAtEnd);
    }, [playing, scene]);

    const mediaEl = () => (videoReady && videoRef.current?.readyState >= 2
        ? videoRef.current : imgRef.current);

    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="card w-full max-w-6xl max-h-[96vh] sm:max-h-[94vh] flex flex-col rounded-b-none sm:rounded-card animate-sheet-up sm:animate-none">
                <div className="flex items-center justify-between p-4 border-b border-rule">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <Crosshair size={18} className="text-brass shrink-0" />
                        <div className="min-w-0">
                            <h2 className="text-base font-medium text-ink lowercase truncate">reframing</h2>
                            {clipTitle && <p className="text-xs text-muted truncate">{clipTitle}</p>}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-paper3 rounded-input transition-colors" aria-label="close">
                        <X size={18} className="text-muted" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar p-4 space-y-4">
                    {loading && (
                        <div className="flex items-center gap-2 text-sm text-muted py-12 justify-center">
                            <Loader2 size={18} className="animate-spin text-brass" />
                            reading the scenes… (this can take half a minute)
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-2 text-xs text-warn border border-warn/40 rounded-input p-3">
                            <AlertCircle size={14} className="shrink-0 mt-0.5" />
                            <span>{error}</span>
                        </div>
                    )}

                    {scene && (
                        <>
                            {/* Scene tabs */}
                            {scenes.length > 1 && (
                                <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                                    {scenes.map((s) => {
                                        const v = overrides[s.index];
                                        const tag = v == null ? 'auto' : (typeof v === 'object' ? 'top+bottom' : 'single');
                                        return (
                                            <button
                                                key={s.index}
                                                onClick={() => setActive(s.index)}
                                                className={`shrink-0 text-left px-3 py-1.5 rounded-input border text-xs transition-colors ${
                                                    s.index === scene.index ? 'border-brass bg-paper3 text-ink' : 'border-rule text-muted hover:text-ink2'}`}
                                            >
                                                <span className="block">scene {s.index + 1} · {fmt(s.start)}–{fmt(s.end)}</span>
                                                <span className={`block text-[10px] ${v == null ? 'text-muted' : 'text-brass'}`}>{tag}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Mode + actions */}
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="inline-flex rounded-input border border-rule overflow-hidden text-xs" role="group" aria-label="framing mode">
                                    {[['auto', 'automatic'], ['single', 'single crop'], ['split', 'top + bottom']].map(([m, label]) => (
                                        <button
                                            key={m}
                                            onClick={() => setMode(m)}
                                            className={`px-3 py-1.5 transition-colors ${mode === m ? 'bg-brass text-paper' : 'text-ink2 hover:bg-paper3'}`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-xs">
                                    {mode === 'split' && (
                                        <button onClick={swap} className="flex items-center gap-1 text-ink2 hover:text-brass">
                                            <ArrowUpDown size={13} /> swap top / bottom
                                        </button>
                                    )}
                                    {scenes.length > 1 && mode !== 'auto' && (
                                        <button onClick={copyToAll} className="flex items-center gap-1 text-ink2 hover:text-brass"
                                                title="apply this scene's framing to every scene of the clip">
                                            <Copy size={13} /> use for all scenes
                                        </button>
                                    )}
                                    {mode !== 'auto' && (
                                        <button onClick={() => setMode('auto')} className="flex items-center gap-1 text-muted hover:text-ink2">
                                            <RotateCcw size={13} /> reset scene
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Source stage + live 9:16 preview */}
                            <div className="flex flex-col md:flex-row gap-4 items-start">
                                <div className="flex-1 min-w-0 w-full space-y-2">
                                    <Stage
                                        mode={mode}
                                        split={split}
                                        singleX={singleX}
                                        singleW={singleW}
                                        heightOf={heightOf}
                                        maxBoxW={maxBoxW}
                                        onSingle={(x) => setSceneValue(scene.index,
                                            Math.min(1 - singleW / 2, Math.max(singleW / 2, x)))}
                                        onHalf={updateHalf}
                                    >
                                        {data.preview_url && (
                                            <video
                                                ref={videoRef}
                                                src={getApiUrl(data.preview_url)}
                                                playsInline
                                                preload="auto"
                                                onLoadedData={() => setVideoReady(true)}
                                                onSeeked={() => setFrameTick((t) => t + 1)}
                                                className={`w-full block ${videoReady ? '' : 'hidden'}`}
                                            />
                                        )}
                                        <img
                                            ref={imgRef}
                                            src={scene.thumbnail_url ? getApiUrl(scene.thumbnail_url) : undefined}
                                            alt=""
                                            draggable={false}
                                            onLoad={() => setFrameTick((t) => t + 1)}
                                            className={`w-full block pointer-events-none ${videoReady ? 'hidden' : ''}`}
                                        />
                                    </Stage>
                                    <div className="flex items-center gap-3 text-xs text-muted">
                                        <button
                                            onClick={() => setPlaying((p) => !p)}
                                            disabled={!videoReady}
                                            className="flex items-center gap-1 text-ink2 hover:text-brass disabled:opacity-40"
                                        >
                                            {playing ? <Pause size={13} /> : <Play size={13} />}
                                            {playing ? 'pause' : 'play scene'}
                                        </button>
                                        <span className="readout">scene {scene.index + 1} · {fmt(scene.start)}–{fmt(scene.end)}</span>
                                        {!videoReady && data.preview_url && <span className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> loading preview…</span>}
                                    </div>
                                    <p className="text-[11px] text-muted leading-snug">
                                        {mode === 'split' && <>Drag a box to move it, drag its corner (or scroll over it) to resize. <span style={{ color: TOP_COLOR }}>■ top</span> fills the upper half of the clip, <span style={{ color: BOTTOM_COLOR }}>■ bottom</span> the lower half.</>}
                                        {mode === 'single' && 'Drag the window left or right over what the clip should show.'}
                                        {mode === 'auto' && 'This scene keeps the automatic framing. Pick "top + bottom" to stack two parts of the picture, e.g. gameplay above and the facecam below.'}
                                    </p>
                                </div>

                                <div className="w-full md:w-auto flex md:block justify-center shrink-0">
                                    <div>
                                        <p className="eyebrow mb-1.5 text-center">result</p>
                                        <LivePreview
                                            mode={mode}
                                            split={split}
                                            singleX={singleX}
                                            singleW={singleW}
                                            heightOf={heightOf}
                                            mediaEl={mediaEl}
                                            playing={playing}
                                            tick={frameTick}
                                        />
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-t border-rule">
                    <span className="text-xs text-muted">
                        {adjusted === 0
                            ? 'nothing adjusted yet'
                            : `${adjusted} of ${scenes.length || adjusted} scene${(scenes.length || adjusted) > 1 ? 's' : ''} framed by hand`}
                    </span>
                    <div className="flex items-center gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
                        <button onClick={onClose} className="btn-quiet py-2 px-4 text-sm">cancel</button>
                        <button
                            onClick={handleSave}
                            disabled={!adjusted || saving}
                            className="btn-primary py-2 px-4 text-sm disabled:opacity-40"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
                            {saving ? 're-rendering…' : 'apply reframing'}
                        </button>
                    </div>
                </div>
                <div className="sm:hidden safe-bottom" />
            </div>
        </div>
    );
}


// The uncropped source with the crop boxes over it. Boxes move with pointer
// drags (mouse and touch alike); a split box also resizes from its corner
// handle or the scroll wheel, keeping the half's aspect.
function Stage({ mode, split, singleX, singleW, heightOf, maxBoxW, onSingle, onHalf, children }) {
    const stageRef = useRef(null);
    const drag = useRef(null);   // { kind, which, startX, startY, box }

    const rect = () => stageRef.current?.getBoundingClientRect();

    const onPointerDown = (kind, which, box) => (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { kind, which, startX: e.clientX, startY: e.clientY, box };
    };

    const onPointerMove = (e) => {
        const d = drag.current;
        const r = rect();
        if (!d || !r) return;
        const dx = (e.clientX - d.startX) / r.width;
        const dy = (e.clientY - d.startY) / r.height;
        if (d.kind === 'single') {
            onSingle(d.box.x + dx);
        } else if (d.kind === 'move') {
            onHalf(d.which, { ...d.box, x: d.box.x + dx, y: d.box.y + dy });
        } else if (d.kind === 'resize') {
            // Anchor the top-left corner; the pointer sets the new width.
            const left = d.box.x - d.box.w / 2;
            const top = d.box.y - heightOf(d.box.w) / 2;
            const px = (e.clientX - r.left) / r.width;
            const py = (e.clientY - r.top) / r.height;
            // Whichever axis the pointer pushed further decides the size.
            const wFromX = px - left;
            const wFromY = (py - top) / heightOf(1);
            const w = Math.min(maxBoxW, Math.max(MIN_BOX_W, Math.max(wFromX, wFromY)));
            onHalf(d.which, { x: left + w / 2, y: top + heightOf(w) / 2, w });
        }
    };

    const onPointerUp = () => { drag.current = null; };

    // Scroll over a box to resize it. A native listener: React's wheel
    // handler is passive, so it could not stop the dialog scrolling too.
    const latest = useRef({});
    latest.current = { mode, split, heightOf, maxBoxW, onHalf };
    useEffect(() => {
        const el = stageRef.current;
        if (!el) return undefined;
        const onWheel = (e) => {
            const { mode: m, split: sp, heightOf: hOf, maxBoxW: maxW, onHalf: set } = latest.current;
            if (m !== 'split' || !sp) return;
            const r = el.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width;
            const py = (e.clientY - r.top) / r.height;
            // Bottom box first: it is drawn on top when the two overlap.
            const hit = ['bottom', 'top'].find((k) => {
                const b = sp[k];
                const h = hOf(b.w);
                return Math.abs(px - b.x) <= b.w / 2 && Math.abs(py - b.y) <= h / 2;
            });
            if (!hit) return;
            e.preventDefault();
            const b = sp[hit];
            const factor = e.deltaY > 0 ? 1 / 1.06 : 1.06;
            set(hit, { ...b, w: Math.min(maxW, Math.max(MIN_BOX_W, b.w * factor)) });
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    const boxStyle = (b, color) => {
        const h = heightOf(b.w);
        return {
            left: `${(b.x - b.w / 2) * 100}%`,
            top: `${(b.y - h / 2) * 100}%`,
            width: `${b.w * 100}%`,
            height: `${h * 100}%`,
            borderColor: color,
        };
    };

    const renderSplitBox = (which, color, label) => {
        const b = split[which];
        return (
            <div
                key={which}
                onPointerDown={onPointerDown('move', which, b)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className="absolute border-2 cursor-move touch-none"
                style={boxStyle(b, color)}
            >
                <span className="absolute top-1 left-1 text-[10px] px-1 rounded text-black font-medium lowercase"
                      style={{ background: color }}>{label}</span>
                <div
                    onPointerDown={onPointerDown('resize', which, b)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    className="absolute -right-2 -bottom-2 w-4 h-4 rounded-sm border-2 border-white cursor-nwse-resize touch-none"
                    style={{ background: color }}
                    title="drag to resize"
                />
            </div>
        );
    };

    return (
        <div ref={stageRef} className="relative overflow-hidden rounded-input select-none border border-rule bg-black">
            {children}
            {/* Dimming outside the kept region(s), drawn as an SVG mask. */}
            {mode !== 'auto' && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
                    <defs>
                        <mask id="reframe-keep">
                            <rect x="0" y="0" width="100" height="100" fill="white" />
                            {mode === 'single' && (
                                <rect x={(singleX - singleW / 2) * 100} y="0" width={singleW * 100} height="100" fill="black" />
                            )}
                            {mode === 'split' && ['top', 'bottom'].map((k) => {
                                const b = split[k];
                                const h = heightOf(b.w);
                                return <rect key={k} x={(b.x - b.w / 2) * 100} y={(b.y - h / 2) * 100}
                                             width={b.w * 100} height={h * 100} fill="black" />;
                            })}
                        </mask>
                    </defs>
                    <rect x="0" y="0" width="100" height="100" fill="rgba(0,0,0,0.6)" mask="url(#reframe-keep)" />
                </svg>
            )}
            {mode === 'single' && (
                <div
                    onPointerDown={onPointerDown('single', null, { x: singleX })}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    className="absolute inset-y-0 border-2 border-brass cursor-ew-resize touch-none"
                    style={{ left: `${(singleX - singleW / 2) * 100}%`, width: `${singleW * 100}%` }}
                />
            )}
            {mode === 'split' && (
                <>
                    {renderSplitBox('top', TOP_COLOR, 'top')}
                    {renderSplitBox('bottom', BOTTOM_COLOR, 'bottom')}
                </>
            )}
        </div>
    );
}


// What the delivered clip will look like: the crop(s) drawn from the current
// frame into a 9:16 canvas, redrawn every animation frame while playing.
function LivePreview({ mode, split, singleX, singleW, heightOf, mediaEl, playing, tick }) {
    const canvasRef = useRef(null);
    const CSS_W = 180;
    const CSS_H = 320;

    const draw = useCallback(() => {
        const c = canvasRef.current;
        const el = mediaEl();
        if (!c) return;
        const dpr = window.devicePixelRatio || 1;
        if (c.width !== CSS_W * dpr) { c.width = CSS_W * dpr; c.height = CSS_H * dpr; }
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, c.width, c.height);
        const sw = el?.videoWidth || el?.naturalWidth;
        const sh = el?.videoHeight || el?.naturalHeight;
        if (!el || !sw || !sh) return;
        try {
            if (mode === 'split' && split) {
                const half = c.height / 2;
                [['top', 0], ['bottom', half]].forEach(([k, dy]) => {
                    const b = split[k];
                    const h = heightOf(b.w);
                    ctx.drawImage(el, (b.x - b.w / 2) * sw, (b.y - h / 2) * sh, b.w * sw, h * sh,
                                  0, dy, c.width, half);
                });
            } else if (mode === 'single' && singleX != null) {
                ctx.drawImage(el, (singleX - singleW / 2) * sw, 0, singleW * sw, sh, 0, 0, c.width, c.height);
            } else {
                // Automatic: show the centre 9:16 strip as a stand-in.
                const w = Math.min(1, (sh * 9 / 16) / sw);
                ctx.drawImage(el, (0.5 - w / 2) * sw, 0, w * sw, sh, 0, 0, c.width, c.height);
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.fillRect(0, c.height - 28 * dpr, c.width, 28 * dpr);
                ctx.fillStyle = '#ddd';
                ctx.font = `${11 * dpr}px system-ui, sans-serif`;
                ctx.fillText('automatic framing', 10 * dpr, c.height - 10 * dpr);
            }
        } catch {
            /* frame not decodable yet */
        }
    }, [mode, split, singleX, singleW, heightOf, mediaEl]);

    useEffect(() => { draw(); }, [draw, tick]);

    useEffect(() => {
        if (!playing) return;
        let raf;
        const loop = () => { draw(); raf = requestAnimationFrame(loop); };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [playing, draw]);

    return (
        <canvas
            ref={canvasRef}
            className="rounded-input border border-rule bg-black block"
            style={{ width: CSS_W, height: CSS_H }}
            aria-label="preview of the reframed clip"
        />
    );
}
