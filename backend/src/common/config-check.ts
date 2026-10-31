/**
 * Refuses to start in production with settings that would be unsafe or broken, and says exactly
 * what to fix. Runs before anything else.
 */
export function checkProductionConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  const need = (key: string, why: string) => {
    if (!env[key]?.trim()) problems.push(`${key} is empty: ${why}`);
  };

  const jwt = env.JWT_SECRET ?? '';
  if (jwt.length < 32 || /change-me|secret|example/i.test(jwt)) {
    problems.push('JWT_SECRET must be a random string of at least 32 characters (openssl rand -hex 32)');
  }
  if (!/^[0-9a-f]{64}$/i.test(env.ENCRYPTION_KEY ?? '')) {
    problems.push('ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32). Never change it once numbers are saved.');
  }
  need('DATABASE_URL', 'the API needs its database');
  need('META_APP_SECRET', 'without it WhatsApp webhooks (delivery reports and replies) are refused');
  need('META_VERIFY_TOKEN', 'Meta needs it to confirm the webhook URL');
  if (!/^https:\/\//.test(env.PUBLIC_API_URL ?? '')) {
    problems.push('PUBLIC_API_URL must be the public https address of the API, e.g. https://app.webrand360.com/api (WhatsApp downloads campaign images from it)');
  }
  if (env.META_GRAPH_URL && !/^https:\/\/graph\.facebook\.com/.test(env.META_GRAPH_URL)) {
    problems.push('META_GRAPH_URL points to a test server; remove it in production');
  }
  if (env.AI_API_URL && !/^https:\/\//.test(env.AI_API_URL)) problems.push('AI_API_URL points to a test server; remove it');
  if (env.TEST_PROVIDER_SPEED && env.TEST_PROVIDER_SPEED !== '1') problems.push('TEST_PROVIDER_SPEED is a test setting; remove it');

  if (problems.length) {
    console.error(`\nThe API can't start in production until these settings in .env are fixed:\n\n- ${problems.join('\n- ')}\n`);
    process.exit(1);
  }
}
