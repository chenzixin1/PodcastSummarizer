import AppFrame from '../../components/AppFrame';

export default function ChromeExtensionPage() {
  return (
    <AppFrame currentLabel="Extension" showViewTabs={false} mainClassName="mx-auto w-full max-w-[1400px] flex-grow p-4 sm:p-6 lg:p-8">
        <section className="dashboard-panel rounded-2xl p-5 sm:p-6 lg:p-8 max-w-4xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--heading)] mb-3">PodSum Chrome Extension</h1>
          <p className="text-[var(--text-secondary)] leading-7 mb-6">
            下载压缩包后，按照下方步骤在 Chrome 中启用开发者模式并安装扩展。
          </p>

          <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--paper-base)] p-5 sm:p-6 mb-6">
            <h2 className="text-lg sm:text-xl font-semibold text-[var(--heading)] mb-3">下载扩展</h2>
            <p className="text-sm sm:text-base text-[var(--text-secondary)] mb-4">
              文件名：<span className="font-semibold">podsum-chrome-extension.zip</span>
            </p>
            <a
              href="/downloads/podsum-chrome-extension.zip"
              download
              className="inline-flex items-center justify-center rounded-xl bg-[var(--btn-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] transition-colors"
            >
              Download ZIP
            </a>
          </div>

          <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--paper-base)] p-5 sm:p-6">
            <h2 className="text-lg sm:text-xl font-semibold text-[var(--heading)] mb-3">安装说明</h2>
            <ol className="list-decimal pl-5 space-y-3 text-sm sm:text-base leading-7 text-[var(--text-secondary)]">
              <li>先下载上面的 ZIP 压缩包，并解压到本地一个固定目录。</li>
              <li>打开 Chrome，在地址栏输入 <code>chrome://extensions</code> 并回车。</li>
              <li>在扩展管理页面右上角，打开“开发者模式（Developer mode）”。</li>
              <li>点击左上角“加载已解压的扩展程序（Load unpacked）”。</li>
              <li>选择你刚才解压后的扩展目录（目录里应直接能看到 <code>manifest.json</code>）。</li>
              <li>安装完成后，建议把扩展固定到工具栏，方便在 YouTube 页面快速使用。</li>
            </ol>
          </div>
        </section>
    </AppFrame>
  );
}
