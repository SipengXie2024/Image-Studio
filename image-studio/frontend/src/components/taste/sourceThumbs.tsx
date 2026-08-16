import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ReadImageAsBase64 } from "../../platform/runtime/host";
import { detectImageMimeTypeFromBase64 } from "../../lib/images";

export type SourcePreviewImage = { dataURL: string; name: string };

// Thumbnail for a reference image; falls back to the file name when the path
// cannot be read (e.g. moved file, remote host). Shared by the suggestion and
// feedback dialogs.
export function SourceThumb({
  path,
  onPreview,
}: {
  path: string;
  onPreview: (image: SourcePreviewImage) => void;
}) {
  const [dataURL, setDataURL] = useState<string | null>(null);
  const name = path.split(/[\\/]/).pop() || path;

  useEffect(() => {
    let alive = true;
    ReadImageAsBase64(path)
      .then((imageB64) => {
        if (!alive || !imageB64) return;
        const mimeType = detectImageMimeTypeFromBase64(imageB64) || "image/png";
        setDataURL(`data:${mimeType};base64,${imageB64}`);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);

  if (!dataURL) {
    return <span className="taste-chip taste-chip-muted" title={path}>{name}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onPreview({ dataURL, name })}
      title={`${name} · 点击放大`}
      className="taste-source-thumb-btn"
    >
      <img src={dataURL} alt={name} className="taste-source-thumb" />
    </button>
  );
}

// Full-screen preview above a modal; Escape is intercepted in the capture
// phase so it closes the lightbox without closing the modal beneath.
export function SourceLightbox({ image, onClose }: { image: SourcePreviewImage; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="taste-lightbox" role="dialog" aria-label={image.name} onClick={onClose}>
      <img src={image.dataURL} alt={image.name} className="taste-lightbox-img" />
      <span className="taste-lightbox-name">{image.name}</span>
    </div>,
    document.body,
  );
}
