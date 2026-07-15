import { Component, createEffect, createSignal, onCleanup } from 'solid-js';

interface ProtectedImageProps {
  src: string;
  alt: string;
  class?: string;
  onLoad?: () => void;
  onError?: () => void;
}

/**
 * Renders an image to a canvas element instead of an <img> tag.
 * This makes it harder (but not impossible) to download the image via:
 * - Right-click "Save image as"
 * - Drag and drop to desktop
 * - Copy image
 */
const ProtectedImage: Component<ProtectedImageProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  const [loaded, setLoaded] = createSignal(false);

  createEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      if (!canvasRef) return;

      const ctx = canvasRef.getContext('2d');
      if (!ctx) return;

      // Set canvas dimensions to match image
      canvasRef.width = img.naturalWidth;
      canvasRef.height = img.naturalHeight;

      // Draw image to canvas
      ctx.drawImage(img, 0, 0);

      setLoaded(true);
      props.onLoad?.();
    };

    img.onerror = () => {
      console.error('Failed to load protected image:', props.src);
      // Surface the failure so the owner can retry/downgrade the URL —
      // silently staying on an empty canvas is exactly the bug this fixes.
      props.onError?.();
    };

    img.src = props.src;

    onCleanup(() => {
      img.onload = null;
      img.onerror = null;
    });
  });

  // Prevent context menu (right-click)
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    return false;
  };

  return (
    <canvas
      ref={canvasRef}
      class={props.class}
      style={{
        opacity: loaded() ? 1 : 0,
        transition: 'opacity 300ms',
        'max-width': '100%',
        'max-height': '100%',
        'object-fit': 'contain',
      }}
      onContextMenu={handleContextMenu}
      onDragStart={(e) => e.preventDefault()}
    />
  );
};

export default ProtectedImage;
