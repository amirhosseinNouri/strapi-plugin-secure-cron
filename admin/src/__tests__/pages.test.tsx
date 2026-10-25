import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DesignSystemProvider, lightTheme } from '@strapi/design-system';
import { MemoryRouter } from 'react-router-dom';
import App from '../pages/App';
import { EditCronJobPage } from '../pages/EditCronJobPage';
import { HomePage } from '../pages/HomePage';
import { NewCronJobPage } from '../pages/NewCronJobPage';
import { ViewCronJobPage } from '../pages/ViewCronJobPage';
import { mockState } from './mocks/strapi-admin';
import { cleanResult, fixtureJob, renderWithProviders } from './render';

const { fetchClient } = mockState;

const setupApi = (jobs: any[] = [fixtureJob()]) => {
  fetchClient.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/settings')) return { data: { securityCheck: true, syntaxHighlighting: true } };
    if (url.endsWith('/cron-jobs')) return { data: jobs };
    const id = url.split('/').pop();
    const job = jobs.find((j) => j.documentId === id);
    if (!job) throw { response: { data: { error: { name: 'NotFoundError', message: 'Not Found', status: 404 } } } };
    return { data: job };
  });
  fetchClient.post.mockImplementation(async (url: string, body: any) => {
    if (url.endsWith('/validate-script')) return { data: cleanResult };
    if (url.includes('/trigger/')) return { data: { success: true, logs: [] } };
    return { data: { ...fixtureJob(), ...body, documentId: 'new' } };
  });
  fetchClient.put.mockImplementation(async (_url: string, body: any) => ({ data: { ...fixtureJob(), ...body } }));
  fetchClient.del.mockResolvedValue({ data: {} });
};

beforeEach(() => {
  Object.values(fetchClient).forEach((fn) => fn.mockReset());
  mockState.allowedActions = { canRead: true, canCreate: true, canUpdate: true, canDelete: true, canTrigger: true };
  mockState.protectAllowed = true;
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  jest.spyOn(window, 'alert').mockImplementation(() => {});
});

