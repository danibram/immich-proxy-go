import { Eye, EyeOff, Lock } from 'lucide-solid';
import { createSignal } from 'solid-js';
import { captureEvent } from '~/analytics';
import { api } from '~/api/client';
import { setPasswordRequired } from '~/store/share';

interface Props {
  onSuccess: () => void;
}

export default function PasswordPrompt(props: Props) {
  const [password, setPassword] = createSignal('');
  const [showPassword, setShowPassword] = createSignal(false);
  const [isValidating, setIsValidating] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal('');

  async function handleSubmit(e: Event) {
    e.preventDefault();

    if (!password().trim()) {
      setErrorMessage('Please enter a password');
      return;
    }

    setIsValidating(true);
    setErrorMessage('');

    try {
      await api.validatePassword(password());
      captureEvent('share_password_unlock', { success: true });
      setPasswordRequired(false);
      props.onSuccess();
    } catch (err) {
      const invalidPassword = err instanceof Error && err.message.includes('401');
      captureEvent('share_password_unlock', { success: false, invalid_password: invalidPassword });
      if (invalidPassword) {
        setErrorMessage('Invalid password');
      } else {
        setErrorMessage('An error occurred. Please try again.');
      }
    } finally {
      setIsValidating(false);
    }
  }

  return (
    <div class="password-card animate-fadeIn">
      <div class="text-center mb-6">
        <div
          class="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(34, 197, 94, 0.12)', color: 'var(--accent)' }}
        >
          <Lock size={32} stroke-width={1.8} />
        </div>
        <h1>Password required</h1>
        <p style={{ color: 'var(--grey-4)', 'font-size': '14px', 'margin-top': '6px' }}>
          This album is protected
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <label for="password">Password</label>
        <div class="relative">
          <input
            type={showPassword() ? 'text' : 'password'}
            id="password"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            placeholder="Enter password"
            disabled={isValidating()}
          />
          <button
            type="button"
            class="absolute right-3 top-1/2 -translate-y-1/2 p-1"
            style={{ color: 'var(--grey-3)', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={() => setShowPassword(!showPassword())}
            aria-label={showPassword() ? 'Hide password' : 'Show password'}
          >
            {showPassword() ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </div>

        {errorMessage() && <div class="password-error">{errorMessage()}</div>}

        <button type="submit" class="password-submit" disabled={isValidating()}>
          {isValidating() ? 'Checking…' : 'Unlock album'}
        </button>
      </form>
    </div>
  );
}
