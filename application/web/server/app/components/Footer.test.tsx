import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Footer } from './Footer';

describe('Footer', () => {
  it('renders the product name', () => {
    render(<Footer />);
    expect(screen.getByText('Network Inspector')).toBeInTheDocument();
  });

  it('links to the about page for methodology', () => {
    render(<Footer />);
    const link = screen.getByRole('link', { name: /methodology/i });
    expect(link).toHaveAttribute('href', '/about');
  });
});
