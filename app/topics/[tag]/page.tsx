import { redirect } from 'next/navigation';

export default async function TopicRedirectPage(context: { params: Promise<{ tag: string }> }) {
  const { tag } = await context.params;
  redirect(`/?view=topics&tag=${encodeURIComponent(tag || '')}`);
}
