import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const isGoogleAuthConfigured = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

export const { handlers, auth } = NextAuth({
  secret: process.env.AUTH_SECRET || "upscat-local-secret",
  trustHost: true,
  session: {
    strategy: "jwt",
  },
  providers: isGoogleAuthConfigured
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID!,
          clientSecret: process.env.AUTH_GOOGLE_SECRET!,
        }),
      ]
    : [],
  callbacks: {
    async session({ session }) {
      if (session.user?.email && !session.user.name) {
        session.user.name = session.user.email.split("@")[0];
      }
      return session;
    },
  },
});
