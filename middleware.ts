import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

export default withAuth(
  function middleware(req) {
    // 如果用户未登录且访问受保护的路由，重定向到登录页面
    if (!req.nextauth.token && req.nextUrl.pathname.startsWith('/upload')) {
      return NextResponse.redirect(new URL('/auth/signin', req.url))
    }
    
    if (!req.nextauth.token && req.nextUrl.pathname.startsWith('/my')) {
      return NextResponse.redirect(new URL('/auth/signin', req.url))
    }
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // 对于受保护的路由，需要有效的 token
        if (req.nextUrl.pathname.startsWith('/upload') || req.nextUrl.pathname.startsWith('/my')) {
          return !!token
        }
        // 其他路由允许访问
        return true
      },
    },
  }
)

export const config = {
  matcher: ['/upload/:path*', '/my/:path*']
} 