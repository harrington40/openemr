import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ObservationsTab from '../features/patients/tabs/ObservationsTab';

/**
 * The Save button on the chart's Observations tab.
 *
 * The reported fault: "saving an observation isn't working". The API accepted the
 * write all along — `POST patients/:pid/observations` allows nurses — but the chart
 * passed `readOnly={role === 'nurse'}`, so the button was not rendered for the one
 * role that takes observations. A nurse is the case asserted here.
 */
vi.mock('../api/nest-client', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: { id: 1 } }),
  },
}));

function renderTab(props: { readOnly?: boolean; role?: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ObservationsTab patientId="37" patientName="Peter Joe" {...props} />
    </QueryClientProvider>,
  );
}

describe('ObservationsTab save control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers a nurse the Save button', () => {
    renderTab({ readOnly: false, role: 'nurse' });
    expect(screen.getByRole('button', { name: /save observation/i })).toBeInTheDocument();
    expect(screen.queryByText(/recording observations needs/i)).not.toBeInTheDocument();
  });

  it('offers it to a midwife and a physician too', () => {
    for (const role of ['midwife', 'physician', 'admin']) {
      const { unmount } = renderTab({ readOnly: false, role });
      expect(screen.getByRole('button', { name: /save observation/i })).toBeInTheDocument();
      unmount();
    }
  });

  it('hides the button and explains why, for a role the API refuses', () => {
    renderTab({ readOnly: true, role: 'front_desk' });
    expect(screen.queryByRole('button', { name: /save observation/i })).not.toBeInTheDocument();
    expect(screen.getByText(/recording observations needs/i)).toBeInTheDocument();
    expect(screen.getByText(/front_desk/)).toBeInTheDocument();
  });

  it('says which required field is missing instead of doing nothing', async () => {
    renderTab({ role: 'nurse' });

    // Custom Observation (under "Other") is the only template with a required
    // field. Clicking Save used to return silently — the button looked dead.
    fireEvent.click(screen.getByRole('button', { name: /^Other$/i }));
    fireEvent.click(screen.getByRole('button', { name: /save observation/i }));

    expect(await screen.findByText(/fill in observation title/i)).toBeInTheDocument();
  });
});
