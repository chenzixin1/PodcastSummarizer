import type { MindMapData } from '../../lib/mindMap';
import {
  buildAntvMindMapData,
  collectNodeIds,
  estimateMindMapNodeSize,
} from '../../lib/mindMapAntv';

describe('mindMapAntv adapter', () => {
  test('maps MindMapData to AntV tree data with stable ids and hierarchy', () => {
    const data: MindMapData = {
      root: {
        label: 'Root Topic',
        children: [
          {
            label: 'Branch A',
            children: [{ label: 'Leaf A1' }, { label: 'Leaf A2' }],
          },
          {
            label: 'Branch B',
          },
        ],
      },
    };

    const tree = buildAntvMindMapData(data);

    expect(tree.id).toBe('mind-0');
    expect(tree.data.label).toBe('Root Topic');
    expect(tree.children?.[0].id).toBe('mind-0-0');
    expect(tree.children?.[0].data.label).toBe('Branch A');
    expect(tree.children?.[0].children?.[1].id).toBe('mind-0-0-1');
    expect(tree.children?.[0].children?.[1].data.label).toBe('Leaf A2');
    expect(tree.children?.[1].id).toBe('mind-0-1');
  });

  test('keeps ids stable and unique across repeated builds', () => {
    const data: MindMapData = {
      root: {
        label: 'Root',
        children: [
          { label: 'A', children: [{ label: 'A1' }, { label: 'A2' }] },
          { label: 'B', children: [{ label: 'B1' }] },
        ],
      },
    };

    const first = buildAntvMindMapData(data);
    const second = buildAntvMindMapData(data);

    const firstIds = collectNodeIds(first);
    const secondIds = collectNodeIds(second);

    expect(firstIds).toEqual(secondIds);
    expect(new Set(firstIds).size).toBe(firstIds.length);
  });

  test('does not truncate long labels', () => {
    const longLabel =
      '这是一段很长很长的节点文本，用来验证 AntV 适配层不会裁剪节点内容，并且会原样保留文字内容以便完整阅读和记忆。';
    const data: MindMapData = {
      root: {
        label: longLabel,
        children: [{ label: `${longLabel} 子节点补充` }],
      },
    };

    const tree = buildAntvMindMapData(data);

    expect(tree.data.label).toBe(longLabel);
    expect(tree.children?.[0].data.label).toBe(`${longLabel} 子节点补充`);
  });

  test('filters empty labels and supports single-chain data', () => {
    const data: MindMapData = {
      root: {
        label: 'Root',
        children: [
          {
            label: '   ',
            children: [
              {
                label: 'Kept Child',
                children: [{ label: 'Leaf' }],
              },
            ],
          },
        ],
      },
    };

    const tree = buildAntvMindMapData(data);

    expect(tree.data.label).toBe('Root');
    expect(tree.children?.length).toBe(1);
    expect(tree.children?.[0].data.label).toBe('Kept Child');
    expect(tree.children?.[0].children?.[0].data.label).toBe('Leaf');
  });

  test('estimates width and height bounds for long labels', () => {
    const label = 'a'.repeat(260);
    const size = estimateMindMapNodeSize(label);

    expect(size.width).toBeGreaterThanOrEqual(280);
    expect(size.width).toBeLessThanOrEqual(700);
    expect(size.height).toBeGreaterThanOrEqual(48);
    expect(size.lineCount).toBeGreaterThan(1);
    expect(size.charsPerLine).toBeGreaterThan(0);
  });
});
