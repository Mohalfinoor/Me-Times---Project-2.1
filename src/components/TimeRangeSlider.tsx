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

  const getCoords = (mins: number) => {
    const pct = mins / 1440;
    const totalLength = 840 + Math.PI * 30 + 840; // 1774.2477
    const dist = pct * totalLength;

    if (dist <= 840) {
      // Top track: goes right to left
      const x = 920 - dist;
      const y = 90;
      return { x, y };
    } else if (dist <= 840 + Math.PI * 30) {
      // Left arc
      const arcDist = dist - 840;
      const theta = arcDist / 30; // radius 30
      const x = 80 - 30 * Math.sin(theta);
      const y = 120 - 30 * Math.cos(theta);
      return { x, y };
    } else {
      // Bottom track: goes left to right
      const bottomDist = dist - 840 - Math.PI * 30;
      const x = 80 + bottomDist;
      const y = 150;
      return { x, y };
    }
  };

  const getMinsFromCoords = (clientX: number, clientY: number): number => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    // Map to 1000x240 coordinates
    const xVal = (px / rect.width) * 1000;
    const yVal = (py / rect.height) * 240;

    // 1. Top segment
    const x1 = Math.max(80, Math.min(920, xVal));
    const y1 = 90;
    const d1 = (xVal - x1) ** 2 + (yVal - y1) ** 2;

    // 2. Arc segment
    const dx = xVal - 80;
    const dy = yVal - 120;
    let theta = Math.atan2(-dx, -dy);
    if (theta < 0) {
      theta = dy < 0 ? 0 : Math.PI;
    }
    const x2 = 80 - 30 * Math.sin(theta);
    const y2 = 120 - 30 * Math.cos(theta);
    const d2 = (xVal - x2) ** 2 + (yVal - y2) ** 2;

    // 3. Bottom segment
    const x3 = Math.max(80, Math.min(920, xVal));
    const y3 = 150;
    const d3 = (xVal - x3) ** 2 + (yVal - y3) ** 2;

    let dist = 0;
    if (d1 <= d2 && d1 <= d3) {
      dist = 920 - x1;
    } else if (d2 <= d1 && d2 <= d3) {
      dist = 840 + theta * 30;
    } else {
      dist = 840 + Math.PI * 30 + (x3 - 80);
    }

    const totalLength = 840 + Math.PI * 30 + 840;
    let mins = (dist / totalLength) * 1440;
    mins = Math.round(mins / 5) * 5;
    return Math.max(0, Math.min(1440, mins));
  };

  const handlePointerDown = (handle: 'start' | 'end', e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch (err) {
      // ignore
    }
    setActiveHandle(handle);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activeHandle) return;
    let mins = getMinsFromCoords(e.clientX, e.clientY);

    if (activeHandle === 'start') {
      if (mins >= endMins) {
        mins = endMins - 5;
      }
      onChange(minutesToTime(mins), minutesToTime(endMins));
    } else {
      if (mins <= startMins) {
        mins = startMins + 5;
      }
      onChange(minutesToTime(startMins), minutesToTime(mins));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!activeHandle) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (err) {
      // ignore
    }
    setActiveHandle(null);
  };

  // Convert minutes into percentages of the slider width
  const startCoords = getCoords(startMins);
  const endCoords = getCoords(endMins);

  const totalLength = 840 + Math.PI * 30 + 840;
  const startDist = (startMins / 1440) * totalLength;
  const endDist = (endMins / 1440) * totalLength;

  const midX = (startCoords.x + endCoords.x) / 2;
  const midY = (startCoords.y + endCoords.y) / 2;

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

  return (
    <div id="time-range-slider-container" className="w-full py-2 select-none">
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
      <div 
        ref={trackRef}
        className={`relative w-full aspect-[1000/240] rounded-[48px] border-2 overflow-visible select-none cursor-pointer p-0 transition-colors duration-300 ${
          isNight 
            ? 'bg-zinc-900/40 border-white/10' 
            : 'bg-zinc-200/50 border-zinc-300/40' // Soft light grey frame exactly matching the screenshot vibe
        }`}
        style={{ touchAction: 'none' }}
        onClick={(e) => {
          if (!trackRef.current) return;
          const clickMins = getMinsFromCoords(e.clientX, e.clientY);
          
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
        <svg 
          viewBox="0 0 1000 240" 
          className="absolute inset-0 w-full h-full p-0 m-0 overflow-visible pointer-events-none select-none"
        >
          {/* Top labels */}
          <text x="920" y="44" textAnchor="middle" className={`font-mono font-black text-[24px] uppercase tracking-wider ${isNight ? 'fill-zinc-500' : 'fill-zinc-450 text-[#8e9095]'}`}>00:00</text>
          <text x="500" y="44" textAnchor="middle" className={`font-mono font-black text-[24px] uppercase tracking-wider ${isNight ? 'fill-zinc-500' : 'fill-zinc-450 text-[#8e9095]'}`}>06:00</text>
          <text x="80" y="44" textAnchor="middle" className={`font-mono font-black text-[24px] uppercase tracking-wider ${isNight ? 'fill-zinc-500' : 'fill-zinc-450 text-[#8e9095]'}`}>12:00</text>
          
          {/* Bottom labels */}
          <text x="80" y="206" textAnchor="middle" className={`font-mono font-black text-[24px] uppercase tracking-wider ${isNight ? 'fill-zinc-500' : 'fill-zinc-450 text-[#8e9095]'}`}>12:00</text>
          <text x="500" y="206" textAnchor="middle" className={`font-mono font-black text-[24px] uppercase tracking-wider ${isNight ? 'fill-zinc-500' : 'fill-zinc-450 text-[#8e9095]'}`}>18:00</text>
          <text x="920" y="206" textAnchor="middle" className={`font-mono font-black text-[24px] uppercase tracking-wider ${isNight ? 'fill-zinc-500' : 'fill-zinc-450 text-[#8e9095]'}`}>24:00</text>

          {/* Semicircular Hairpin / Loop Track */}
          <path 
            d="M 920,90 L 80,90 A 30 30 0 0 0 80 150 L 920,150" 
            fill="none" 
            stroke={isNight ? '#3f3f46' : '#ffffff'} 
            strokeWidth="24" 
            strokeLinecap="round" 
            className="transition-colors duration-300"
          />

          {/* Active Highlight Range of Path */}
          <path 
            d="M 920,90 L 80,90 A 30 30 0 0 0 80 150 L 920,150" 
            fill="none" 
            stroke={isNight ? '#ffffff' : '#18181b'} 
            strokeWidth="24" 
            strokeLinecap="round" 
            strokeDasharray={`${endDist - startDist} ${totalLength}`}
            strokeDashoffset={-startDist}
            className="transition-all duration-75"
          />
        </svg>

        {/* Start Handle */}
        <div 
          className="absolute w-10 h-10 -ml-5 -mt-5 rounded-full bg-white border-[4px] border-zinc-900 shadow-md flex items-center justify-center cursor-grab active:cursor-grabbing hover:scale-105 transition-all duration-75 select-none touch-none"
          style={{ 
            left: `${startCoords.x / 10}%`, 
            top: `${startCoords.y / 2.4}%`,
            zIndex: activeHandle === 'start' ? 30 : 10
          }}
          onPointerDown={(e) => handlePointerDown('start', e)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-300" />
        </div>

        {/* End Handle */}
        <div 
          className="absolute w-10 h-10 -ml-5 -mt-5 rounded-full bg-white border-[4px] border-zinc-900 shadow-md flex items-center justify-center cursor-grab active:cursor-grabbing hover:scale-105 transition-all duration-75 select-none touch-none"
          style={{ 
            left: `${endCoords.x / 10}%`, 
            top: `${endCoords.y / 2.4}%`,
            zIndex: activeHandle === 'end' ? 30 : 10
          }}
          onPointerDown={(e) => handlePointerDown('end', e)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-300" />
        </div>

        {/* Unified Capsule Tooltip sitting elegantly over current coordinates */}
        <div 
          className="absolute px-4 py-2 bg-[#18181b] text-white font-mono font-black text-xs sm:text-[13px] rounded-full shadow-2xl pointer-events-none select-none transition-all duration-75 -translate-x-1/2"
          style={{ 
            left: `${midX / 10}%`, 
            top: `${midY / 2.4}%`,
            transform: 'translate(-50%, -46px)'
          }}
        >
          {startTime} - {endTime}
        </div>
      </div>
    </div>
  );
};
