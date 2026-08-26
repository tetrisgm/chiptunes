'use strict';

// The menu-bar (tray) icon: a rasterized 👾 (space invader) PNG, 36x36 = 18pt @2x, via
// createFromBuffer + scaleFactor:2. NOT a template image — we keep the alien its own colour.
const TRAY_PNG_B64 =
  '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';
function trayImage(nativeImage) {
  const image = nativeImage.createFromBuffer(Buffer.from(TRAY_PNG_B64, 'base64'), { width: 18, height: 18, scaleFactor: 2 });
  image.setTemplateImage(false);
  return image;
}

function createWallpaperTray({ Tray, Menu, nativeImage, getState, onToggle, onOpen, onFps, onSceneSeconds, onPowerSaver,
  onMotionFrozen, onAudioMuted, onLogin, onCheckForUpdates, onApplyUpdate, onQuit, onClick }) {
  const tray = new Tray(trayImage(nativeImage), '5bc40445-2e1f-4c0d-b99c-e49189e7eaad');
  tray.setToolTip('Chiptunes.app');
  let contextMenu = null;
  // Left-click opens the Portal-style popover; right-click opens the settings context menu.
  // IMPORTANT: do NOT call tray.setContextMenu() — on macOS that binds the menu to LEFT-click too,
  // which shadows the click handler so the popover never opens (owner bug: "no Portal like menu").
  // Instead we keep the menu in `contextMenu` and pop it up ourselves on right-click.
  if (onClick) tray.on('click', () => onClick(tray.getBounds()));
  tray.on('right-click', () => { if (contextMenu) tray.popUpContextMenu(contextMenu); });

  function refresh() {
    const state = getState();
    const update = state.update || {};
    const appVersion = String(state.appVersion || '?');
    const updateReady = update.phase === 'ready';
    const updateChecking = update.phase === 'checking' || update.phase === 'downloading';
    tray.setToolTip(updateReady ? 'Chiptunes.app v' + appVersion + ' — Update ready — relaunch to apply' : 'Chiptunes.app v' + appVersion);
    contextMenu = Menu.buildFromTemplate([
      { label: 'Chiptunes.app · v' + appVersion, enabled: false },
      { type: 'separator' },
      { label: 'Animated Wallpaper', type: 'checkbox', checked: state.wallpaperEnabled,
        enabled: state.wallpaperAvailable, click: item => onToggle(item.checked) },
      { label: 'Wallpaper Audio', type: 'checkbox', checked: !state.audioMuted,
        click: item => onAudioMuted(!item.checked) },
      { label: 'Freeze Motion', type: 'checkbox', checked: !!state.motionFrozen,
        enabled: state.wallpaperEnabled, click: item => onMotionFrozen(item.checked) },
      { label: 'Desktop Settings…', click: onOpen },
      { type: 'separator' },
      { label: 'Wallpaper FPS', submenu: [15, 30, 60].map(fps => ({
        label: String(fps), type: 'radio', checked: state.fpsCap === fps, click: () => onFps(fps),
      })) },
      { label: 'Scene Rotation', submenu: [10, 20, 30, 60, 120, 300].map(s => ({
        label: s < 60 ? (s + ' seconds') : ((s / 60) + (s === 60 ? ' minute' : ' minutes')),
        type: 'radio', checked: state.sceneSeconds === s, click: () => onSceneSeconds(s),
      })) },
      { label: 'Battery Saver (lower FPS on battery)', type: 'checkbox', checked: !!state.powerSaver,
        click: item => onPowerSaver(item.checked) },
      { label: 'Launch at Login', type: 'checkbox', checked: state.openAtLogin,
        click: item => onLogin(item.checked) },
      { type: 'separator' },
      updateReady
        ? { label: 'Update ready — relaunch to apply', click: onApplyUpdate }
        : { label: updateChecking ? 'Checking for Updates…' : 'Check for Updates…',
          enabled: !!update.enabled && !updateChecking, click: onCheckForUpdates },
      { type: 'separator' },
      { label: 'Quit Chiptunes.app', click: onQuit },
    ]);
  }

  refresh();
  return { tray, refresh };
}

module.exports = { createWallpaperTray };
