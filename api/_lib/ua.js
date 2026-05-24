export const CRAWLER_RE = /facebookexternalhit|meta-externalagent|facebookcatalog|Twitterbot|LinkedInBot|Slackbot(?:-LinkExpanding)?|WhatsApp|TelegramBot|Discordbot|Applebot|Pinterest|redditbot/i;

export const IG_APP_RE = /Instagram|FBAN|FBAV|FBIOS|Threads/i;

export function isCrawler(ua) {
  return !!ua && CRAWLER_RE.test(ua);
}

export function isInstagramApp(ua) {
  return !!ua && IG_APP_RE.test(ua);
}
