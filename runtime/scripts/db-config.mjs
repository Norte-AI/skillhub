// Loopback-only development credentials; production must set a dedicated URL.
export const developmentDatabaseUrl = 'postgres://skillhub:skillhub-local-development@127.0.0.1:55432/skillhub';
export const configuredDatabaseUrl = () => process.env.SKILLHUB_DATABASE_URL || developmentDatabaseUrl;
