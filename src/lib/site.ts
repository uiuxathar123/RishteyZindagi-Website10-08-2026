/**
 * The site's one canonical origin, used for metadataBase, canonical URLs, robots.txt and sitemap.xml.
 * The live server redirects www.rishteyzindagi.com to the bare domain (CloudPanel vhost), so the bare domain is
 * canonical; listing www URLs in the sitemap would point search engines at redirects.
 */
export const SITE_URL = "https://rishteyzindagi.com";
