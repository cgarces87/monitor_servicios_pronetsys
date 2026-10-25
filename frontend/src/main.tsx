import React from 'react';
import ReactDOM from 'react-dom/client';
// Tipografia de marca (sustituta libre de Como W01 Bold), auto-hospedada.
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import { LazyMotion, MotionConfig } from 'motion/react';
import App from './App';
import './index.css';

// Motion: las features (incluidas las animaciones de layout) se cargan en un
// chunk aparte para no engordar el bundle inicial. reducedMotion="user" quita
// movimientos y cambios de posicion si el SO pide reducir animaciones.
const cargarFeatures = () => import('./motionFeatures').then((mod) => mod.domMax);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <LazyMotion features={cargarFeatures} strict>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </LazyMotion>
  </React.StrictMode>,
);
