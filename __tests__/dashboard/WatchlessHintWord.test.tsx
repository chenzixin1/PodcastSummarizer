import { fireEvent, render, screen } from '@testing-library/react';
import WatchlessHintWord from '../../components/watchless/WatchlessHintWord';
import { buildHintDictionaryCard } from '../../lib/vocabHint';

const card = buildHintDictionaryCard('capability', { zh: '能力', level: ['IELTS'] })!;
function setup() {
  const pronunciation = { hover: jest.fn(), stop: jest.fn(), tap: jest.fn() };
  render(<WatchlessHintWord word="capability" card={card} level={['IELTS']} pronunciation={pronunciation}>capability</WatchlessHintWord>);
  return { pronunciation, button: screen.getByRole('button', { name: /capability.*播放发音/ }) };
}
function pointer(target: HTMLElement, type: string, pointerType: string) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(target, event);
}

test('mouse hover starts the shared pronunciation loop and leaving stops it', () => {
  const { button, pronunciation } = setup();
  pointer(button, 'pointerover', 'mouse');
  expect(pronunciation.hover).toHaveBeenCalledWith('capability');
  pointer(button, 'pointerout', 'mouse');
  expect(pronunciation.stop).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('tooltip')).toHaveTextContent('悬停发音 · 点按重播');
});
test('touch does not start a hover loop; tapping plays once', () => {
  const { button, pronunciation } = setup();
  pointer(button, 'pointerover', 'touch');
  expect(pronunciation.hover).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(pronunciation.tap).toHaveBeenCalledTimes(1);
  expect(pronunciation.tap).toHaveBeenCalledWith('capability');
});
test('keyboard focus pronounces and Escape or blur stops playback', () => {
  const { button, pronunciation } = setup();
  jest.spyOn(button, 'matches').mockReturnValue(true);
  fireEvent.focus(button);
  expect(pronunciation.hover).toHaveBeenCalledWith('capability');
  fireEvent.keyDown(button, { key: 'Escape' });
  expect(pronunciation.stop).toHaveBeenCalled();
  pronunciation.stop.mockClear();
  fireEvent.blur(button);
  expect(pronunciation.stop).toHaveBeenCalledTimes(1);
});
