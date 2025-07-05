import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import bcrypt from 'bcryptjs'
import { sql } from '@vercel/postgres'
import { nanoid } from 'nanoid'
import type { NextAuthOptions } from 'next-auth'

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
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
  callbacks: {
    async signIn({ user, account, profile }: { user: any; account: any; profile?: any }) {
      if (account?.provider === 'google') {
        try {
          // 检查用户是否已存在
          const existingUser = await sql`
            SELECT id FROM users WHERE email = ${user.email}
          `
          
          if (existingUser.rows.length === 0) {
            // 创建新用户
            const userId = nanoid()
            await sql`
              INSERT INTO users (id, email, name, created_at)
              VALUES (${userId}, ${user.email}, ${user.name || user.email}, NOW())
            `
            user.id = userId
          } else {
            user.id = existingUser.rows[0].id
          }
        } catch (error) {
          console.error('Google sign in error:', error)
          return false
        }
      }
      return true
    },
    async jwt({ token, user }: { token: any; user: any }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async session({ session, token }: { session: any; token: any }) {
      if (token) {
        session.user.id = token.id as string
      }
      return session
    },
  },
}

export default NextAuth(authOptions) 