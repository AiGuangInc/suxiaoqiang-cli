import inquirer from 'inquirer';
import { t } from './i18n.js';

export function validatePat(value: unknown): string {
  if (typeof value !== 'string' || !/^sup_pat_[A-Za-z0-9_-]+$/.test(value.trim())) {
    throw new Error(t('login.invalidPat'));
  }
  return value.trim();
}

export async function readPat(hidden: boolean): Promise<string> {
  if (hidden) {
    if (!process.stdin.isTTY) throw new Error(t('login.patNeedsTty'));
    const { pat } = await inquirer.prompt<{ pat: string }>([
      { type: 'password', name: 'pat', message: t('login.patPrompt'), mask: false },
    ]);
    return validatePat(pat);
  }
  let input = '';
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > 4096) throw new Error(t('login.patTooLong'));
  }
  return validatePat(input);
}
