import { redirect } from 'next/navigation';

export default function PublicPodcastSummaryRedirectPage() {
  redirect('/?view=explore');
}
