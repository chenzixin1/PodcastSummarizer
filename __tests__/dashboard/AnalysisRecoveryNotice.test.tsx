import { render, screen, fireEvent } from '@testing-library/react';
import AnalysisRecoveryNotice from '../../components/watchless/AnalysisRecoveryNotice';

describe('analysis recovery notice', () => {
  const props = { error: '请求超时', completed: 19, total: 30, busy: false, canEdit: true, onResume: jest.fn() };
  it('leaves saved content visible and offers continuation', () => {
    render(<><p>已保存英文原话</p><AnalysisRecoveryNotice {...props} /></>);
    expect(screen.getByText('已保存英文原话')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('19/30');
    fireEvent.click(screen.getByRole('button'));
    expect(props.onResume).toHaveBeenCalledTimes(1);
  });
  it('blocks duplicate submissions', () => {
    render(<AnalysisRecoveryNotice {...props} busy />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
  it('does not offer actions to readers', () => {
    render(<AnalysisRecoveryNotice {...props} canEdit={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
