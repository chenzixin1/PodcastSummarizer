import HomeWorkspace from '../components/home/HomeWorkspace';
import { parseHomeView, readSearchParam } from '../components/home/homeModel';
import { getHomepagePublicData } from '../lib/homepagePublicData';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, publicData] = await Promise.all([
    searchParams,
    getHomepagePublicData(),
  ]);
  const rawView = readSearchParam(params.view);
  return (
    <HomeWorkspace
      initialView={parseHomeView(rawView)}
      initialTag={readSearchParam(params.tag) || ''}
      hasExplicitView={Boolean(rawView)}
      initialExploreRows={publicData.rows}
    />
  );
}
