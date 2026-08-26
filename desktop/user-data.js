'use strict';

const fs = require('fs');
const path = require('path');

function preserveLegacyUserData(app, options = {}) {
  const fileSystem = options.fs || fs;
  const paths = options.path || path;
  const current = app.getPath('userData');
  const legacy = paths.join(app.getPath('appData'), 'chiptunes-app-desktop');
  const settings = paths.join(legacy, 'desktop-settings.json');
  if (current !== legacy && fileSystem.existsSync(settings)) {
    app.setPath('userData', legacy);
    return { path:legacy, migrated:true };
  }
  return { path:current, migrated:false };
}

module.exports = { preserveLegacyUserData };
