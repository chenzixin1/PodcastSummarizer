import { redirect } from 'next/navigation';

export default function MySummariesRedirectPage() {
  redirect('/?view=my');
}
