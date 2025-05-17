'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

// Define types for the processed data (optional but good practice)
interface ProcessedData {
  title: string;
  originalFileName: string;
  originalFileSize: string; // Or number, formatted as string
  summary: string;
  translation: string;
  fullTextHighlights: string;
}

type ViewMode = 'summary' | 'translate' | 'fullText';

export default function DashboardPage() {
  const params = useParams();
  const id = params?.id as string; // Get ID from route

  const [activeView, setActiveView] = useState<ViewMode>('summary');
  const [data, setData] = useState<ProcessedData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHighlights, setShowHighlights] = useState(true);

  useEffect(() => {
    if (id) {
      // TODO: Fetch data for this ID from KV/Redis/Edge Config
      // For now, using mock data and a timeout to simulate fetching
      setIsLoading(true);
      setError(null);
      console.log(`Fetching data for ID: ${id}`);
      setTimeout(() => {
        // Simulate fetching data based on ID
        // In a real app, this would be an API call that uses the `id`
        // and the blobUrl (which we'd need to store alongside the id)
        // to retrieve the original file if needed for re-processing,
        // or to fetch pre-processed results.

        // Placeholder: fetch original file info from where it was stored during upload (e.g. KV using id)
        // For this example, we assume filename and size would be part of the stored metadata.
        const mockFileData = {
            originalFileName: localStorage.getItem(`srtfile-${id}-name`) || 'example.srt',
            originalFileSize: localStorage.getItem(`srtfile-${id}-size`) || 'N/A KB'
        }

        setData({
          title: `Transcript Analysis: ${mockFileData.originalFileName.split('.')[0]} (${id.substring(0,6)}...)`,
          originalFileName: mockFileData.originalFileName,
          originalFileSize: mockFileData.originalFileSize,
          summary: `This is a mock summary for the SRT file ${id}. The content has been analyzed and condensed effectively. Key points are highlighted, and action items are listed. This summary is concise and aims to be under 200 words. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
          translation: `1\n00:00:01,000 --> 00:00:03,000\n[Translated] This is the first line.\n\n2\n00:00:03,500 --> 00:00:06,000\n[Translated] This is another important line with details.`,
          fullTextHighlights: `1\n00:00:01,000 --> 00:00:03,000\nThis is the **first line**.\n\n2\n00:00:03,500 --> 00:00:06,000\nThis is another **important line** with details including a **key date: 2024-07-30** and a **decision point**.`,
        });
        setIsLoading(false);
      }, 1500);
    }
  }, [id]);

  // For storing filename/size in localStorage from upload page
  // This is a temporary workaround. In a real app, this data would be stored in a DB
  // accessible by the /dashboard/[id] page server-side or fetched client-side.
  useEffect(() => {
    if (typeof window !== "undefined" && data?.originalFileName && data?.originalFileSize) {
        if (!localStorage.getItem(`srtfile-${id}-name`)) {
             localStorage.setItem(`srtfile-${id}-name`, data.originalFileName);
        }
        if (!localStorage.getItem(`srtfile-${id}-size`)) {
            localStorage.setItem(`srtfile-${id}-size`, data.originalFileSize);
        }
    }
  }, [data, id]);


  const renderContent = () => {
    if (isLoading) {
      return <div className="text-center p-10 text-slate-400">Loading content...</div>;
    }
    if (error) {
      return <div className="text-center p-10 text-red-400">Error: {error}</div>;
    }
    if (!data) {
      return <div className="text-center p-10 text-slate-400">No data available.</div>;
    }

    switch (activeView) {
      case 'summary':
        return <div className="prose prose-invert max-w-none p-6 bg-slate-800 rounded-lg whitespace-pre-wrap">{data.summary}</div>;
      case 'translate':
        return <pre className="p-6 bg-slate-800 rounded-lg text-sm whitespace-pre-wrap overflow-x-auto">{data.translation}</pre>;
      case 'fullText':
        // For rendering Markdown with highlights. 
        // A proper Markdown renderer that handles HTML (for <mark>) or converts Markdown bold to <mark> might be needed.
        // For now, just displaying. If we use actual <mark> tags, we'd use dangerouslySetInnerHTML.
        // If using **bold**, then a Markdown component is best.
        // Let's assume the highlight prompt returns Markdown, which needs rendering.
        // For simplicity, we'll display as preformatted text and rely on Markdown for bolding.
        // In a real app: use a library like react-markdown.
        return (
            <div className="p-6 bg-slate-800 rounded-lg">
                <div className="flex justify-end mb-4">
                    <label className="flex items-center cursor-pointer">
                        <span className="mr-2 text-sm text-slate-300">Toggle Highlights</span>
                        <div className="relative">
                            <input type="checkbox" className="sr-only" checked={showHighlights} onChange={() => setShowHighlights(!showHighlights)} />
                            <div className={`block w-10 h-6 rounded-full ${showHighlights ? 'bg-sky-500' : 'bg-slate-600'}`}></div>
                            <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${showHighlights ? 'transform translate-x-full' : ''}`}></div>
                        </div>
                    </label>
                </div>
                <div
                    className={`prose prose-invert max-w-none whitespace-pre-wrap ${showHighlights ? '' : '[&_strong]:font-normal [&_mark]:bg-transparent [&_mark]:text-inherit'}`}
                    // Example of how you might use react-markdown or dangerouslySetInnerHTML later:
                    // dangerouslySetInnerHTML={{ __html: marked(data.fullTextHighlights) }} 
                >
                    {data.fullTextHighlights.split('\n\n').map((paragraph, pIndex) => (
                        <div key={pIndex} className="mb-2 last:mb-0">
                            {paragraph.split('\n').map((line, lIndex) => (
                                <p key={lIndex} className="mb-0.5 last:mb-0">{line}</p>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        );
      default:
        return null;
    }
  };

  const getButtonClass = (view: ViewMode) => 
    `px-4 py-2 rounded-md text-sm font-medium transition-colors 
     ${activeView === view 
       ? 'bg-sky-600 text-white' 
       : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`;

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      <header className="p-4 bg-slate-800/50 backdrop-blur-md shadow-lg sticky top-0 z-10">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-xl font-semibold text-sky-400">SRT Processor / Dashboard</h1>
          {id && <span className="text-xs text-slate-500">ID: {id}</span>}
        </div>
      </header>

      {isLoading && !data && (
        <div className="flex-grow flex items-center justify-center">
            <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500 mx-auto mb-4"></div>
                <p className="text-slate-400">Loading transcript data...</p>
            </div>
        </div>
      )}

      {!isLoading && error && (
         <div className="flex-grow flex items-center justify-center">
            <p className="text-red-400 bg-red-900/30 p-4 rounded-md">Failed to load data: {error}</p>
        </div>
      )}

      {data && (
        <main className="container mx-auto p-4 md:p-6 flex-grow flex flex-col md:flex-row gap-6">
          {/* Left Sidebar */} 
          <aside className="w-full md:w-1/3 lg:w-1/4 bg-slate-800 p-6 rounded-lg shadow-xl self-start">
            <h2 className="text-xl font-semibold mb-1 text-sky-400 truncate" title={data.title}>{data.title}</h2>
            <p className="text-xs text-slate-500 mb-4">ID: {id}</p>
            
            <div className="space-y-3 text-sm">
              <div>
                <span className="font-medium text-slate-400">Original File:</span> 
                <p className="text-slate-300 truncate" title={data.originalFileName}>{data.originalFileName}</p>
              </div>
              <div>
                <span className="font-medium text-slate-400">File Size:</span> 
                <p className="text-slate-300">{data.originalFileSize}</p>
              </div>
            </div>
            
            {/* Placeholder for future elements like download original, re-process options, etc. */}
          </aside>

          {/* Right Content Area */} 
          <section className="w-full md:w-2/3 lg:w-3/4">
            <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
                <div className="flex space-x-2 sm:space-x-3 flex-wrap gap-y-2">
                    <button onClick={() => setActiveView('summary')} className={getButtonClass('summary')}>Summary</button>
                    <button onClick={() => setActiveView('translate')} className={getButtonClass('translate')}>Translate</button>
                    <button onClick={() => setActiveView('fullText')} className={getButtonClass('fullText')}>Full Text w/ Highlights</button>
                </div>
            </div>
            
            <div className="bg-slate-800/50 backdrop-blur-md rounded-lg shadow-xl min-h-[300px]">
              {renderContent()}
            </div>
          </section>
        </main>
      )}
      
      <footer className="p-4 text-center text-xs text-slate-600">
        SRT Processor Edge Demo
      </footer>
    </div>
  );
} 