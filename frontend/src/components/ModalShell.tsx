import { useEffect, type ReactNode } from 'react';
import * as m from 'motion/react-m';

// Curva ease-out fuerte para entradas/salidas de UI.
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

interface Props {
  onClose: () => void;
  // Ancho maximo del panel (clase Tailwind), p.ej. 'max-w-md'.
  ancho?: string;
  children: ReactNode;
}

/**
 * Fondo + panel de los modales. Entra y sale con opacidad y escala 0.96 (el
 * modal no nace de un boton, asi que escala desde el centro). Para que la
 * salida se vea, el sitio que lo monta debe envolverlo en <AnimatePresence>.
 * Cierra con Escape o clic en el fondo.
 */
export function ModalShell({ onClose, ancho = 'max-w-md', children }: Props) {
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [onClose]);

  return (
    <m.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
    >
      <m.div
        role="dialog"
        aria-modal="true"
        className={`w-full ${ancho} rounded-2xl bg-white p-6 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, transform: 'scale(0.96)' }}
        animate={{ opacity: 1, transform: 'scale(1)' }}
        exit={{ opacity: 0, transform: 'scale(0.96)' }}
        transition={{ duration: 0.2, ease: EASE_OUT }}
      >
        {children}
      </m.div>
    </m.div>
  );
}
