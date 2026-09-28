import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

/**
 * The unauthenticated landing page.
 *
 * These assertions are deliberately loose about the exact copy: the brand was
 * renamed from "OpenRx" to "OpenRx Health" and the button from "Sign In with
 * OpenRx" to "Sign In", which broke this file for reasons that had nothing to do
 * with a real defect. What must not silently regress is that a stranger gets a
 * login form with a username *and* a password field — patient records are gated
 * behind a real password — and a way to register.
 */
const renderLogin = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <App />
    </MemoryRouter>,
  );

describe('App', () => {
  it('renders login page when not authenticated', () => {
    renderLogin();

    // Brand + tagline (both render twice: desktop panel and mobile header).
    expect(screen.getAllByText(/OpenRx/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Electronic Prescription & Health Records/i).length).toBeGreaterThan(0);
  });

  it('gives an unauthenticated visitor a real username and password form', () => {
    renderLogin();

    expect(screen.getByPlaceholderText('Enter your username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('offers a way to register', () => {
    renderLogin();

    // "Staff Registration" — worded so the regex survives a reworded label.
    expect(screen.getByRole('link', { name: /register|registration/i })).toBeInTheDocument();
  });
});

