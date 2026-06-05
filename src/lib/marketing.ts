export const SITE_NAME = "UPSCat";
export const SITE_DOMAIN = "upscat.click";
export const FOUNDER_EMAIL = "founder@upscat.click";
export const RIGHTS_CONTACT_EMAIL = FOUNDER_EMAIL;
export const COPYRIGHT_NOTICE = `© ${new Date().getFullYear()} ${SITE_NAME}. All original site copy, branding, and design elements are reserved.`;

export const CONTACT_LINK = `mailto:${FOUNDER_EMAIL}`;

export const FOOTER_LINKS = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;
