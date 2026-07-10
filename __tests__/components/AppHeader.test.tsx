import React from 'react';
import { render, screen } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import AppHeader from '../../components/AppHeader';

jest.mock('next-auth/react', () => ({
  signOut: jest.fn(),
  useSession: jest.fn(),
}));

describe('AppHeader', () => {
  beforeEach(() => {
    (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated' });
  });

  test('renders the display-size logo instead of the 512 px source asset', () => {
    const { container } = render(
      <AppHeader themeMode="light" onThemeToggle={jest.fn()} />,
    );

    const logo = screen.getByRole('img', { name: 'PodSum logo' });

    expect(logo).toHaveAttribute('src', '/podcast-summarizer-icon-96-v1.png');
    expect(logo).toHaveAttribute('width', '36');
    expect(logo).toHaveAttribute('height', '36');
    expect(container.innerHTML).not.toContain('podcast-summarizer-icon.png');
  });
});