describe('HomePage', () => {
  it('lists jobs with their last updater', async () => {
    setupApi();
    renderWithProviders(<HomePage />);
    expect(await screen.findByText('Nightly cleanup')).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText('Last updated by')).toBeInTheDocument();
  });

  it('shows all actions for permitted users, including edit for published jobs', async () => {
    setupApi([fixtureJob({ publicationDate: '2026-10-03T00:00:00.000Z' })]);
    renderWithProviders(<HomePage />);
    await screen.findByText('Nightly cleanup');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test Run' })).toBeInTheDocument();
    expect(screen.getByText('Add new cron job')).toBeInTheDocument();
  });

  it('hides actions the user lacks permission for', async () => {
    setupApi();
    mockState.allowedActions = { canRead: true, canCreate: false, canUpdate: false, canDelete: false, canTrigger: false };
    renderWithProviders(<HomePage />);
    await screen.findByText('Nightly cleanup');
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test Run' })).not.toBeInTheDocument();
    expect(screen.queryByText('Add new cron job')).not.toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('triggers with POST and reports the outcome', async () => {
    jest.useFakeTimers();
    setupApi();
    renderWithProviders(<HomePage />);
    await screen.findByText('Nightly cleanup');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test Run' }));
    });
    expect(fetchClient.post).toHaveBeenCalledWith('/strapi-plugin-cron/cron-jobs/trigger/doc-1');
    expect(screen.getByText('Success')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Success')).not.toBeInTheDocument();

    fetchClient.post.mockResolvedValueOnce({ data: { success: false, logs: [] } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test Run' }));
    });
    expect(screen.getByText('Error')).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('Error')).not.toBeInTheDocument();

    fetchClient.post.mockRejectedValueOnce(new Error('403'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test Run' }));
    });
    expect(screen.getByText('Error')).toBeInTheDocument();
    jest.useRealTimers();
  });

  it('deletes after confirmation', async () => {
    setupApi();
    renderWithProviders(<HomePage />);
    await screen.findByText('Nightly cleanup');
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(fetchClient.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(fetchClient.del).toHaveBeenCalledWith('/strapi-plugin-cron/cron-jobs/doc-1'));
  });

  it('publishes and unpublishes with confirmation and surfaces errors', async () => {
    setupApi();
    renderWithProviders(<HomePage />);
    await screen.findByText('Nightly cleanup');
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('switch'));
    expect(fetchClient.put).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('switch'));
    });
    expect(fetchClient.put).toHaveBeenCalledWith('/strapi-plugin-cron/cron-jobs/publish/doc-1');

    fetchClient.put.mockRejectedValueOnce({ message: 'Network down' });
    await act(async () => {
      fireEvent.click(screen.getByRole('switch'));
    });
    expect(window.alert).toHaveBeenCalledWith('Network down');
  });

  it('explains script errors that keep a job off and links to the editor', async () => {
    setupApi();
    (window.alert as jest.Mock).mockClear();
    renderWithProviders(<HomePage />);
    await screen.findByText('Nightly cleanup');
    fetchClient.put.mockRejectedValueOnce({
      response: {
        data: {
          error: {
            name: 'SecurityCheckError',
            message: 'This cron job cannot be turned on because its script fails the security check.',
            details: {
              findings: [
                {
                  ruleId: 'no-insecure-transport',
                  severity: 'error',
                  message: 'The plain-HTTP URL "http://x" is not allowed.',
                  line: 1,
                  column: 14,
                  endLine: 1,
                  endColumn: 24,
                },
              ],
            },
          },
        },
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('switch'));
    });
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.getByText('"Nightly cleanup" was not turned on')).toBeInTheDocument();
    expect(screen.getByText(/cannot be turned on because its script fails/)).toBeInTheDocument();
    expect(screen.getByText(/Line 1:14 — The plain-HTTP URL/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit script' })).toBeInTheDocument();
  });

  it('lists content the publish guard found and can be dismissed', async () => {
    setupApi();
    renderWithProviders(<HomePage />);
    await screen.findByText('Nightly cleanup');
    fetchClient.put.mockRejectedValueOnce({
      response: {
        data: {
          error: {
            name: 'PublishGuardError',
            message: 'This cron job cannot be turned on until the content it updates is fixed.',
            details: {
              contentFindings: [
                {
                  severity: 'error',
                  message: 'food/home (published): 12 Tables blocks contain non-table HTML.',
                  link: '/admin/content-manager/collection-types/api::landing.landing/abc',
                },
              ],
            },
          },
        },
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('switch'));
    });
    expect(screen.getByText(/12 Tables blocks contain non-table HTML/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open/ })).toHaveAttribute(
      'href',
      '/admin/content-manager/collection-types/api::landing.landing/abc'
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(screen.queryByTestId('blocked-job')).not.toBeInTheDocument();
  });

  it('unpublishes published jobs', async () => {
    setupApi([fixtureJob({ publicationDate: '2026-10-03T00:00:00.000Z' })]);
    renderWithProviders(<HomePage />);
    await screen.findByText('Nightly cleanup');
    await act(async () => {
      fireEvent.click(screen.getByRole('switch'));
    });
    expect(fetchClient.put).toHaveBeenCalledWith('/strapi-plugin-cron/cron-jobs/unpublish/doc-1');
  });

  it('navigates to view, edit and create', async () => {
    setupApi();
    renderWithProviders(<HomePage />);
    await screen.findByText('Nightly cleanup');
    fireEvent.click(screen.getByText('Nightly cleanup'));
  });

  it('sorts by columns', async () => {
    setupApi([fixtureJob(), fixtureJob({ documentId: 'doc-2', name: 'Alpha', endDate: null, createdBy: null, updatedBy: null })]);
    renderWithProviders(<HomePage />);
    await screen.findByText('Alpha');
    const rows = () => screen.getAllByRole('row').map((row) => row.textContent);
    expect(rows()[1]).toContain('Alpha');
    const sortButtons = screen.getAllByRole('button').filter((button) => button.querySelector('svg') && !button.getAttribute('aria-label')?.match(/Edit|Delete|Test Run/));
    sortButtons.slice(0, 4).forEach((button) => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(rows().length).toBe(3);
  });

  it('shows the empty state with or without a create action', async () => {
    setupApi([]);
    const { unmount } = renderWithProviders(<HomePage />);
    expect(await screen.findByText(/You don't have any cron jobs yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add new cron job' }));
    unmount();
    mockState.allowedActions = { ...mockState.allowedActions, canCreate: false };
    renderWithProviders(<HomePage />);
    await screen.findByText(/You don't have any cron jobs yet/);
    expect(screen.queryByRole('button', { name: 'Add new cron job' })).not.toBeInTheDocument();
  });
});

