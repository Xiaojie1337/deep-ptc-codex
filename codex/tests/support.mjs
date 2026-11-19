import { spawnSync } from 'node:child_process';
import { codexCommand } from '../installer.mjs';
export const nativeAvailable = (() => {
  try {
    const command = codexCommand();
    return spawnSync(command.bin, [...command.prefix, 'plugin', '--help'], { encoding: 'utf8', timeout: 10000, windowsHide: true }).status === 0;
  } catch { return false; }
})();
