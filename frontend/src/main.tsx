import React from 'react';
import ReactDOM from 'react-dom/client';
// Tipografia de marca (sustituta libre de Como W01 Bold), auto-hospedada.
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
