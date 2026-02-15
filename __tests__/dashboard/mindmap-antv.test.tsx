import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MindMapCanvas from '../../components/MindMapCanvas';
import type { MindMapData } from '../../lib/mindMap';

jest.mock('@ant-design/graphs', () => {
  const React = require('react');
  const state =
    (globalThis as {
      __ANTV_MINDMAP_TEST_STATE__?: {
        fitViewMock: jest.Mock;
        latestProps: unknown;
      };
    }).__ANTV_MINDMAP_TEST_STATE__ ||
    ((globalThis as {
      __ANTV_MINDMAP_TEST_STATE__?: {
        fitViewMock: jest.Mock;
        latestProps: unknown;
      };
    }).__ANTV_MINDMAP_TEST_STATE__ = {
      fitViewMock: jest.fn(),
      latestProps: null,
    });

  const MindMap = React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
    state.latestProps = props;

    React.useEffect(() => {
      const graph = { fitView: state.fitViewMock };
      if (typeof ref === 'function') {
        ref(graph);
      } else if (ref && typeof ref === 'object') {
        (ref as { current: unknown }).current = graph;
      }
      if (typeof props.onInit === 'function') {
        props.onInit(graph);
      }
      if (typeof props.onReady === 'function') {
        props.onReady(graph);
      }
    }, [props, ref]);

    return React.createElement('div', { 'data-testid': 'antv-mindmap' });
  });

  MindMap.displayName = 'MindMapMock';

  return { MindMap };
});

function getMockState() {
  return (globalThis as {
    __ANTV_MINDMAP_TEST_STATE__?: {
      fitViewMock: jest.Mock;
      latestProps: any;
    };
  }).__ANTV_MINDMAP_TEST_STATE__ as {
    fitViewMock: jest.Mock;
    latestProps: any;
  };
}

const SAMPLE_DATA: MindMapData = {
  root: {
    label: 'Root',
    children: [
      {
        label: 'Branch A',
        children: [{ label: 'Leaf A1' }],
      },
      {
        label: 'Branch B',
      },
    ],
  },
};

describe('MindMapCanvas AntV integration', () => {
  beforeEach(() => {
    const state = getMockState();
    state.fitViewMock.mockClear();
    state.latestProps = null;
  });

  test('passes right-direction linear configuration and node-triggered collapse settings', async () => {
    render(<MindMapCanvas data={SAMPLE_DATA} themeMode="dark" />);

    await waitFor(() => {
      expect(screen.getByTestId('antv-mindmap')).toBeInTheDocument();
      expect(getMockState().latestProps).toBeTruthy();
    });

    const props = getMockState().latestProps;
    expect(props.direction).toBe('right');
    expect(props.type).toBe('linear');
    expect(props.labelField).toBe('label');
    expect(props.nodeMinWidth).toBe(0);
    expect(props.nodeMaxWidth).toBe(560);
    expect(props.animation).toBe(false);

    const transformed = props.transforms([
      {
        key: 'collapse-expand-react-node',
        type: 'collapse-expand-react-node',
        enable: false,
        trigger: 'icon',
      },
    ]);
    const collapseTransform = transformed.find(
      (item: { key?: string }) => item.key === 'collapse-expand-react-node'
    );

    expect(collapseTransform).toBeDefined();
    expect(collapseTransform.enable).toBe(true);
    expect(collapseTransform.trigger).toBe('node');
    expect(collapseTransform.direction).toBe('out');
    expect(collapseTransform.refreshLayout).toBe(false);
  });

  test('calls graph.fitView when clicking Fit View button', async () => {
    const state = getMockState();
    render(<MindMapCanvas data={SAMPLE_DATA} themeMode="light" />);

    await waitFor(() => {
      expect(state.fitViewMock).toHaveBeenCalled();
    });

    state.fitViewMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Fit View' }));

    expect(state.fitViewMock).toHaveBeenCalledTimes(1);
  });

  test('fullscreen button enters and exits fullscreen mode', async () => {
    let fullscreenElement: Element | null = null;

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });

    const exitFullscreenMock = jest.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreenMock,
    });

    render(<MindMapCanvas data={SAMPLE_DATA} themeMode="dark" />);

    const container = document.querySelector('.mindmap-canvas') as HTMLElement;
    expect(container).toBeTruthy();

    const requestFullscreenMock = jest.fn(async () => {
      fullscreenElement = container;
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    (container as HTMLElement & { requestFullscreen?: () => Promise<void> }).requestFullscreen =
      requestFullscreenMock;

    fireEvent.click(screen.getByRole('button', { name: 'Enter Fullscreen' }));
    await waitFor(() => {
      expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Exit Fullscreen' }));
    await waitFor(() => {
      expect(exitFullscreenMock).toHaveBeenCalledTimes(1);
    });
  });
});
