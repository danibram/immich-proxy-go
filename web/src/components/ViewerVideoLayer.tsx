import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { api } from '~/api/client';
import { formatVideoDuration } from '~/utils/viewerFormat';

interface Props {
  assetId: string;
  duration?: string;
  posterUrl: string;
}

export default function ViewerVideoLayer(props: Props) {
  const [playing, setPlaying] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  let videoRef: HTMLVideoElement | undefined;

  createEffect(() => {
    props.assetId;
    setPlaying(false);
    setProgress(0);
    videoRef?.pause();
    if (videoRef) videoRef.currentTime = 0;
  });

  function onTimeUpdate() {
    const video = videoRef;
    if (!video || !video.duration) return;
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

  function onPlay() {
    setPlaying(true);
  }

  function onPause() {
    setPlaying(false);
  }

  function onEnded() {
    setPlaying(false);
    setProgress(0);
  }

  onCleanup(() => {
    videoRef?.pause();
  });

  const durationLabel = () => {
    if (playing()) return 'Playing';
    return formatVideoDuration(props.duration) || '';
  };

  return (
    <div class="vid-ctl" onClick={(e) => e.stopPropagation()}>
      <video
        ref={videoRef}
        data-testid="viewer-video"
        class="vw-img"
        src={api.getVideoUrl(props.assetId)}
        poster={props.posterUrl}
        controls
        controlsList="nodownload"
        playsinline
        preload="metadata"
        onPlay={onPlay}
        onPause={onPause}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        onClick={togglePlay}
      />
      <div class="vid-bar">
        <div class="vid-fill" style={{ width: `${progress()}%` }} />
      </div>
      <Show when={durationLabel()}>
        <div class="vid-time">{durationLabel()}</div>
      </Show>
    </div>
  );
}
