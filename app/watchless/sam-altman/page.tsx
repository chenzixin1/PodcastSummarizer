import type { Metadata } from 'next';
import WatchlessPreviewPage from '../../../components/watchless/WatchlessPreviewPage';

export const metadata: Metadata = {
  title: 'Sam Altman：如何创办一家创业公司 | PodSum.cc',
  description: '沿着 20 个场景阅读 Sam Altman 访谈的关键帧、中文编辑稿与英文 Transcript。',
};

export default function SamAltmanWatchlessPage() {
  return <WatchlessPreviewPage />;
}
