import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getWebEnv } from "./env";
import { safeEqualString } from "./auth-compare";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;
        const env = getWebEnv();
        const userOk = safeEqualString(credentials.username.trim(), env.ADMIN_USERNAME);
        const passOk = safeEqualString(credentials.password, env.ADMIN_PASSWORD);
        if (!userOk || !passOk) return null;
        return { id: env.ADMIN_USERNAME, name: env.ADMIN_USERNAME };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.name = user.name ?? user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.name = (token.name as string) ?? session.user.name;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
