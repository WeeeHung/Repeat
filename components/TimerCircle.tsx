
import React from 'react';

interface TimerCircleProps {
  seconds: number;
  totalSeconds: number;
  label: string;
}

export const TimerCircle: React.FC<TimerCircleProps> = ({ seconds, totalSeconds, label }) => {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const progress = totalSeconds > 0 ? (totalSeconds - seconds) / totalSeconds : 0;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <div className="relative w-48 h-48 sm:w-64 sm:h-64 flex items-center justify-center">
      <svg className="absolute w-full h-full" viewBox="0 0 120 120">
        <circle
          className="text-gray-700"
          strokeWidth="8"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx="60"
          cy="60"
        />
        <circle
          className="text-cyan-400"
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx="60"
          cy="60"
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="text-center">
        <div className="text-5xl sm:text-6xl font-bold tracking-tighter">
          {seconds}
        </div>
        <div className="text-lg sm:text-xl uppercase text-gray-400 tracking-wider">
          {label}
        </div>
      </div>
    </div>
  );
};
