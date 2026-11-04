import React from 'react';
import Icon from './icon';

interface CustomCSSProperties extends React.CSSProperties {
  WebkitAppRegion?: 'drag' | 'no-drag';
}

const Header = () => {
  const [isMaximized, setIsMaximized] = React.useState(false);

  const handleMaximize = async () => {
    try {
      if (isMaximized) {
        window.electronAPI.unmaximize();
        setIsMaximized(false);
      } else {
        window.electronAPI.maximize();
        setIsMaximized(true);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleClose = async () => {
    try {
      window.electronAPI.close();
    } catch (error) {
      console.error(error);
    }
  };

  const handleMinimize = async () => {
    try {
      window.electronAPI.minimize();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <header
      className='header'
      style={{ WebkitAppRegion: 'drag' } as CustomCSSProperties}
    >
      <h1 title='TFT GEP Capture'>
        <Icon name="owLogo" className='logo' />
        <span className="app-title">TFT GEP Capture</span>
      </h1>
      <div
        className='window-actions'
        style={{ WebkitAppRegion: 'no-drag' } as CustomCSSProperties}
      >
        <button className='icon-btn' title='Minimize window' onClick={handleMinimize}>
          <Icon name="minimizeWindow" />
        </button>
        <button className='icon-btn' title='Maximize window' onClick={handleMaximize}>
          <Icon name="maximizeWindow" />
        </button>
        <button className='icon-btn close-btn' title='Close App' onClick={handleClose}>
          <Icon name="closeWindow" />
        </button>
      </div>
    </header>
  );
};

export default Header;
