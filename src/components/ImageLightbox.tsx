import { useEffect, useState } from 'react'
import { Download, ExternalLink, Search, X } from 'lucide-react'

export function ImageLightbox({
  src,
  onClose,
}: {
  src: string
  onClose: () => void
}) {
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="img-lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <div className="img-lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          title={zoom > 1 ? 'Zoom normal' : 'Ampliar'}
          onClick={() => setZoom((z) => (z > 1 ? 1 : 1.6))}
        >
          <Search size={18} />
        </button>
        <a href={src} download="nexo-imagem" title="Baixar">
          <Download size={18} />
        </a>
        <a href={src} target="_blank" rel="noreferrer" title="Abrir">
          <ExternalLink size={18} />
        </a>
        <button type="button" title="Fechar" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <img
        src={src}
        alt="anexo ampliado"
        style={{ transform: `scale(${zoom})` }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
