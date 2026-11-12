/** Git、npm 和浏览器子进程无需访问 superun 业务凭据。@author xiuyu.yi */
export function childEnvWithoutCredentials(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(?:SUPERUN_PAT|PRIVATE_TOKEN)$/i.test(key))
  );
}
