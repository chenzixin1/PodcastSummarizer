import type { MindMapData, MindMapNode } from './mindMap';

export interface AntvMindMapNode {
  id: string;
  data: {
    label: string;
  };
  label?: string;
  children?: AntvMindMapNode[];
}

export interface MindMapNodeSizeConfig {
  minWidth: number;
  maxWidth: number;
  fontCharWidth: number;
  lineHeight: number;
  paddingX: number;
  paddingY: number;
  minHeight: number;
}

export interface MindMapNodeSize {
  width: number;
  height: number;
  charsPerLine: number;
  lineCount: number;
}

const DEFAULT_NODE_SIZE_CONFIG: MindMapNodeSizeConfig = {
  minWidth: 280,
  maxWidth: 700,
  fontCharWidth: 8.4,
  lineHeight: 20,
  paddingX: 18,
  paddingY: 14,
  minHeight: 48,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeLabel(raw: unknown): string {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw.replace(/\s+/g, ' ').trim();
}

function buildNodeId(path: number[]): string {
  return `mind-${path.join('-')}`;
}

function mapNode(
  node: MindMapNode,
  path: number[],
  isRoot: boolean
): AntvMindMapNode[] {
  const label = normalizeLabel(node.label);
  const rawChildren = Array.isArray(node.children) ? node.children : [];

  const children = rawChildren.flatMap((child, childIndex) =>
    mapNode(child, [...path, childIndex], false)
  );

  if (!label) {
    if (isRoot) {
      return [
        {
          id: buildNodeId(path),
          data: {
            label: 'Untitled',
          },
          label: 'Untitled',
          ...(children.length > 0 ? { children } : {}),
        },
      ];
    }
    return children;
  }

  return [
    {
      id: buildNodeId(path),
      data: {
        label,
      },
      label,
      ...(children.length > 0 ? { children } : {}),
    },
  ];
}

export function buildAntvMindMapData(data: MindMapData): AntvMindMapNode {
  const root = mapNode(data.root, [0], true)[0];
  return root;
}

export function estimateMindMapNodeSize(
  label: string,
  partialConfig?: Partial<MindMapNodeSizeConfig>
): MindMapNodeSize {
  const config: MindMapNodeSizeConfig = {
    ...DEFAULT_NODE_SIZE_CONFIG,
    ...(partialConfig || {}),
  };

  const normalized = normalizeLabel(label) || 'Untitled';
  const idealWidth = Math.round(normalized.length * config.fontCharWidth + config.paddingX * 2 + 110);
  const width = clamp(idealWidth, config.minWidth, config.maxWidth);

  const textWidth = Math.max(80, width - config.paddingX * 2);
  const charsPerLine = Math.max(8, Math.floor(textWidth / config.fontCharWidth));
  const lineCount = Math.max(1, Math.ceil(normalized.length / charsPerLine));
  const height = Math.max(
    config.minHeight,
    Math.round(config.paddingY * 2 + lineCount * config.lineHeight)
  );

  return {
    width,
    height,
    charsPerLine,
    lineCount,
  };
}

export function collectNodeIds(root: AntvMindMapNode): string[] {
  const ids: string[] = [];

  const walk = (node: AntvMindMapNode) => {
    ids.push(node.id);
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child) => walk(child));
  };

  walk(root);
  return ids;
}
