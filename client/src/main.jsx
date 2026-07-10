import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import AppV2 from './v2/AppV2.jsx';
import './index.css';

// The redesign is now the DEFAULT. Open ?ui=old to fall back to the classic
// dashboard (persists), ?ui=new to return to the redesign.
const p = new URLSearchParams(location.search);
if (p.get('ui')) localStorage.setItem('ui', p.get('ui'));
const useNew = (localStorage.getItem('ui') || 'new') !== 'old';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {useNew ? <AppV2 /> : <App />}
  </React.StrictMode>
);
