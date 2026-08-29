import { notFound } from 'next/navigation';
import WatchlessPreviewPage from '../../../../components/watchless/WatchlessPreviewPage';

export const dynamic = 'force-dynamic';

export default function WatchlessSchemeBPreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }
  return <WatchlessPreviewPage />;
}
