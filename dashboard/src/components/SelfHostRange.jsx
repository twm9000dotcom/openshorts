import React, { useState, useEffect } from 'react';
import { Scissors } from 'lucide-react';

// Self-host range picker: clip only part of a long video (e.g. 3:30:00 to
// 4:20:00 of a stream). The cloud picker lives in SourceCost and needs the
// metering probe; here the times are typed. For a link, only that section is
// downloaded and transcribed (SOURCE_RANGE_SECTION in main.py).

const MIN_RANGE_SECONDS = 60;

// "3:30:00", "3:30", "210" (minutes are not assumed: a bare number is seconds,
// "m:ss" is minutes, "h:mm:ss" is hours). Returns seconds or null.
function parseClock(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return NaN;
    const parts = t.split(':').map(Number);
    if (parts.slice(1).some((p) => p >= 60)) return NaN;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export default function SelfHostRange({ mode, url, onRangeChange }) {
    const [open, setOpen] = useState(false);
    const [startText, setStartText] = useState('');
    const [endText, setEndText] = useState('');

    // A new source starts as the whole video again.
    useEffect(() => {
        setOpen(false);
        setStartText('');
        setEndText('');
        onRangeChange(null);
        // onRangeChange is a setState from the parent: stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, url]);

    const start = parseClock(startText);
    const end = parseClock(endText);
    let error = '';
    if (open && (startText || endText)) {
        if (Number.isNaN(start) || Number.isNaN(end)) error = 'Use h:mm:ss, e.g. 3:30:00.';
        else if (end == null) error = 'Add an end time.';
        else if (end - (start || 0) < MIN_RANGE_SECONDS) error = 'The end must be at least 1 minute after the start.';
    }

    useEffect(() => {
        if (!open) {
            onRangeChange(null);
        } else if (error || end == null || Number.isNaN(end)) {
            // Open but not usable: block the submit rather than silently
            // clipping the whole video (MediaInput checks range.invalid).
            onRangeChange({ invalid: true });
        } else {
            onRangeChange({ start: start || 0, end });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, startText, endText, error]);

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-3 flex items-center gap-1 text-xs text-brass hover:underline lowercase"
            >
                <Scissors size={12} /> clip only part of it
            </button>
        );
    }

    const len = !error && end != null ? end - (start || 0) : null;
    const fmt = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

    return (
        <div className="mt-3 text-xs leading-relaxed animate-fade">
            <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                    <span className="eyebrow mb-1 block">from</span>
                    <input
                        type="text" inputMode="numeric" placeholder="3:30:00"
                        value={startText} onChange={(e) => setStartText(e.target.value)}
                        className="input-field !w-28 text-xs py-1.5" aria-label="start time"
                    />
                </label>
                <label className="block">
                    <span className="eyebrow mb-1 block">to</span>
                    <input
                        type="text" inputMode="numeric" placeholder="4:20:00"
                        value={endText} onChange={(e) => setEndText(e.target.value)}
                        className="input-field !w-28 text-xs py-1.5" aria-label="end time"
                    />
                </label>
                <button
                    type="button"
                    onClick={() => { setOpen(false); setStartText(''); setEndText(''); }}
                    className="flex items-center gap-1 text-brass hover:underline lowercase pb-2"
                >
                    <Scissors size={12} /> clip the whole video
                </button>
            </div>
            {error ? (
                <p className="text-warn mt-1.5">{error}</p>
            ) : len != null ? (
                <p className="text-muted mt-1.5">
                    Clips {fmt(len)} of video{mode === 'url' ? ': only this part is downloaded and transcribed' : ''}.
                    Keep it under about 3 hours.
                </p>
            ) : (
                <p className="text-muted mt-1.5">Type where to start and stop, as h:mm:ss (e.g. 3:30:00 to 4:20:00).</p>
            )}
        </div>
    );
}