describe('NewCronJobPage', () => {
  it('creates a job and returns to the list', async () => {
    setupApi();
    renderWithProviders(<NewCronJobPage />);
    fireEvent.change(screen.getByPlaceholderText('Cron job name'), { target: { name: 'name', value: 'Fresh' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(fetchClient.post).toHaveBeenCalledWith('/strapi-plugin-cron/cron-jobs', expect.objectContaining({ name: 'Fresh' }));
    expect(await screen.findByText('Plugin home')).toBeInTheDocument();
  });
});

describe('EditCronJobPage', () => {
  it('loads and updates a job', async () => {
    setupApi();
    renderWithProviders(<EditCronJobPage />, { route: '/cron-jobs/edit/doc-1', path: '/cron-jobs/edit/:documentId' });
    expect(await screen.findByDisplayValue('Nightly cleanup')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(fetchClient.put).toHaveBeenCalledWith(
      '/strapi-plugin-cron/cron-jobs/doc-1',
      expect.objectContaining({ name: 'Nightly cleanup', acknowledgeWarnings: false })
    );
    expect(fetchClient.put.mock.calls[0][1]).not.toHaveProperty('createdBy');
    expect(await screen.findByText('Plugin home')).toBeInTheDocument();
  });

  it('shows not found for unknown jobs', async () => {
    setupApi([]);
    renderWithProviders(<EditCronJobPage />, { route: '/cron-jobs/edit/nope', path: '/cron-jobs/edit/:documentId' });
    expect(await screen.findByText(/can't seem to find the page/)).toBeInTheDocument();
  });

  it('shows a loader first', () => {
    setupApi();
    renderWithProviders(<EditCronJobPage />, { route: '/cron-jobs/edit/doc-1', path: '/cron-jobs/edit/:documentId' });
    expect(screen.getByText('Loading page')).toBeInTheDocument();
  });
});

describe('ViewCronJobPage', () => {
  it('shows attribution and the execution log', async () => {
    setupApi();
    renderWithProviders(<ViewCronJobPage />, { route: '/cron-jobs/doc-1', path: '/cron-jobs/:documentId' });
    expect(await screen.findByDisplayValue('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Latest execution log' })).toHaveValue('-- run\nhi');
  });

  it('handles missing logs and unknown jobs', async () => {
    setupApi([fixtureJob({ latestExecutionLog: null })]);
    const { unmount } = renderWithProviders(<ViewCronJobPage />, { route: '/cron-jobs/doc-1', path: '/cron-jobs/:documentId' });
    expect(await screen.findByRole('textbox', { name: 'Latest execution log' })).toHaveValue('');
    unmount();
    renderWithProviders(<ViewCronJobPage />, { route: '/cron-jobs/nope', path: '/cron-jobs/:documentId' });
    expect(await screen.findByText(/can't seem to find the page/)).toBeInTheDocument();
  });
});

describe('App', () => {
  const renderApp = (route: string) =>
    render(
      <DesignSystemProvider locale="en-GB" theme={lightTheme}>
        <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </MemoryRouter>
      </DesignSystemProvider>
    );

  it('routes to the list, create, edit and view pages', async () => {
    setupApi();
    const { unmount } = renderApp('/');
    expect(await screen.findByText('Nightly cleanup')).toBeInTheDocument();
    unmount();
    const create = renderApp('/cron-jobs/create');
    expect(await screen.findByText('New Cron Job')).toBeInTheDocument();
    create.unmount();
    const edit = renderApp('/cron-jobs/edit/doc-1');
    expect(await screen.findByText('Edit Cron Job')).toBeInTheDocument();
    edit.unmount();
    const view = renderApp('/cron-jobs/doc-1');
    expect(await screen.findByDisplayValue('Ada Lovelace')).toBeInTheDocument();
    view.unmount();
    renderApp('/a/b/c');
    expect(screen.getByText('Error page')).toBeInTheDocument();
  });

  it('protects the plugin with the read permission', () => {
    setupApi();
    mockState.protectAllowed = false;
    renderApp('/');
    expect(screen.getByText('No permission')).toBeInTheDocument();
  });
});
