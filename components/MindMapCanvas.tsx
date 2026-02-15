'use client';

import { useEffect, useMemo } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MindMapData, MindMapNode } from '../lib/mindMap';

interface MindMapCanvasProps {
  data: MindMapData;
  themeMode: 'light' | 'dark';
}

interface GraphBuildOutput {
  nodes: Node[];
  edges: Edge[];
}

const HORIZONTAL_GAP = 280;
const VERTICAL_GAP = 170;

function buildMindMapGraph(data: MindMapData, themeMode: 'light' | 'dark'): GraphBuildOutput {
  let nodeCounter = 0;
  const descriptors: Array<{
    id: string;
    label: string;
    depth: number;
    parentId: string | null;
  }> = [];

  const walk = (node: MindMapNode, depth: number, parentId: string | null) => {
    const id = `mind-node-${nodeCounter++}`;
    descriptors.push({
      id,
      label: String(node.label || '').trim() || 'Untitled',
      depth,
      parentId,
    });

    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      walk(child, depth + 1, id);
    }
  };

  walk(data.root, 0, null);

  const byDepth = new Map<number, string[]>();
  for (const item of descriptors) {
    const existing = byDepth.get(item.depth) || [];
    existing.push(item.id);
    byDepth.set(item.depth, existing);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [depth, ids] of byDepth.entries()) {
    const totalWidth = (ids.length - 1) * HORIZONTAL_GAP;
    ids.forEach((id, index) => {
      const x = index * HORIZONTAL_GAP - totalWidth / 2;
      const y = depth * VERTICAL_GAP;
      positions.set(id, { x, y });
    });
  }

  const nodes: Node[] = descriptors.map((item) => {
    const palette =
      themeMode === 'dark'
        ? {
            bg: item.depth === 0 ? '#4b5a70' : '#1c2430',
            bgAlt: item.depth === 0 ? '#5f718e' : '#202b39',
            border: item.depth === 0 ? '#8fa2be' : '#3a4657',
            text: '#f5f7fb',
            shadow: '0 16px 26px -22px rgba(0,0,0,0.85)',
          }
        : {
            bg: item.depth === 0 ? '#f5efe2' : '#fffdf8',
            bgAlt: item.depth === 0 ? '#f1e7d3' : '#f8f1e4',
            border: item.depth === 0 ? '#cdbb9f' : '#d9cdbb',
            text: '#332a1f',
            shadow: '0 16px 28px -22px rgba(78,63,41,0.55)',
          };

    const width = Math.max(150, Math.min(320, item.label.length * 14 + 42));

    return {
      id: item.id,
      data: { label: item.label },
      position: positions.get(item.id) || { x: 0, y: 0 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      draggable: true,
      style: {
        width,
        borderRadius: 16,
        border: `1px solid ${palette.border}`,
        background: `linear-gradient(145deg, ${palette.bg} 0%, ${palette.bgAlt} 100%)`,
        color: palette.text,
        boxShadow: palette.shadow,
        fontSize: 14,
        fontWeight: item.depth === 0 ? 700 : 600,
        lineHeight: 1.5,
        padding: '10px 12px',
        textAlign: 'center',
      },
    };
  });

  const edges: Edge[] = descriptors
    .filter((item) => Boolean(item.parentId))
    .map((item) => ({
      id: `mind-edge-${item.parentId}-${item.id}`,
      source: item.parentId as string,
      target: item.id,
      type: 'smoothstep',
      animated: true,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20,
      },
      style: {
        strokeWidth: 1.8,
        stroke: themeMode === 'dark' ? '#8194b0' : '#7ea08f',
      },
    }));

  return { nodes, edges };
}

function MindMapFlow({ nodes, edges, themeMode }: { nodes: Node[]; edges: Edge[]; themeMode: 'light' | 'dark' }) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const timer = setTimeout(() => {
      fitView({ padding: 0.2, duration: 700 });
    }, 20);
    return () => clearTimeout(timer);
  }, [edges, fitView, nodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      minZoom={0.35}
      maxZoom={1.8}
      defaultEdgeOptions={{ type: 'smoothstep' }}
      panOnScroll
      zoomOnScroll
      proOptions={{ hideAttribution: true }}
    >
      <Background
        gap={20}
        size={1.1}
        color={themeMode === 'dark' ? 'rgba(140,160,190,0.22)' : 'rgba(114,143,130,0.22)'}
      />
      <MiniMap
        pannable
        zoomable
        style={{
          background: themeMode === 'dark' ? 'rgba(17,24,34,0.95)' : 'rgba(255,252,247,0.95)',
          border: `1px solid ${themeMode === 'dark' ? '#3a4657' : '#d8ccb8'}`,
        }}
        maskColor={themeMode === 'dark' ? 'rgba(14,20,28,0.62)' : 'rgba(250,245,236,0.62)'}
      />
      <Controls
        showInteractive={false}
        style={{
          border: `1px solid ${themeMode === 'dark' ? '#3a4657' : '#d8ccb8'}`,
          background: themeMode === 'dark' ? '#1a2330' : '#fffaf2',
        }}
      />
    </ReactFlow>
  );
}

export default function MindMapCanvas({ data, themeMode }: MindMapCanvasProps) {
  const graph = useMemo(() => buildMindMapGraph(data, themeMode), [data, themeMode]);

  return (
    <div className="h-full w-full mindmap-canvas rounded-2xl overflow-hidden">
      <ReactFlowProvider>
        <MindMapFlow nodes={graph.nodes} edges={graph.edges} themeMode={themeMode} />
      </ReactFlowProvider>
    </div>
  );
}
