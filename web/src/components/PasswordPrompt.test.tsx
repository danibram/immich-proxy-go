import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '~/api/client';
import PasswordPrompt from './PasswordPrompt';

// Mock the API
vi.mock('~/api/client', () => ({
  api: {
    validatePassword: vi.fn(),
  },
}));

describe('PasswordPrompt Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders password input and unlock button', () => {
    createRoot((dispose) => {
      render(() => <PasswordPrompt onSuccess={() => { }} />);

      expect(screen.getByText('Password required')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /unlock/i })).toBeInTheDocument();
      dispose();
    });
  });

  it('shows error when submitting empty password', async () => {
    await createRoot(async (dispose) => {
      render(() => <PasswordPrompt onSuccess={() => { }} />);

      // Submit the form
      const form = document.querySelector('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByText('Please enter a password')).toBeInTheDocument();
      });
      dispose();
    });
  });

  it('calls API with password on submit', async () => {
    const mockValidate = vi.mocked(api.validatePassword);
    mockValidate.mockResolvedValueOnce(true);
    const onSuccess = vi.fn();

    await createRoot(async (dispose) => {
      render(() => <PasswordPrompt onSuccess={onSuccess} />);

      const input = screen.getByPlaceholderText('Enter password');
      fireEvent.input(input, { target: { value: 'secret123' } });
      fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

      await waitFor(() => {
        expect(mockValidate).toHaveBeenCalledWith('secret123');
      });

      dispose();
    });
  });

  it('calls onSuccess when password is valid', async () => {
    const mockValidate = vi.mocked(api.validatePassword);
    mockValidate.mockResolvedValueOnce(true);
    const onSuccess = vi.fn();

    await createRoot(async (dispose) => {
      render(() => <PasswordPrompt onSuccess={onSuccess} />);

      const input = screen.getByPlaceholderText('Enter password');
      fireEvent.input(input, { target: { value: 'correct' } });
      fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled();
      });

      dispose();
    });
  });

  it('shows error message on invalid password', async () => {
    const mockValidate = vi.mocked(api.validatePassword);
    mockValidate.mockRejectedValueOnce(new Error('401 Unauthorized'));

    await createRoot(async (dispose) => {
      render(() => <PasswordPrompt onSuccess={() => { }} />);

      const input = screen.getByPlaceholderText('Enter password');
      fireEvent.input(input, { target: { value: 'wrong' } });
      fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

      await waitFor(() => {
        expect(screen.getByText('Invalid password')).toBeInTheDocument();
      });

      dispose();
    });
  });

  it('shows generic error on other failures', async () => {
    const mockValidate = vi.mocked(api.validatePassword);
    mockValidate.mockRejectedValueOnce(new Error('Network error'));

    await createRoot(async (dispose) => {
      render(() => <PasswordPrompt onSuccess={() => { }} />);

      const input = screen.getByPlaceholderText('Enter password');
      fireEvent.input(input, { target: { value: 'test' } });
      fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

      await waitFor(() => {
        expect(screen.getByText('An error occurred. Please try again.')).toBeInTheDocument();
      });

      dispose();
    });
  });

  it('toggles password visibility', async () => {
    await createRoot(async (dispose) => {
      render(() => <PasswordPrompt onSuccess={() => { }} />);

      const input = screen.getByPlaceholderText('Enter password') as HTMLInputElement;
      expect(input.type).toBe('password');

      // Find the toggle button (eye icon button)
      const toggleButton = screen.getAllByRole('button').find(
        btn => btn.getAttribute('type') === 'button'
      );

      if (toggleButton) {
        fireEvent.click(toggleButton);

        await waitFor(() => {
          expect(input.type).toBe('text');
        });

        fireEvent.click(toggleButton);

        await waitFor(() => {
          expect(input.type).toBe('password');
        });
      }

      dispose();
    });
  });

  it('disables form during validation', async () => {
    const mockValidate = vi.mocked(api.validatePassword);
    // Create a promise that we can control
    let resolveValidate: (value: boolean) => void;
    mockValidate.mockImplementationOnce(() => new Promise(resolve => {
      resolveValidate = resolve;
    }));

    await createRoot(async (dispose) => {
      render(() => <PasswordPrompt onSuccess={() => { }} />);

      const input = screen.getByPlaceholderText('Enter password') as HTMLInputElement;
      const submitButton = screen.getByRole('button', { name: /unlock/i }) as HTMLButtonElement;

      fireEvent.input(input, { target: { value: 'test' } });
      fireEvent.click(submitButton);

      // During validation, button should be disabled
      await waitFor(() => {
        expect(submitButton.disabled).toBe(true);
        expect(input.disabled).toBe(true);
      });

      // Resolve the promise
      resolveValidate!(true);

      dispose();
    });
  });
});
