import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MindMapCanvas from '../../components/MindMapCanvas';
import type { MindMapData } from '../../lib/mindMap';

jest.mock('@ant-design/graphs', () => {
  const React = jest.requireActual<typeof import('react')>('react');
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

  return { MindMap, RCNode:{TextNode:({text}:{text:string})=>React.createElement('span',null,text)} };
});

interface MindMapTestProps {
  defaultExpandLevel?: number;
  direction: string; type: string; labelField: string;
  nodeMinWidth: number; nodeMaxWidth: number; animation: boolean;
  transforms: (previous: Array<Record<string, unknown>>) => Array<Record<string, unknown>>;
  node: { style: { component: (node: {depth:number;data:{label:string};style:{color:string}}) => React.ReactNode } };
}
function getMockState() {
  return (globalThis as {
    __ANTV_MINDMAP_TEST_STATE__?: {
      fitViewMock: jest.Mock;
      latestProps: unknown;
    };
  }).__ANTV_MINDMAP_TEST_STATE__ as {
    fitViewMock: jest.Mock;
    latestProps: MindMapTestProps | null;
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

    const props = getMockState().latestProps!;
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
    expect(collapseTransform?.enable).toBe(true);
    expect(collapseTransform?.trigger).toBe('node');
    expect(collapseTransform?.direction).toBe('out');
    expect(collapseTransform?.refreshLayout).toBe(true);
    expect(props.defaultExpandLevel).toBeUndefined();
  });

  test('large complete analyses start at readable branch level without removing source nodes',()=>{
    const data={root:{label:'Complete episode',children:Array.from({length:3},(_,group)=>({label:`Group ${group}`,children:Array.from({length:25},(_,i)=>({label:`Point ${i}`}))}))}};
    const original=JSON.stringify(data);
    render(<MindMapCanvas data={data} themeMode="light" />);
    expect(getMockState().latestProps?.defaultExpandLevel).toBe(1);
    expect(JSON.stringify(data)).toBe(original);
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
  test('deferred node labels do not access an already destroyed graph model',()=>{
    render(<MindMapCanvas data={SAMPLE_DATA} themeMode="light" />);
    const renderer=getMockState().latestProps!.node.style.component;
    const disposed={getParentData:()=>{throw new Error('disposed model');}};
    expect(()=>renderer.call(disposed,{depth:1,data:{label:'A source point'},style:{color:'#3f7d6a'}})).not.toThrow();
  });
  test('all queued fits are cancelled when switching away from the graph',()=>{
    jest.useFakeTimers();
    const {unmount}=render(<MindMapCanvas data={SAMPLE_DATA} themeMode="light" />);
    unmount(); getMockState().fitViewMock.mockClear(); jest.runAllTimers();
    expect(getMockState().fitViewMock).not.toHaveBeenCalled();
    jest.useRealTimers();
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
