import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';
import AppContextProvider from './context/app-context.provider';
import Header from './components/layout/header';
import GlobalStyles from './styles/styles';
import { SvgIcons } from './styles/icons';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Renderer root element was not found.');
}

createRoot(container).render(
  <AppContextProvider>
    <SvgIcons />
    <GlobalStyles />
    <Header />
    <main className="main">
      <App />
    </main>
  </AppContextProvider>,
);
