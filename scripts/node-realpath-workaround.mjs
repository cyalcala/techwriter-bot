import fs from 'node:fs';

const passthroughRealpath = (path) => path;

fs.realpathSync = passthroughRealpath;
fs.realpathSync.native = passthroughRealpath;
