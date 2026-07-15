'use strict';

function trayImage(nativeImage) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">' +
    '<path fill="black" d="M2 9h2l1.2-4 2.1 8 2.2-10 2.1 10L14 7l1 2h1v2h-2.2l-1.1-2.2-2.1 6.2L9.4 9.4 7.5 16 5.1 8.1 5 11H2z"/></svg>';
  const image = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
  image.setTemplateImage(true);
  return image;
}

function createWallpaperTray({ Tray, Menu, nativeImage, getState, onToggle, onOpen, onFps, onPowerSaver, onLogin, onQuit, onClick }) {
  const tray = new Tray(trayImage(nativeImage), '5bc40445-2e1f-4c0d-b99c-e49189e7eaad');
  tray.setToolTip('Retro Rave Radio');
  // Left-click opens the Portal-style popover; the context menu stays on right-click.
  if (onClick) tray.on('click', () => onClick(tray.getBounds()));

  function refresh() {
    const state = getState();
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Animated Wallpaper', type: 'checkbox', checked: state.wallpaperEnabled,
        enabled: state.wallpaperAvailable, click: item => onToggle(item.checked) },
      { label: 'Open Radio Window', click: onOpen },
      { type: 'separator' },
      { label: 'Wallpaper FPS', submenu: [15, 30, 60].map(fps => ({
        label: String(fps), type: 'radio', checked: state.fpsCap === fps, click: () => onFps(fps),
      })) },
      { label: 'Battery Saver (lower FPS on battery)', type: 'checkbox', checked: !!state.powerSaver,
        click: item => onPowerSaver(item.checked) },
      { label: 'Launch at Login', type: 'checkbox', checked: state.openAtLogin,
        click: item => onLogin(item.checked) },
      { type: 'separator' },
      { label: 'Quit Retro Rave Radio', click: onQuit },
    ]));
  }

  refresh();
  return { tray, refresh };
}

module.exports = { createWallpaperTray };
