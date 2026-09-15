'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { PauseIcon, PlayIcon, VolumeIcon, VolumeOffIcon } from '@/app/components/icons';

interface AudioPlayerProps {
  src: string;
  title?: string;
}

const SPEEDS = [1, 1.25, 1.5];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

export default function AudioPlayer({ src, title }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (event: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    const next = Number(event.target.value);
    setCurrentTime(next);
    if (audio && Number.isFinite(next)) audio.currentTime = next;
  };

  const cycleSpeed = () => {
    const audio = audioRef.current;
    const nextIndex = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(nextIndex);
    if (audio) audio.playbackRate = SPEEDS[nextIndex];
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    const next = !isMuted;
    setIsMuted(next);
    if (audio) audio.muted = next;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause the reflection' : 'Play the reflection'}
          aria-pressed={isPlaying}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white transition-all duration-200 hover:bg-teal-800 hover:shadow-md"
        >
          {isPlaying ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-semibold text-slate-800">
              {title ?? 'Reflection audio'}
            </p>
            <p className="shrink-0 text-xs font-medium tabular-nums text-slate-500">
              {formatTime(currentTime)} / {formatTime(duration)}
            </p>
          </div>

          <div className="relative mt-2 h-2 w-full rounded-full bg-slate-200">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-teal-700"
              style={{ width: `${progress}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              disabled={duration === 0}
              aria-label="Seek through the reflection"
              aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
              className="absolute inset-0 h-2 w-full cursor-pointer appearance-none bg-transparent outline-none disabled:cursor-not-allowed [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-teal-700 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-teal-700"
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={cycleSpeed}
              aria-label={`Playback speed ${SPEEDS[speedIndex]}x - activate to change`}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-all duration-200 hover:border-slate-300 hover:text-slate-900"
            >
              {SPEEDS[speedIndex]}x
            </button>

            <button
              type="button"
              onClick={toggleMute}
              aria-label={isMuted ? 'Unmute the reflection' : 'Mute the reflection'}
              aria-pressed={isMuted}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition-all duration-200 hover:border-slate-300 hover:text-slate-900"
            >
              {isMuted ? <VolumeOffIcon className="h-4 w-4" /> : <VolumeIcon className="h-4 w-4" />}
            </button>

            <span className="text-xs text-slate-400">Playback speed and mute</span>
          </div>
        </div>
      </div>
    </div>
  );
}