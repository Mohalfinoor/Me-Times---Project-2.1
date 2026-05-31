import React, { useState, useRef, useCallback } from 'react';

interface TimeRangeSliderProps {
  startTime: string;
  endTime: string;
  onChange: (startTime: string, endTime: string) => void;
  isNight?: boolean;
}

const minutesToTime = (minutes: number): string => {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const timeToMinutes = (time: string): number => {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const TimeRangeSlider: React.FC<TimeRangeSliderProps> = ({
  startTime,
  endTime,
  onChange,
  isNight = false,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeHandle, setActiveHandle] = useState<'start' | 'end' | null>(null);

  const startMins = timeToMinutes(startTime || "07:00");
  const endMins = timeToMinutes(endTime || "17:00");

  const handleStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const valMins = timeToMinutes(val);
    if (valMins >= endMins) {
      const newEndMins = Math.min(1440, valMins + 5);
      onChange(val, minutesToTime(newEndMins));
    } else {
      onChange(val, endTime);
    }
  };

  const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const valMins = timeToMinutes(val);
    if (valMins <= startMins) {
      const newStartMins = Math.max(0, valMins - 5);
      onChange(minutesToTime(newStartMins), val);
    } else {
      onChange(startTime, val);
    }
  };

  const handlePointerDown = (handle: 'start' | 'end', e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch (err) {
      // Ignore pointer capture errors if unsupported
    }
    setActiveHandle(handle);
  };

  const updateTimeFromPointer = useCallback((clientX: number, targetHandle: 'start' | 'end') => {
    if (!trackRef.current) return;

    const rect = trackRef.current.getBoundingClientRect();
    const width = rect.width || 1; // avoid division by zero
    const x = clientX - rect.left;
    
    // Convert click/drag position to percentage, clamp 0 to 1
    let pct = Math.max(0, Math.min(1, x / width));
    
    // Minutes from 0 to 1440
    let mins = pct * 1440;
    
    // Step size of 5 minutes
    const step = 5;
    mins = Math.round(mins / step) * step;
    mins = Math.max(0, Math.min(1440, mins));

    if (targetHandle === 'start') {
      // Allow start to go up to endMins - 5
      if (mins >= endMins) {
        mins = endMins - 5;
      }
      onChange(minutesToTime(mins), minutesToTime(endMins));
    } else {
      // Allow end to go down to startMins + 5
      if (mins <= startMins) {
        mins = startMins + 5;
      }
      onChange(minutesToTime(startMins), minutesToTime(mins));
    }
  }, [startMins, endMins, onChange]);

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activeHandle) return;
    updateTimeFromPointer(e.clientX, activeHandle);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!activeHandle) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (err) {
      // Ignore
    }
    setActiveHandle(null);
  };

  // Convert minutes into percentages of the slider width
  const startPct = (startMins / 1440) * 100;
  const endPct = (endMins / 1440) * 100;

  return (
    <div id="time-range-slider-container" className="w-full py-1 select-none">
      {/* Visual Display for Interval */}
      <div className={`flex justify-between items-center mb-6 border p-2 sm:p-4 rounded-2xl sm:rounded-3xl gap-1.5 sm:gap-2.5 transition-colors duration-300 ${
        isNight 
          ? 'bg-zinc-900/60 border-white/10 text-white' 
          : 'bg-zinc-50 border-zinc-100 text-zinc-900'
      }`}>
        <div className={`text-center flex-1 p-1 sm:p-2 rounded-xl sm:rounded-2xl transition-all relative ${
          isNight ? 'hover:bg-white/5' : 'hover:bg-zinc-100/50'
        }`}>
          <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-zinc-400 select-none">JAM MULAI</p>
          <input 
            type="time"
            value={startTime || "07:00"}
            onChange={handleStartChange}
            className={`font-mono font-black text-sm sm:text-lg mt-0.5 block w-full text-center bg-transparent border-none outline-none focus:ring-0 cursor-pointer ${
              isNight ? 'text-white' : 'text-zinc-900'
            }`}
          />
        </div>
        <div className={`px-2.5 py-1 rounded-full font-mono font-black text-[9px] sm:text-xs shrink-0 select-none ${
          isNight ? 'bg-white text-zinc-950' : 'bg-zinc-900 text-white'
        }`}>
          WAKTU
        </div>
        <div className={`text-center flex-1 p-1 sm:p-2 rounded-xl sm:rounded-2xl transition-all relative ${
          isNight ? 'hover:bg-white/5' : 'hover:bg-zinc-100/50'
        }`}>
          <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-zinc-400 select-none">JAM SELESAI</p>
          <input 
            type="time"
            value={endTime || "17:00"}
            onChange={handleEndChange}
            className={`font-mono font-black text-sm sm:text-lg mt-0.5 block w-full text-center bg-transparent border-none outline-none focus:ring-0 cursor-pointer ${
              isNight ? 'text-white' : 'text-zinc-900'
            }`}
          />
        </div>
      </div>

      {/* Slider Track and Handles */}
      <div className="relative pt-8 pb-3 px-4">
        <div 
          ref={trackRef}
          className={`h-3 w-full rounded-full cursor-pointer relative touch-none ${
            isNight ? 'bg-white/10' : 'bg-zinc-100'
          }`}
          onClick={(e) => {
            // Click to snap nearest handle
            if (!trackRef.current) return;
            const rect = trackRef.current.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickPct = clickX / rect.width;
            const clickMins = Math.round((clickPct * 1440) / 5) * 5;
            
            const distToStart = Math.abs(clickMins - startMins);
            const distToEnd = Math.abs(clickMins - endMins);
            
            if (distToStart < distToEnd) {
              const newStart = Math.max(0, Math.min(endMins - 5, clickMins));
              onChange(minutesToTime(newStart), minutesToTime(endMins));
            } else {
              const newEnd = Math.max(startMins + 5, Math.min(1440, clickMins));
              onChange(minutesToTime(startMins), minutesToTime(newEnd));
            }
          }}
        >
          {/* Active Highlight Range */}
          <div 
            className={`absolute h-full rounded-full transition-all duration-75 ${
              isNight ? 'bg-white' : 'bg-zinc-900'
            }`}
            style={{ 
              left: `${startPct}%`, 
              right: `${100 - endPct}%` 
            }}
          />

          {/* Left Thumb/Handle for Start Time */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 w-8 h-8 rounded-full shadow-lg cursor-grab active:cursor-grabbing z-10 flex items-center justify-center -ml-4 hover:scale-110 active:scale-95 transition-all outline-none border-[3px] ${
              isNight 
                ? 'bg-zinc-950 border-white text-white' 
                : 'bg-white border-zinc-900 text-zinc-900'
            }`}
            style={{ left: `${startPct}%` }}
            onPointerDown={(e) => handlePointerDown('start', e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {/* Soft inner core */}
            <div className={`w-2 h-2 rounded-full transition-all ${
              activeHandle === 'start' 
                ? isNight ? 'bg-white scale-125' : 'bg-zinc-900 scale-125' 
                : isNight ? 'bg-zinc-600' : 'bg-zinc-300'
            }`} />
            
            {/* Tooltip above */}
            <div className={`absolute bottom-9 left-1/2 -translate-x-1/2 px-2 py-0.5 font-mono font-black text-[10px] rounded-lg shadow-md pointer-events-none whitespace-nowrap ${
              isNight ? 'bg-white text-zinc-950' : 'bg-zinc-900 text-white'
            }`}>
              {startTime}
            </div>
          </div>

          {/* Right Thumb/Handle for End Time */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 w-8 h-8 rounded-full shadow-lg cursor-grab active:cursor-grabbing z-10 flex items-center justify-center -ml-4 hover:scale-110 active:scale-95 transition-all outline-none border-[3px] ${
              isNight 
                ? 'bg-zinc-950 border-white text-white' 
                : 'bg-white border-zinc-900 text-zinc-900'
            }`}
            style={{ left: `${endPct}%` }}
            onPointerDown={(e) => handlePointerDown('end', e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {/* Soft inner core */}
            <div className={`w-2 h-2 rounded-full transition-all ${
              activeHandle === 'end' 
                ? isNight ? 'bg-white scale-125' : 'bg-zinc-900 scale-125' 
                : isNight ? 'bg-zinc-600' : 'bg-zinc-300'
            }`} />
            
            {/* Tooltip above */}
            <div className={`absolute bottom-9 left-1/2 -translate-x-1/2 px-2 py-0.5 font-mono font-black text-[10px] rounded-lg shadow-md pointer-events-none whitespace-nowrap ${
              isNight ? 'bg-white text-zinc-950' : 'bg-zinc-900 text-white'
            }`}>
              {endTime}
            </div>
          </div>
        </div>

        {/* Time tick markers below */}
        <div className={`flex justify-between text-[9px] font-mono font-black mt-4 px-1 pointer-events-none select-none ${
          isNight ? 'text-zinc-500' : 'text-zinc-400'
        }`}>
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
      </div>
    </div>
  );
};
