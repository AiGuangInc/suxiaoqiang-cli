import chalk from 'chalk';

let _debug = false;

export function setDebug(enabled: boolean): void {
  _debug = enabled;
}

export function isDebug(): boolean {
  return _debug;
}

export function debug(label: string, data?: unknown): void {
  if (!_debug) return;
  const prefix = chalk.magenta('[DEBUG]');
  if (data !== undefined) {
    console.error(`${prefix} ${chalk.dim(label)}`);
    if (typeof data === 'string') {
      console.error(chalk.dim(data));
    } else {
      console.error(chalk.dim(JSON.stringify(data, null, 2)));
    }
  } else {
    console.error(`${prefix} ${chalk.dim(label)}`);
  }
}
