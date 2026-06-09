import Image from 'next/image';
import AppFrame from '../../components/AppFrame';

export default function AboutPage() {
  return (
    <AppFrame currentLabel="About" showViewTabs={false} mainClassName="mx-auto flex w-full max-w-[1400px] flex-grow items-center justify-center p-4 sm:p-6 lg:p-8">
        <section className="dashboard-panel w-full max-w-3xl rounded-2xl px-6 py-10 sm:px-10 sm:py-12 text-center">
          <div className="mx-auto mb-8 w-full max-w-[360px]">
            <Image
              src="/podcast-summarizer-icon.png"
              alt="PodSum logo"
              width={512}
              height={512}
              className="w-full h-auto drop-shadow-[0_18px_36px_rgba(47,102,86,0.22)]"
              priority
            />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-[var(--heading)] mb-4">About PodSum.cc</h1>
          <p className="text-base sm:text-lg leading-8 text-[var(--text-secondary)]">
            PodSum.cc 是一个把播客内容快速整理成可读结论的平台。你可以上传 SRT 或 YouTube 链接，
            系统会自动生成结构化摘要、重点信息和可追溯的全文内容，帮助你更快理解长内容并沉淀知识。
          </p>

          <div className="mt-8 rounded-2xl border border-[var(--border-soft)] bg-[var(--paper-base)] px-5 py-6 sm:px-7 text-left">
            <h2 className="text-xl sm:text-2xl font-semibold text-[var(--heading)] mb-3">
              Logo 寓意：知识晶体（Crystal of Ideas）
            </h2>
            <p className="text-sm sm:text-base leading-7 text-[var(--text-secondary)] mb-4">
              我们希望这个 Logo 传达的是一个过程，而不只是一个工具图标：
              声音被理解、被提炼，最终凝结成可复用的知识。
            </p>
            <ul className="space-y-2 text-sm sm:text-base leading-7 text-[var(--text-secondary)] list-disc pl-5">
              <li>外圈是简化后的麦克风轮廓，代表播客语音输入。</li>
              <li>中心是几何晶体结构，代表被压缩与提炼后的信息核心。</li>
              <li>晶体发光点象征关键洞察，意味着内容被整理成可执行的要点。</li>
              <li>整体偏科技与抽象风格，避免“普通听书工具”的既视感。</li>
            </ul>
            <p className="mt-4 text-sm sm:text-base leading-7 text-[var(--heading-soft)] font-medium">
              核心语义：声音 → 提炼 → 形成知识晶体。
            </p>
          </div>
        </section>
    </AppFrame>
  );
}
