'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import type { SignInResponse } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const AUTH_DEBUG_ENABLED = process.env.NEXT_PUBLIC_DEBUG_LOGS === 'true';

function logAuthDebug(message: string, payload?: unknown) {
  if (!AUTH_DEBUG_ENABLED) {
    return;
  }
  console.log(message, payload ?? '');
}

export default function SignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loginStatus, setLoginStatus] = useState<'idle' | 'success' | 'failed'>('idle');
  const [debugInfo, setDebugInfo] = useState<SignInResponse | { error: string } | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/my';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    setLoginStatus('idle');
    setDebugInfo(null);

    try {
      logAuthDebug('开始登录，callbackUrl:', callbackUrl);
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      logAuthDebug('登录结果:', result);
      setDebugInfo(result ?? null);

      if (result?.error) {
        setError('Invalid email or password');
        setLoginStatus('failed');
        logAuthDebug('登录失败:', result.error);
      } else if (result?.url) {
        setLoginStatus('success');
        logAuthDebug('登录成功，准备跳转到:', result.url);
        // 延迟3秒显示成功状态，然后跳转
        setTimeout(() => {
          if (result.url) {
            window.location.href = result.url;
          }
        }, 3000);
      } else if (result?.ok) {
        setLoginStatus('success');
        logAuthDebug('登录成功，准备跳转到:', callbackUrl);
        // 延迟3秒显示成功状态，然后跳转
        setTimeout(() => {
          router.push(callbackUrl);
        }, 3000);
      } else {
        setError('Unknown login result');
        setLoginStatus('failed');
        logAuthDebug('未知登录结果:', result);
      }
    } catch (error) {
      console.error('登录异常:', error);
      setError('An error occurred during sign in');
      setLoginStatus('failed');
      setDebugInfo({ error: String(error) });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setIsLoading(true);
    setLoginStatus('idle');
    setDebugInfo(null);
    
    try {
      logAuthDebug('开始Google登录，callbackUrl:', callbackUrl);
      const result = await signIn('google', {
        callbackUrl,
        redirect: false,
      });
      
      logAuthDebug('Google登录结果:', result);
      setDebugInfo(result ?? null);
      
      if (result?.error) {
        setError('Failed to sign in with Google');
        setLoginStatus('failed');
      } else if (result?.url) {
        setLoginStatus('success');
        logAuthDebug('Google登录成功，准备跳转到:', result.url);
        setTimeout(() => {
          if (result.url) {
            window.location.href = result.url;
          }
        }, 3000);
      } else {
        setError('Unknown Google login result');
        setLoginStatus('failed');
      }
    } catch (error) {
      console.error('Google登录异常:', error);
      setError('An error occurred during Google sign in');
      setLoginStatus('failed');
      setDebugInfo({ error: String(error) });
    } finally {
      setIsLoading(false);
    }
  };

  // 显示登录状态页面
  if (loginStatus === 'success') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="max-w-md w-full space-y-8 p-8 text-center">
          <div className="bg-green-900/50 border border-green-500 text-green-200 px-6 py-8 rounded-xl">
            <div className="text-6xl mb-4">✅</div>
            <h2 className="text-2xl font-bold mb-4">登录成功！</h2>
            <p className="mb-4">正在跳转到: <span className="text-green-400 font-mono">{callbackUrl}</span></p>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500 mx-auto mb-4"></div>
            <p className="text-sm text-green-300">3秒后自动跳转...</p>
          </div>
          
          {debugInfo && (
            <div className="bg-slate-800 p-4 rounded-lg text-left">
              <h3 className="text-sm font-bold mb-2 text-slate-300">调试信息:</h3>
              <pre className="text-xs text-slate-400 overflow-auto">
                {JSON.stringify(debugInfo, null, 2)}
              </pre>
            </div>
          )}
          
          <div className="space-y-2">
            <button
              onClick={() => router.push(callbackUrl)}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              立即跳转
            </button>
            <Link 
              href="/"
              className="block text-sm text-slate-400 hover:text-green-400"
            >
              返回首页
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (loginStatus === 'failed') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="max-w-md w-full space-y-8 p-8 text-center">
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-6 py-8 rounded-xl">
            <div className="text-6xl mb-4">❌</div>
            <h2 className="text-2xl font-bold mb-4">登录失败</h2>
            <p className="mb-4 text-red-300">{error}</p>
          </div>
          
          {debugInfo && (
            <div className="bg-slate-800 p-4 rounded-lg text-left">
              <h3 className="text-sm font-bold mb-2 text-slate-300">调试信息:</h3>
              <pre className="text-xs text-slate-400 overflow-auto">
                {JSON.stringify(debugInfo, null, 2)}
              </pre>
            </div>
          )}
          
          <div className="space-y-2">
            <button
              onClick={() => {
                setLoginStatus('idle');
                setError('');
                setDebugInfo(null);
              }}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              重新尝试登录
            </button>
            <Link 
              href="/"
              className="block text-sm text-slate-400 hover:text-red-400"
            >
              返回首页
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <Link href="/" className="text-sky-400 hover:underline text-2xl font-bold">
            PodSum.cc
          </Link>
          <h2 className="mt-6 text-3xl font-bold">Sign in to your account</h2>
          <p className="mt-2 text-sm text-slate-400">
            Or{' '}
            <Link href="/auth/signup" className="text-sky-400 hover:underline">
              create a new account
            </Link>
          </p>
          
          {/* 显示当前callbackUrl */}
          <div className="mt-4 p-3 bg-slate-800 rounded-lg">
            <p className="text-xs text-slate-400">
              登录后将跳转到: <span className="text-sky-400 font-mono break-all">{callbackUrl}</span>
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-md">
            {error}
          </div>
        )}

        {/* Google Sign In Button */}
        <div className="mt-8">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full flex justify-center items-center py-2 px-4 border border-slate-700 rounded-md shadow-sm bg-white text-slate-900 text-sm font-medium hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {isLoading ? 'Signing in...' : 'Continue with Google'}
          </button>
        </div>

        {/* Divider */}
        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-700" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-slate-900 text-slate-400">Or continue with email</span>
            </div>
          </div>
        </div>

        <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                placeholder="Enter your email"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                placeholder="Enter your password"
              />
            </div>
          </div>
          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-sky-600 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
          <div className="text-center">
            <Link href="/" className="text-sm text-slate-400 hover:text-sky-400">
              ← Back to home
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
} 
