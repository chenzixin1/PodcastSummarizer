'use client';

import { MindMap } from '@ant-design/graphs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MindMapData } from '../lib/mindMap';
import { buildAntvMindMapData, estimateMindMapNodeSize } from '../lib/mindMapAntv';

interface MindMapCanvasProps {
  data: MindMapData;
  themeMode: 'light' | 'dark';
}

interface GraphLike {
  fitView?: () => void;
}

function readNodeLabel(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return '';
  }

  const source = node as {
    label?: unknown;
    id?: unknown;
    data?: {
      label?: unknown;
    };
  };

  if (typeof source.data?.label === 'string') {
    return source.data.label;
  }
  if (typeof source.label === 'string') {
    return source.label;
  }
  if (typeof source.id === 'string') {
    return source.id;
  }
  return '';
}

function FitViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 9V4H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15 4H20V9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 15V20H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 20H4V15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 8L16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 8L8 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function FullscreenIcon({ exit }: { exit: boolean }) {
  if (exit) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M9 9V4H4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M15 9V4H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M9 15V20H4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M15 15V20H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 9V4H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 9V4H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 15V20H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 15V20H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function MindMapCanvas({ data, themeMode }: MindMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<GraphLike | null>(null);
  const initialFittedRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const antvData = useMemo(() => buildAntvMindMapData(data), [data]);

  const fitView = useCallback(() => {
    try {
      graphRef.current?.fitView?.();
    } catch (error) {
      console.error('[MindMap] fitView failed:', error);
    }
  }, []);

  const handleGraphReady = useCallback(
    (graph: unknown) => {
      graphRef.current = (graph as GraphLike) || null;
      if (!initialFittedRef.current) {
        initialFittedRef.current = true;
        setTimeout(() => {
          fitView();
        }, 32);
      }
    },
    [fitView]
  );

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    try {
      if (document.fullscreenElement === container) {
        await document.exitFullscreen();
        return;
      }

      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      await container.requestFullscreen();
    } catch (error) {
      console.error('[MindMap] Fullscreen toggle failed:', error);
    }
  }, []);

  const transforms = useCallback((prevTransforms: unknown) => {
    const prev = Array.isArray(prevTransforms) ? prevTransforms : [];
    let collapseConfigured = false;

    const nextTransforms = prev.map((transform) => {
      if (!transform || typeof transform !== 'object') {
        return transform;
      }

      const candidate = transform as { key?: unknown };
      if (candidate.key !== 'collapse-expand-react-node') {
        return transform;
      }

      collapseConfigured = true;
      return {
        ...(transform as Record<string, unknown>),
        type: 'collapse-expand-react-node',
        key: 'collapse-expand-react-node',
        enable: true,
        trigger: 'node',
        direction: 'out',
        refreshLayout: false,
      };
    });

    if (!collapseConfigured) {
      nextTransforms.push({
        type: 'collapse-expand-react-node',
        key: 'collapse-expand-react-node',
        enable: true,
        trigger: 'node',
        direction: 'out',
        refreshLayout: false,
      });
    }

    return nextTransforms;
  }, []);

  const layout = useMemo(
    () => ({
      type: 'mindmap' as const,
      getHGap: () => 96,
      getVGap: () => 40,
      getWidth: (node: unknown) => estimateMindMapNodeSize(readNodeLabel(node)).width,
      getHeight: (node: unknown) => estimateMindMapNodeSize(readNodeLabel(node)).height,
    }),
    []
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      fitView();
    }, 20);
    return () => clearTimeout(timer);
  }, [antvData, fitView, themeMode]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
      setTimeout(() => {
        fitView();
      }, 40);
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    onFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [fitView]);

  return (
    <div
      ref={containerRef}
      className={`h-full w-full mindmap-canvas mindmap-antv rounded-2xl overflow-hidden ${themeMode === 'dark' ? 'mindmap-antv-dark' : 'mindmap-antv-light'}`}
    >
      <div className="mindmap-toolbar" role="toolbar" aria-label="Mind map controls">
        <button
          type="button"
          onClick={fitView}
          aria-label="Fit View"
          className={`mindmap-toolbar-btn mindmap-fullscreen-btn ${themeMode === 'dark' ? 'mindmap-fullscreen-btn-dark' : 'mindmap-fullscreen-btn-light'}`}
        >
          <FitViewIcon />
          <span>Fit View</span>
        </button>

        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          className={`mindmap-toolbar-btn mindmap-fullscreen-btn ${themeMode === 'dark' ? 'mindmap-fullscreen-btn-dark' : 'mindmap-fullscreen-btn-light'}`}
        >
          <FullscreenIcon exit={isFullscreen} />
          <span>{isFullscreen ? 'Exit Full Screen' : 'Full Screen'}</span>
        </button>
      </div>

      <div className="mindmap-antv-surface">
        <MindMap
          data={antvData}
          type="linear"
          direction="right"
          labelField="label"
          nodeMinWidth={0}
          nodeMaxWidth={560}
          transforms={transforms}
          layout={layout}
          animation={false}
          containerStyle={{ width: '100%', height: '100%' }}
          onInit={handleGraphReady}
        />
      </div>
    </div>
  );
}
