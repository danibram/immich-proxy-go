import { Pause, Play, Volume2, VolumeX } from 'lucide-solid';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { api } from '~/api/client';
import { formatVideoDuration } from '~/utils/viewerFormat';

interface Props {
  assetId: string;
  duration?: string;
  posterUrl: string;
}

function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function ViewerVideoLayer(props: Props) {
  const [playing, setPlaying] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [currentTime, setCurrentTime] = createSignal(0);
  const [durationSeconds, setDurationSeconds] = createSignal(0);
  const [scrubbing, setScrubbing] = createSignal(false);
  const [muted, setMuted] = createSignal(false);
  let videoRef: HTMLVideoElement | undefined;
  let barRef: HTMLDivElement | undefined;

  createEffect(() => {
    props.assetId;
    setPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    setDurationSeconds(0);
    setScrubbing(false);
    setMuted(false);
    videoRef?.pause();
    if (videoRef) {
      videoRef.currentTime = 0;
      videoRef.muted = false;
    }
  });

  function seekToRatio(ratio: number) {
    const video = videoRef;
    if (!video || !video.duration || !Number.isFinite(video.duration)) return;

    const clamped = Math.min(1, Math.max(0, ratio));
    video.currentTime = clamped * video.duration;
    setCurrentTime(video.currentTime);
    setProgress(clamped * 100);
  }

  function seekFromPointer(clientX: number) {
    const bar = barRef;
    if (!bar) return;

    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;

    seekToRatio((clientX - rect.left) / rect.width);
  }

  function onBarPointerDown(e: PointerEvent) {
    e.stopPropagation();
    if (!barRef) return;

    setScrubbing(true);
    barRef.setPointerCapture(e.pointerId);
    seekFromPointer(e.clientX);
  }

  function onBarPointerMove(e: PointerEvent) {
    if (!scrubbing()) return;
    e.stopPropagation();
    seekFromPointer(e.clientX);
  }

  function onBarPointerUp(e: PointerEvent) {
    if (!scrubbing()) return;
    e.stopPropagation();
    setScrubbing(false);
    barRef?.releasePointerCapture(e.pointerId);
  }

  function onLoadedMetadata() {
    const video = videoRef;
    if (video?.duration && Number.isFinite(video.duration)) {
      setDurationSeconds(video.duration);
    }
  }

  function onTimeUpdate() {
    if (scrubbing()) return;

    const video = videoRef;
    if (!video || !video.duration) return;
    setCurrentTime(video.currentTime);
    setProgress((video.currentTime / video.duration) * 100);
  }

  function togglePlay(e: MouseEvent) {
    e.stopPropagation();
    const video = videoRef;
    if (!video) return;

    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }

  function toggleMute(e: MouseEvent) {
    e.stopPropagation();
    const video = videoRef;
    if (!video) return;

    video.muted = !video.muted;
    setMuted(video.muted);
  }

  function onPlay() {
    setPlaying(true);
  }

  function onPause() {
    setPlaying(false);
  }

  function onEnded() {
    setPlaying(false);
    setProgress(0);
    setCurrentTime(0);
  }

  onCleanup(() => {
    videoRef?.pause();
  });

  const durationLabel = () => {
    const duration = durationSeconds();
    const total =
      formatVideoDuration(props.duration) || (duration ? formatSeconds(duration) : '');

    if (duration) {
      return `${formatSeconds(currentTime())} / ${total}`;
    }

    return total;
  };

  return (
    <div class="vid-ctl" onClick={(e) => e.stopPropagation()}>
      <video
        ref={videoRef}
        data-testid="viewer-video"
        class="vw-img"
        src={api.getVideoUrl(props.assetId)}
        poster={props.posterUrl}
        controlsList="nodownload"
        playsinline
        preload="metadata"
        onPlay={onPlay}
        onPause={onPause}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        onClick={togglePlay}
      />

      <div class="vid-dock">
        <div class="vid-toolbar">
          <button
            type="button"
            class="vid-tool-btn"
            aria-label={playing() ? 'Pause' : 'Play'}
            onClick={togglePlay}
          >
            {playing() ? <Pause size={22} /> : <Play size={22} />}
          </button>

          <Show when={durationLabel()}>
            <div class="vid-time">{durationLabel()}</div>
          </Show>

          <button
            type="button"
            class="vid-tool-btn"
            aria-label={muted() ? 'Unmute' : 'Mute'}
            onClick={toggleMute}
          >
            {muted() ? <VolumeX size={22} /> : <Volume2 size={22} />}
          </button>
        </div>

        <div
          class="vid-bar"
          ref={barRef}
          data-testid="viewer-video-scrubber"
          onPointerDown={onBarPointerDown}
          onPointerMove={onBarPointerMove}
          onPointerUp={onBarPointerUp}
          onPointerCancel={onBarPointerUp}
        >
          <div class="vid-bar-track">
            <div class="vid-bar-rail" />
            <div
              class={`vid-fill ${scrubbing() ? 'is-scrubbing' : ''}`}
              style={{ width: `${progress()}%` }}
            />
            <div class="vid-thumb" style={{ left: `${progress()}%` }} />
            <div class="vid-end-dot" />
          </div>
        </div>
      </div>
    </div>
  );
}
