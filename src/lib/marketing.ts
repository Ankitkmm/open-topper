export const SITE_NAME = "UPSCat";
export const SITE_DOMAIN = "upscat.click";
export const FOUNDER_EMAIL = "founder@upscat.click";

function buildMailto(subject: string, body: string) {
  const query = new URLSearchParams({ subject, body });
  return `mailto:${FOUNDER_EMAIL}?${query.toString()}`;
}

export const WAITLIST_LINK = buildMailto(
  "UPSCat waitlist",
  "Hi, I want to join the UPSCat waitlist.\n\nName:\nCurrent stage of UPSC prep:\nWhat I want help with:\n",
);

export const HIRING_LINK = buildMailto(
  "UPSCat talent network",
  "Hi, I want to be considered for the UPSCat talent network.\n\nName:\nWhat I do:\nPortfolio/LinkedIn:\nWhy UPSCat interests me:\n",
);

export const NAV_LINKS = [
  { href: "/#pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/hiring", label: "Hiring" },
] as const;

export const FOOTER_LINKS = [
  { href: "/#pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/hiring", label: "Hiring" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;
