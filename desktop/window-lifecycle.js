'use strict';

function makeDismissable(window, options = {}) {
  const platform = options.platform || process.platform;
  const isQuitting = options.isQuitting || (() => false);
  const dismiss = () => {
    if (window && !window.isDestroyed()) window.hide();
  };

  window.webContents.on('before-input-event', (event, input = {}) => {
    if (platform === 'darwin' && input.meta && !input.alt && !input.control &&
        String(input.key || '').toLowerCase() === 'w') {
      event.preventDefault();
      dismiss();
    }
  });
  window.on('close', event => {
    if (isQuitting()) return;
    event.preventDefault();
    dismiss();
  });
  return window;
}

module.exports = { makeDismissable };
