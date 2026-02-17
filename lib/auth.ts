import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import bcrypt from 'bcryptjs'
import { sql } from '@vercel/postgres'
import { nanoid } from 'nanoid'
import type { Account, NextAuthOptions, Profile, Session, User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { ensureUserCreditsSchema, getInitialSrtCreditsForEmail } from './db'

const resolvedNextAuthSecret = (() => {
  const secret = (process.env.NEXTAUTH_SECRET || '').trim();
  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('NEXTAUTH_SECRET must be configured in production.');
  }

  return 'dev-only-nextauth-secret';
})();

type SessionUserWithId = Session['user'] & { id?: string };

export const authOptions: NextAuthOptions = {
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      })
    ] : []),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        try {
          // 查找用户
          const result = await sql`
            SELECT id, email, password_hash, name, created_at 
            FROM users 
            WHERE email = ${credentials.email}
          `

          if (result.rows.length === 0) {
            return null
          }

          const user = result.rows[0]

          // 验证密码
          const isPasswordValid = await bcrypt.compare(credentials.password, user.password_hash)

          if (!isPasswordValid) {
            return null
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
          }
        } catch (error) {
          console.error('Auth error:', error)
          return null
        }
      }
    })
  ],
  session: {
    strategy: 'jwt' as const,
  },
  pages: {
    signIn: '/auth/signin',
  },
  secret: resolvedNextAuthSecret,
  callbacks: {
    async signIn({ user, account }: { user: User; account: Account | null; profile?: Profile }) {
      if (account?.provider === 'google') {
        try {
          const userEmail = String(user.email || '').trim().toLowerCase();
          if (!userEmail) {
            return false;
          }

          // 检查用户是否已存在
          const existingUser = await sql`
            SELECT id FROM users WHERE email = ${userEmail}
          `
          
          if (existingUser.rows.length === 0) {
            // 创建新用户
            const userId = nanoid()
            const initialCredits = getInitialSrtCreditsForEmail(userEmail)
            await ensureUserCreditsSchema()
            await sql`
              INSERT INTO users (id, email, name, password_hash, credits, created_at)
              VALUES (${userId}, ${userEmail}, ${user.name || userEmail}, '', ${initialCredits}, NOW())
            `
            user.id = userId
          } else {
            user.id = String(existingUser.rows[0].id)
          }
        } catch (error) {
          console.error('Google sign in error:', error)
          return false
        }
      }
      return true
    },
    async jwt({ token, user }: { token: JWT; user?: User }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      const sessionUser = session.user as SessionUserWithId | undefined
      if (sessionUser && token.id) {
        sessionUser.id = String(token.id)
      }
      return session
    },
  },
}

export default NextAuth(authOptions) 
