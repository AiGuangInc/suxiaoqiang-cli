import { spawn } from 'node:child_process';

/** 跨平台打开浏览器，失败不抛错（调用方会打印 URL 供手动打开） */
export function openBrowser(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // 浏览器不可用时，调用方打印的 URL 仍可手动访问。
  }
}
